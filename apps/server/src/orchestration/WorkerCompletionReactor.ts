import { CommandId, MessageId, type OrchestrationEvent, type TurnId } from "@t3tools/contracts";
import type { ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import { settledTurnStateForSessionStatus } from "./projector.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";

const MAX_RESULT_TEXT_CHARS = 1_500;

/**
 * Reports worker results back to the orchestrator that spawned them.
 *
 * A worker's `session.activeTurnId` going from set to null is the turn-end
 * signal. When that transition lands on a thread with a `parentThreadId`, the
 * reactor queues a result report into the parent's turn queue: a busy
 * orchestrator parks it behind its current turn, an idle one wakes up to
 * process it. That makes "delegate, end your turn, get woken when workers
 * finish" work without the orchestrator holding a wait_for_threads call open.
 */
export class WorkerCompletionReactor extends Context.Service<
  WorkerCompletionReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration/WorkerCompletionReactor") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;

  // Tracks each worker's in-flight turn so a null activeTurnId transition can
  // be tied to the turn that ended. Primed at start() from the shell snapshot
  // so workers mid-turn across a restart still report.
  const activeTurnByWorker = new Map<ThreadId, TurnId>();

  const reportWorker = Effect.fn("WorkerCompletionReactor.reportWorker")(function* (
    threadId: ThreadId,
    turnState: "completed" | "interrupted" | "error",
    lastError: string | null,
  ) {
    const settings = yield* settingsService.getSettings;
    if (!settings.enableAgentOrchestration) return;

    const workerOption = yield* snapshots.getThreadShellById(threadId);
    if (Option.isNone(workerOption)) return;
    const worker = workerOption.value;
    const parentThreadId = worker.parentThreadId;
    if (parentThreadId == null) return;

    const parentOption = yield* snapshots.getThreadShellById(parentThreadId);
    if (Option.isNone(parentOption)) return;
    const parent = parentOption.value;
    // A settled parent was parked deliberately — leave its result for when the
    // user re-engages it rather than waking it now.
    if (parent.settledOverride === "settled" || parent.settledAt !== null) return;

    const detailOption = yield* snapshots.getThreadDetailSnapshot(threadId, { turnLimit: 1 });
    const lastAssistantText = Option.match(detailOption, {
      onNone: () => null,
      onSome: (detail) => {
        const text = [...detail.thread.messages]
          .reverse()
          .find((message) => message.role === "assistant")?.text;
        return text === undefined
          ? null
          : text.length > MAX_RESULT_TEXT_CHARS
            ? `${text.slice(0, MAX_RESULT_TEXT_CHARS)}…`
            : text;
      },
    });

    const statusLines = [
      `Worker "${worker.title}" (thread ${worker.id}) finished a turn: ${turnState}.`,
    ];
    if (lastError !== null) {
      statusLines.push(`Last error: ${lastError}`);
    }
    if (worker.hasPendingUserInput) {
      statusLines.push(
        "It is waiting on a user-input question — read_thread it and relay the answer with send_thread_message.",
      );
    }
    if (worker.hasPendingApprovals) {
      statusLines.push(
        "It has pending approvals — the human approves those in the worker's thread.",
      );
    }
    const reportText = [
      `<worker_result threadId="${worker.id}" turnState="${turnState}">`,
      ...statusLines,
      lastAssistantText === null ? "" : `\n<result>\n${lastAssistantText}\n</result>`,
      `\nUse read_thread("${worker.id}") for the full transcript or get_thread_diff("${worker.id}") to inspect its changes.`,
      `</worker_result>`,
    ].join("\n");

    const uuid = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
    yield* engine
      .dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`server:worker-report:${worker.id}:${uuid}`),
        threadId: parentThreadId,
        message: {
          messageId: MessageId.make(uuid),
          role: "user",
          text: reportText,
          attachments: [],
        },
        delivery: "queue",
        runtimeMode: parent.runtimeMode,
        interactionMode: parent.interactionMode,
        createdAt: DateTime.formatIso(yield* DateTime.now),
      })
      .pipe(
        // The parent can legitimately be gone by the time a worker settles
        // (deleted, or its own session torn down) — the report just dies.
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("worker result report failed", {
                threadId: worker.id,
                parentThreadId,
                cause: Cause.pretty(cause),
              }),
        ),
      );
  });

  const worker = yield* makeDrainableWorker((event: OrchestrationEvent) =>
    Effect.gen(function* () {
      if (event.type !== "thread.session-set") return;
      const { threadId, session } = event.payload;
      if (session.activeTurnId !== null) {
        activeTurnByWorker.set(threadId, session.activeTurnId);
        return;
      }
      const endedTurnId = activeTurnByWorker.get(threadId);
      if (endedTurnId === undefined) return;
      activeTurnByWorker.delete(threadId);
      const turnState = settledTurnStateForSessionStatus(session.status);
      if (turnState === null) return;
      yield* reportWorker(threadId, turnState, session.lastError);
    }),
  );

  const start: WorkerCompletionReactor["Service"]["start"] = Effect.fn(
    "WorkerCompletionReactor.start",
  )(function* () {
    // Prime the active-turn map so a worker already mid-turn across a restart
    // still reports when it settles. Turns that ended before startup do not —
    // their result is already in the transcript.
    const snapshot = yield* snapshots.getShellSnapshot().pipe(Effect.orDie);
    for (const thread of snapshot.threads) {
      if (thread.parentThreadId !== null && thread.session?.activeTurnId != null) {
        activeTurnByWorker.set(thread.id, thread.session.activeTurnId);
      }
    }
    const events = yield* engine.subscribeDomainEvents;
    yield* forkParked(Stream.runForEach(events, worker.enqueue));
  });

  return { start, drain: worker.drain } satisfies WorkerCompletionReactor["Service"];
});

export const layer = Layer.effect(WorkerCompletionReactor, make);
