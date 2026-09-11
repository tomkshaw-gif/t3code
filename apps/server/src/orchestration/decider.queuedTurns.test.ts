import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:01:00.000Z";

function makeSession(status: OrchestrationSession["status"]): OrchestrationSession {
  return {
    threadId: ThreadId.make("thread-1"),
    status,
    providerName: "Grok",
    runtimeMode: "full-access",
    activeTurnId: status === "running" ? TurnId.make("turn-1") : null,
    lastError: null,
    updatedAt: NOW,
  };
}

function makeReadModel(
  session: OrchestrationSession | null = null,
  queuedTurns?: OrchestrationThread["queuedTurns"],
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("grok"), model: "grok-code-fast-1" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        pullRequests: [],
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        deletedAt: null,
        messages: [],
        queuedTurns,
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session,
      },
    ],
    updatedAt: NOW,
  };
}

let sequence = 0;
function projectAll(
  model: OrchestrationReadModel,
  events: ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
) {
  return Effect.gen(function* () {
    let current = model;
    for (const event of events) {
      current = yield* projectEvent(current, {
        ...event,
        sequence: (sequence += 1),
      } as OrchestrationEvent);
    }
    return current;
  });
}

// The decider returns a single event or a list — normalize for assertions.
function toEventList<E>(result: E | ReadonlyArray<E>): ReadonlyArray<E> {
  return Array.isArray(result) ? (result as ReadonlyArray<E>) : [result as E];
}

function turnStart(
  messageId: string,
  createdAt: string,
  delivery?: "steer" | "queue",
): Parameters<typeof decideOrchestrationCommand>[0]["command"] {
  return {
    type: "thread.turn.start",
    commandId: CommandId.make(`cmd-start-${messageId}`),
    threadId: ThreadId.make("thread-1"),
    message: { messageId: MessageId.make(messageId), role: "user", text: "hi", attachments: [] },
    ...(delivery !== undefined ? { delivery } : {}),
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt,
  };
}

