import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationSession,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadShell,
  type ServerSettings,
} from "@t3tools/contracts";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ServerActivation } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import * as WorkerCompletionReactor from "./WorkerCompletionReactor.ts";

const NOW = "2026-08-28T12:00:00.000Z";
const PROJECT_ID = ProjectId.make("completion-project");
const PARENT_ID = ThreadId.make("orchestrator");
const WORKER_ID = ThreadId.make("worker");
const TURN_ID = TurnId.make("turn-1");

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(1),
  digest: (_algorithm, data) => Effect.succeed(data),
});

function makeSession(overrides: Partial<OrchestrationSession> = {}): OrchestrationSession {
  return {
    threadId: WORKER_ID,
    status: "running",
    providerName: null,
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeThread(
  id: ThreadId,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  return {
    id,
    projectId: PROJECT_ID,
    title: id,
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    pullRequests: [],
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: NOW,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function makeDetailThread(thread: OrchestrationThreadShell): OrchestrationThread {
  return {
    ...thread,
    deletedAt: null,
    messages: [
      {
        id: MessageId.make("assistant-1"),
        role: "assistant",
        text: "Done — added the queue badge.",
        turnId: TURN_ID,
        streaming: false,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: thread.session,
  };
}

function makeDetail(thread: OrchestrationThreadShell): OrchestrationThreadDetailSnapshot {
  return { snapshotSequence: 1, thread: makeDetailThread(thread) };
}

function sessionSetEvent(
  threadId: ThreadId,
  session: OrchestrationSession,
  sequence: number,
): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: NOW,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.session-set",
    payload: { threadId, session },
  };
}

interface HarnessOptions {
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
  readonly settings?: Partial<ServerSettings>;
}

const makeHarness = Effect.fn("makeWorkerCompletionHarness")(function* (options: HarnessOptions) {
  const activation = yield* Deferred.make<void>();
  const eventBus = yield* PubSub.unbounded<OrchestrationEvent>();
  const threads = yield* Ref.make<ReadonlyArray<OrchestrationThreadShell>>(options.threads);
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  // Receipt that the reactor's consumer pulled an event off the subscription —
  // publishing alone doesn't prove the processing loop saw it yet.
  const consumedEvents = yield* Queue.unbounded<void>();

  const dispatch: OrchestrationEngineShape["dispatch"] = (command) =>
    Ref.update(commands, (recorded) => [...recorded, command]).pipe(Effect.as({ sequence: 1 }));

  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getShellSnapshot: () =>
        Ref.get(threads).pipe(
          Effect.map((entries): OrchestrationShellSnapshot => ({
            snapshotSequence: 1,
            projects: [],
            threads: [...entries],
            updatedAt: NOW,
          })),
        ),
      getThreadShellById: (threadId: ThreadId) =>
        Ref.get(threads).pipe(
          Effect.map((entries) =>
            Option.fromNullishOr(entries.find((entry) => entry.id === threadId) ?? null),
          ),
        ),
      getThreadDetailSnapshot: (threadId: ThreadId) =>
        Ref.get(threads).pipe(
          Effect.map((entries) => {
            const thread = entries.find((entry) => entry.id === threadId);
            return thread === undefined ? Option.none() : Option.some(makeDetail(thread));
          }),
        ),
    }),
    Layer.mock(OrchestrationEngineService)({
      readEvents: () => Stream.empty,
      dispatch,
      streamDomainEvents: Stream.empty,
      subscribeDomainEvents: PubSub.subscribe(eventBus).pipe(
        Effect.map((subscription) =>
          Stream.fromSubscription(subscription).pipe(
            Stream.tap(() => Queue.offer(consumedEvents, undefined)),
          ),
        ),
      ),
      latestSequence: Effect.succeed(0),
    }),
    Layer.succeed(
      ServerSettingsService,
      ServerSettingsService.of({
        start: Effect.void,
        ready: Effect.void,
        getSettings: Effect.succeed({
          ...DEFAULT_SERVER_SETTINGS,
          enableAgentOrchestration: true,
          ...options.settings,
        }),
        updateSettings: () => Effect.die("updateSettings not used in this test"),
        streamChanges: Stream.empty,
        subscribeChanges: Effect.succeed(Stream.empty),
      }),
    ),
    Layer.succeed(ServerActivation, Deferred.await(activation)),
    Layer.succeed(Crypto.Crypto, testCrypto),
  );

  let sequence = 0;
  return {
    activation,
    eventBus,
    threads,
    commands,
    consumedEvents,
    publishSessionSet: (threadId: ThreadId, session: OrchestrationSession) =>
      PubSub.publish(eventBus, sessionSetEvent(threadId, session, ++sequence)),
    layer: WorkerCompletionReactor.layer.pipe(Layer.provide(dependencies)),
  };
});

const turnStarts = (commands: ReadonlyArray<OrchestrationCommand>) =>
  commands.filter(
    (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
      command.type === "thread.turn.start",
  );

/** Publish an event, wait until the consumer pulled it, then drain processing. */
const publishAndSettle = (
  fixture: Effect.Success<ReturnType<typeof makeHarness>>,
  reactor: WorkerCompletionReactor.WorkerCompletionReactor["Service"],
  threadId: ThreadId,
  session: OrchestrationSession,
) =>
  fixture
    .publishSessionSet(threadId, session)
    .pipe(
      Effect.andThen(Queue.take(fixture.consumedEvents)),
      Effect.andThen(Effect.yieldNow),
      Effect.andThen(reactor.drain),
    );

describe("WorkerCompletionReactor", () => {
  it.effect("queues a result report into the parent when a worker turn completes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const parent = makeThread(PARENT_ID, { title: "Orchestrator" });
        const worker = makeThread(WORKER_ID, {
          title: "worker: add badge",
          parentThreadId: PARENT_ID,
        });
        const fixture = yield* makeHarness({ threads: [parent, worker] });
        yield* Effect.gen(function* () {
          const reactor = yield* WorkerCompletionReactor.WorkerCompletionReactor;
          yield* reactor.start();
          yield* Deferred.succeed(fixture.activation, undefined);

          yield* publishAndSettle(
            fixture,
            reactor,
            WORKER_ID,
            makeSession({ status: "running", activeTurnId: TURN_ID }),
          );
          assert.deepStrictEqual(yield* Ref.get(fixture.commands), []);

          yield* publishAndSettle(
            fixture,
            reactor,
            WORKER_ID,
            makeSession({ status: "ready", activeTurnId: null }),
          );

          const commands = yield* Ref.get(fixture.commands);
          const starts = turnStarts(commands);
          assert.strictEqual(starts.length, 1);
          assert.strictEqual(starts[0]!.threadId, PARENT_ID);
          assert.strictEqual(starts[0]!.delivery, "queue");
          assert.strictEqual(starts[0]!.runtimeMode, "full-access");
          assert.match(starts[0]!.message.text, /<worker_result threadId="worker"/);
          assert.match(starts[0]!.message.text, /finished a turn: completed/);
          assert.match(starts[0]!.message.text, /Done — added the queue badge/);
        }).pipe(Effect.provide(fixture.layer));
      }),
    ),
  );

  it.effect("ignores threads with no orchestrator and parents that are settled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settledParent = makeThread(PARENT_ID, {
          title: "Settled orchestrator",
          settledOverride: "settled",
          settledAt: NOW,
        });
        const worker = makeThread(WORKER_ID, { parentThreadId: PARENT_ID });
        const loneThread = makeThread(ThreadId.make("lone"), {});
        const fixture = yield* makeHarness({ threads: [settledParent, worker, loneThread] });
        yield* Effect.gen(function* () {
          const reactor = yield* WorkerCompletionReactor.WorkerCompletionReactor;
          yield* reactor.start();
          yield* Deferred.succeed(fixture.activation, undefined);

          // Worker under a settled orchestrator: no wake.
          yield* publishAndSettle(
            fixture,
            reactor,
            WORKER_ID,
            makeSession({ status: "running", activeTurnId: TURN_ID }),
          );
          yield* publishAndSettle(
            fixture,
            reactor,
            WORKER_ID,
            makeSession({ status: "ready", activeTurnId: null }),
          );
          // A standalone thread settling: never a report.
          yield* publishAndSettle(
            fixture,
            reactor,
            ThreadId.make("lone"),
            makeSession({
              threadId: ThreadId.make("lone"),
              status: "running",
              activeTurnId: TURN_ID,
            }),
          );
          yield* publishAndSettle(
            fixture,
            reactor,
            ThreadId.make("lone"),
            makeSession({
              threadId: ThreadId.make("lone"),
              status: "ready",
              activeTurnId: null,
            }),
          );
          assert.deepStrictEqual(yield* Ref.get(fixture.commands), []);
        }).pipe(Effect.provide(fixture.layer));
      }),
    ),
  );

  it.effect("does not report session writes without an active turn transition", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const parent = makeThread(PARENT_ID, {});
        const worker = makeThread(WORKER_ID, { parentThreadId: PARENT_ID });
        const fixture = yield* makeHarness({ threads: [parent, worker] });
        yield* Effect.gen(function* () {
          const reactor = yield* WorkerCompletionReactor.WorkerCompletionReactor;
          yield* reactor.start();
          yield* Deferred.succeed(fixture.activation, undefined);

          // No turn was ever active — a bare idle session-set reports nothing.
          yield* publishAndSettle(
            fixture,
            reactor,
            WORKER_ID,
            makeSession({ status: "ready", activeTurnId: null }),
          );
          assert.deepStrictEqual(yield* Ref.get(fixture.commands), []);
        }).pipe(Effect.provide(fixture.layer));
      }),
    ),
  );

  it.effect("respects the orchestration setting", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const parent = makeThread(PARENT_ID, {});
        const worker = makeThread(WORKER_ID, { parentThreadId: PARENT_ID });
        const fixture = yield* makeHarness({
          threads: [parent, worker],
          settings: { enableAgentOrchestration: false },
        });
        yield* Effect.gen(function* () {
          const reactor = yield* WorkerCompletionReactor.WorkerCompletionReactor;
          yield* reactor.start();
          yield* Deferred.succeed(fixture.activation, undefined);

          yield* publishAndSettle(
            fixture,
            reactor,
            WORKER_ID,
            makeSession({ status: "running", activeTurnId: TURN_ID }),
          );
          yield* publishAndSettle(
            fixture,
            reactor,
            WORKER_ID,
            makeSession({ status: "ready", activeTurnId: null }),
          );
          assert.deepStrictEqual(yield* Ref.get(fixture.commands), []);
        }).pipe(Effect.provide(fixture.layer));
      }),
    ),
  );

  it.effect("reports each settled turn once across repeated idle writes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const parent = makeThread(PARENT_ID, {});
        const worker = makeThread(WORKER_ID, { parentThreadId: PARENT_ID });
        const fixture = yield* makeHarness({ threads: [parent, worker] });
        yield* Effect.gen(function* () {
          const reactor = yield* WorkerCompletionReactor.WorkerCompletionReactor;
          yield* reactor.start();
          yield* Deferred.succeed(fixture.activation, undefined);

          const turn2 = TurnId.make("turn-2");
          yield* publishAndSettle(
            fixture,
            reactor,
            WORKER_ID,
            makeSession({ status: "running", activeTurnId: TURN_ID }),
          );
          yield* publishAndSettle(
            fixture,
            reactor,
            WORKER_ID,
            makeSession({ status: "ready", activeTurnId: null }),
          );
          // Duplicate idle write for the same settled turn: still one report.
          yield* publishAndSettle(
            fixture,
            reactor,
            WORKER_ID,
            makeSession({ status: "ready", activeTurnId: null }),
          );
          yield* publishAndSettle(
            fixture,
            reactor,
            WORKER_ID,
            makeSession({ status: "running", activeTurnId: turn2 }),
          );
          yield* publishAndSettle(
            fixture,
            reactor,
            WORKER_ID,
            makeSession({ status: "error", activeTurnId: null, lastError: "boom" }),
          );

          const starts = turnStarts(yield* Ref.get(fixture.commands));
          assert.strictEqual(starts.length, 2);
          assert.match(starts[0]!.message.text, /turnState="completed"/);
          assert.match(starts[1]!.message.text, /turnState="error"/);
          assert.match(starts[1]!.message.text, /Last error: boom/);
        }).pipe(Effect.provide(fixture.layer));
      }),
    ),
  );
});