it.layer(NodeServices.layer)("queued turn decider", (it) => {
  it.effect("queue delivery on an idle thread starts the turn immediately", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: turnStart("m-1", NOW, "queue"),
        readModel: makeReadModel(makeSession("ready")),
      });
      const types = toEventList(result).map((event) => event.type);
      expect(types).toContain("thread.message-sent");
      expect(types).toContain("thread.turn-start-requested");
      expect(types).not.toContain("thread.turn-queued");
    }),
  );

  it.effect("queue delivery while running records the message and parks the turn", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: turnStart("m-1", NOW, "queue"),
        readModel: makeReadModel(makeSession("running")),
      });
      const types = toEventList(result).map((event) => event.type);
      expect(types).toContain("thread.message-sent");
      expect(types).toContain("thread.turn-queued");
      expect(types).not.toContain("thread.turn-start-requested");
    }),
  );

  it.effect("default delivery (no flag) keeps steering a running turn", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: turnStart("m-1", NOW),
        readModel: makeReadModel(makeSession("running")),
      });
      const types = toEventList(result).map((event) => event.type);
      expect(types).toContain("thread.turn-start-requested");
      expect(types).not.toContain("thread.turn-queued");
    }),
  );

  it.effect("queued entries are FIFO: dispatch pops the head as a real turn start", () =>
    Effect.gen(function* () {
      let model = makeReadModel(makeSession("running"));
      for (const messageId of ["m-1", "m-2", "m-3"]) {
        const events = yield* decideOrchestrationCommand({
          command: turnStart(messageId, NOW, "queue"),
          readModel: model,
        });
        model = yield* projectAll(model, toEventList(events));
      }
      const thread = model.threads[0]!;
      expect(thread.queuedTurns?.map((entry) => entry.messageId)).toEqual(["m-1", "m-2", "m-3"]);

      // Session goes idle: the ready transition pops the head.
      const readySession = makeSession("ready");
      const dispatchEvents = yield* decideOrchestrationCommand({
        command: {
          type: "thread.session.set",
          commandId: CommandId.make("cmd-dispatch-1"),
          threadId: ThreadId.make("thread-1"),
          session: readySession,
          createdAt: LATER,
        },
        readModel: model,
      });
      const dispatchList = toEventList(dispatchEvents);
      const dequeued = dispatchList.find((event) => event.type === "thread.turn-dequeued");
      const started = dispatchList.find((event) => event.type === "thread.turn-start-requested");
      expect(dequeued?.payload).toMatchObject({ messageId: "m-1", reason: "dispatched" });
      expect(started?.payload).toMatchObject({ messageId: "m-1" });
      const next = yield* projectAll(model, dispatchList);
      expect(next.threads[0]!.queuedTurns?.map((entry) => entry.messageId)).toEqual(["m-2", "m-3"]);
    }),
  );

  it.effect("a busy session write leaves the parked head alone", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel(makeSession("running"), [
        { messageId: MessageId.make("m-1"), createdAt: NOW },
      ]);
      const events = yield* decideOrchestrationCommand({
        command: {
          type: "thread.session.set",
          commandId: CommandId.make("cmd-session-still-running"),
          threadId: ThreadId.make("thread-1"),
          session: makeSession("running"),
          createdAt: LATER,
        },
        readModel,
      });
      const list = toEventList(events);
      expect(list.map((event) => event.type)).toEqual(["thread.session-set"]);
      expect(list.find((event) => event.type === "thread.turn-dequeued")).toBeUndefined();
    }),
  );

  it.effect("an unadopted drained message blocks a second pop on duplicate idle writes", () =>
    Effect.gen(function* () {
      // Queue through the real path so the user messages exist in the model —
      // the guard keys on the message row, not the queue entry.
      let readModel = makeReadModel(makeSession("running"));
      for (const messageId of ["m-1", "m-2"]) {
        const events = yield* decideOrchestrationCommand({
          command: turnStart(messageId, NOW, "queue"),
          readModel,
        });
        readModel = yield* projectAll(readModel, toEventList(events));
      }
      const first = yield* decideOrchestrationCommand({
        command: {
          type: "thread.session.set",
          commandId: CommandId.make("cmd-ready-1"),
          threadId: ThreadId.make("thread-1"),
          session: makeSession("ready"),
          createdAt: LATER,
        },
        readModel,
      });
      const afterFirst = yield* projectAll(readModel, toEventList(first));
      expect(afterFirst.threads[0]!.queuedTurns?.map((entry) => entry.messageId)).toEqual(["m-2"]);

      // A duplicate ready write must not pop m-2 while m-1 awaits adoption.
      const second = yield* decideOrchestrationCommand({
        command: {
          type: "thread.session.set",
          commandId: CommandId.make("cmd-ready-2"),
          threadId: ThreadId.make("thread-1"),
          session: makeSession("ready"),
          createdAt: LATER,
        },
        readModel: afterFirst,
      });
      const secondList = toEventList(second);
      expect(secondList.map((event) => event.type)).toEqual(["thread.session-set"]);
    }),
  );

  it.effect("cancel removes a parked entry and rejects unknown messages", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel(makeSession("running"), [
        { messageId: MessageId.make("m-1"), createdAt: NOW },
        { messageId: MessageId.make("m-2"), createdAt: NOW },
      ]);
      const events = yield* decideOrchestrationCommand({
        command: {
          type: "thread.queued-turn.cancel",
          commandId: CommandId.make("cmd-cancel-1"),
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("m-1"),
          createdAt: LATER,
        },
        readModel,
      });
      const cancelList = toEventList(events);
      const dequeued = cancelList.find((event) => event.type === "thread.turn-dequeued");
      expect(dequeued?.payload).toMatchObject({ messageId: "m-1", reason: "cancelled" });
      const next = yield* projectAll(readModel, cancelList);
      expect(next.threads[0]!.queuedTurns?.map((entry) => entry.messageId)).toEqual(["m-2"]);

      const missing = yield* decideOrchestrationCommand({
        command: {
          type: "thread.queued-turn.cancel",
          commandId: CommandId.make("cmd-cancel-2"),
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("m-9"),
          createdAt: LATER,
        },
        readModel: next,
      }).pipe(Effect.flip);
      expect(missing._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("promote dispatches a specific queued entry and keeps the rest ordered", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel(makeSession("running"), [
        { messageId: MessageId.make("m-1"), createdAt: NOW },
        { messageId: MessageId.make("m-2"), createdAt: NOW },
        { messageId: MessageId.make("m-3"), createdAt: NOW },
      ]);
      const events = yield* decideOrchestrationCommand({
        command: {
          type: "thread.queued-turn.promote",
          commandId: CommandId.make("cmd-promote-1"),
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("m-2"),
          createdAt: LATER,
        },
        readModel,
      });
      const promoteList = toEventList(events);
      const dequeued = promoteList.find((event) => event.type === "thread.turn-dequeued");
      const startRequested = promoteList.find(
        (event) => event.type === "thread.turn-start-requested",
      );
      expect(dequeued?.payload).toMatchObject({ messageId: "m-2", reason: "dispatched" });
      expect(startRequested?.payload).toMatchObject({ messageId: "m-2" });
      const next = yield* projectAll(readModel, promoteList);
      expect(next.threads[0]!.queuedTurns?.map((entry) => entry.messageId)).toEqual(["m-1", "m-3"]);

      const missing = yield* decideOrchestrationCommand({
        command: {
          type: "thread.queued-turn.promote",
          commandId: CommandId.make("cmd-promote-2"),
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("m-9"),
          createdAt: LATER,
        },
        readModel: next,
      }).pipe(Effect.flip);
      expect(missing._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("interrupting a running turn clears every parked queue entry", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel(makeSession("running"), [
        { messageId: MessageId.make("m-1"), createdAt: NOW },
        { messageId: MessageId.make("m-2"), createdAt: NOW },
      ]);
      const events = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.interrupt",
          commandId: CommandId.make("cmd-interrupt"),
          threadId: ThreadId.make("thread-1"),
          createdAt: LATER,
        },
        readModel,
      });
      const list = toEventList(events);
      expect(list.find((event) => event.type === "thread.turn-interrupt-requested")).toBeTruthy();
      const cleared = list.filter((event) => event.type === "thread.turn-dequeued");
      expect(cleared.map((event) => event.payload)).toEqual([
        expect.objectContaining({ messageId: "m-1", reason: "cleared" }),
        expect.objectContaining({ messageId: "m-2", reason: "cleared" }),
      ]);
      const next = yield* projectAll(readModel, list);
      expect(next.threads[0]!.queuedTurns).toEqual([]);
    }),
  );

  it.effect("settle is rejected while messages are queued", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.settle",
          commandId: CommandId.make("cmd-settle"),
          threadId: ThreadId.make("thread-1"),
        },
        readModel: makeReadModel(makeSession("ready"), [
          { messageId: MessageId.make("m-1"), createdAt: NOW },
        ]),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationThreadSettleBlockedError");
    }),
  );

  it.effect("the queue rejects entries past the 32-message bound", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel(
        makeSession("running"),
        Array.from({ length: 32 }, (_, index) => ({
          messageId: MessageId.make(`m-${index}`),
          createdAt: NOW,
        })),
      );
      const error = yield* decideOrchestrationCommand({
        command: turnStart("m-overflow", LATER, "queue"),
        readModel,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      expect((error as { detail?: string }).detail).toContain("32");
    }),
  );
});
