import {
  CommandId,
  isProviderAvailable,
  MessageId,
  type OrchestrationThreadShell,
  type ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectSetupScriptRunner from "../../../project/ProjectSetupScriptRunner.ts";
import * as ProviderRegistry from "../../../provider/Services/ProviderRegistry.ts";
import {
  MAX_CHILD_THREADS,
  type OrchestrationThreadSummary,
  ThreadsToolkit,
  ThreadOrchestrationChildLimitError,
  ThreadOrchestrationCommandFailedError,
  ThreadOrchestrationModelNotFoundError,
  ThreadOrchestrationNotFoundError,
  ThreadOrchestrationNotWorkerError,
  ThreadOrchestrationProjectNotFoundError,
  ThreadOrchestrationProviderUnavailableError,
  ThreadOrchestrationReadFailedError,
  ThreadOrchestrationSpawnFailedError,
} from "./tools.ts";

const MAX_READ_THREAD_TURNS = 10;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_RECENT_MESSAGES = 10;
const MAX_RECENT_ACTIVITIES = 15;
const DEFAULT_WAIT_SECONDS = 120;
const WAIT_POLL_INTERVAL = "2 seconds";

const isBusy = (thread: OrchestrationThreadShell): boolean =>
  thread.session !== null &&
  (thread.session.status === "starting" ||
    thread.session.status === "running" ||
    thread.session.activeTurnId !== null ||
    (thread.queuedTurns?.length ?? 0) > 0);

const cutText = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** What the tools report per thread; mirrors OrchestrationThreadSummary in tools.ts. */
export function summarizeThread(thread: OrchestrationThreadShell): OrchestrationThreadSummary {
  return {
    threadId: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    providerInstanceId: thread.modelSelection.instanceId ?? null,
    model: thread.modelSelection.model ?? null,
    status: thread.session?.status ?? "none",
    busy: isBusy(thread),
    parentThreadId: thread.parentThreadId ?? null,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    latestTurnState: thread.latestTurn?.state ?? null,
    lastError: thread.session?.lastError ?? null,
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
    updatedAt: thread.updatedAt,
  };
}

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const setupScriptRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const crypto = yield* Crypto.Crypto;

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const newUuid = crypto.randomUUIDv4.pipe(Effect.orDie);
  const newCommandId = (tag: string, threadId: ThreadId) =>
    newUuid.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${threadId}:${uuid}`)));

  const scope = () => McpInvocationContext.requireMcpCapability("threads");

  const callerThread = Effect.gen(function* () {
    const invocation = yield* scope();
    const thread = yield* snapshots
      .getThreadShellById(invocation.threadId)
      .pipe(Effect.mapError((cause) => new ThreadOrchestrationReadFailedError({ cause })));
    if (Option.isNone(thread)) {
      return yield* new ThreadOrchestrationNotFoundError({ threadId: invocation.threadId });
    }
    return { invocation, thread: thread.value };
  });

  // Shell snapshots hold active threads only — archived rows are excluded by
  // the query, deleted rows never make it in.
  const liveWorkersOf = (threads: ReadonlyArray<OrchestrationThreadShell>, parentId: ThreadId) =>
    threads.filter((thread) => thread.parentThreadId === parentId && thread.archivedAt === null);

  /** Write operations only apply to threads this orchestrator spawned. */
  const requireWorker = Effect.fn("ThreadsToolkit.requireWorker")(function* (threadId: ThreadId) {
    const { invocation } = yield* callerThread;
    const shell = yield* snapshots
      .getThreadShellById(threadId)
      .pipe(Effect.mapError((cause) => new ThreadOrchestrationReadFailedError({ cause })));
    if (Option.isNone(shell)) {
      return yield* new ThreadOrchestrationNotFoundError({ threadId });
    }
    if (shell.value.parentThreadId !== invocation.threadId) {
      return yield* new ThreadOrchestrationNotWorkerError({ threadId });
    }
    return shell.value;
  });

  /**
   * A rejected invariant (already archived, already stopped) reads to the
   * agent as "the state it asked for" — not an error worth failing on.
   */
  const dispatchCommand = <A>(command: Parameters<typeof engine.dispatch>[0], onSuccess: A) =>
    engine.dispatch(command).pipe(
      Effect.as(onSuccess),
      Effect.catchTags({
        OrchestrationCommandInvariantError: () => Effect.succeed(onSuccess),
      }),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause as Cause.Cause<never>)
          : Effect.fail(new ThreadOrchestrationCommandFailedError({ cause })),
      ),
    );

  const resolveUsableProvider = Effect.fn("ThreadsToolkit.resolveProvider")(function* (
    instanceId: string,
    model: string,
  ) {
    const entries = yield* providers.getProviders.pipe(
      Effect.mapError((cause) => new ThreadOrchestrationReadFailedError({ cause })),
    );
    const provider = entries.find((entry) => entry.instanceId === instanceId);
    if (
      provider === undefined ||
      provider.enabled !== true ||
      provider.installed !== true ||
      !isProviderAvailable(provider)
    ) {
      return yield* new ThreadOrchestrationProviderUnavailableError({
        providerInstanceId: instanceId,
      });
    }
    if (provider.models.length > 0 && !provider.models.some((entry) => entry.slug === model)) {
      return yield* new ThreadOrchestrationModelNotFoundError({
        providerInstanceId: instanceId,
        model,
        availableModels: provider.models.map((entry) => entry.slug),
      });
    }
    return provider;
  });

  return ThreadsToolkit.of({
    get_orchestration_context: () =>
      Effect.gen(function* () {
        const { invocation, thread } = yield* callerThread;
        const snapshot = yield* snapshots
          .getShellSnapshot()
          .pipe(Effect.mapError((cause) => new ThreadOrchestrationReadFailedError({ cause })));
        return {
          threadId: invocation.threadId,
          projectId: thread.projectId,
          title: thread.title,
          model: thread.modelSelection.model ?? null,
          providerInstanceId: thread.modelSelection.instanceId ?? null,
          capabilities: [...invocation.capabilities],
          workers: liveWorkersOf(snapshot.threads, invocation.threadId).map(summarizeThread),
        };
      }),

    list_projects: () =>
      Effect.gen(function* () {
        yield* scope();
        const snapshot = yield* snapshots
          .getShellSnapshot()
          .pipe(Effect.mapError((cause) => new ThreadOrchestrationReadFailedError({ cause })));
        return {
          projects: snapshot.projects.map((project) => ({
            projectId: project.id,
            title: project.title,
            workspaceRoot: project.workspaceRoot,
          })),
        };
      }),

    list_providers: () =>
      Effect.gen(function* () {
        yield* scope();
        const entries = yield* providers.getProviders.pipe(
          Effect.mapError((cause) => new ThreadOrchestrationReadFailedError({ cause })),
        );
        return {
          providers: entries.map((provider) => ({
            instanceId: provider.instanceId,
            driver: provider.driver,
            displayName: provider.displayName ?? null,
            available:
              provider.enabled === true &&
              provider.installed === true &&
              isProviderAvailable(provider),
            status: provider.status,
            models: provider.models.map((model) => ({
              slug: model.slug,
              name: model.name,
              isDefault: model.isDefault ?? false,
            })),
          })),
        };
      }),

    list_threads: (input) =>
      Effect.gen(function* () {
        const { thread } = yield* callerThread;
        const snapshot = yield* snapshots
          .getShellSnapshot()
          .pipe(Effect.mapError((cause) => new ThreadOrchestrationReadFailedError({ cause })));
        const projectId = (input.projectId ?? thread.projectId) as ProjectId;
        return {
          threads: snapshot.threads
            .filter((entry) => entry.projectId === projectId && entry.archivedAt === null)
            .map(summarizeThread),
        };
      }),

    read_thread: (input) =>
      Effect.gen(function* () {
        yield* scope();
        const [shell, detail] = yield* Effect.all([
          snapshots.getThreadShellById(input.threadId),
          snapshots.getThreadDetailSnapshot(input.threadId, {
            turnLimit: Math.min(input.turnLimit ?? MAX_READ_THREAD_TURNS, MAX_READ_THREAD_TURNS),
          }),
        ]).pipe(Effect.mapError((cause) => new ThreadOrchestrationReadFailedError({ cause })));
        if (Option.isNone(detail) || detail.value.thread.deletedAt !== null) {
          return yield* new ThreadOrchestrationNotFoundError({ threadId: input.threadId });
        }
        const thread = detail.value.thread;
        return {
          thread: Option.match(shell, {
            onNone: () => ({
              threadId: thread.id,
              projectId: thread.projectId,
              title: thread.title,
              providerInstanceId: thread.modelSelection.instanceId ?? null,
              model: thread.modelSelection.model ?? null,
              status: thread.session?.status ?? "none",
              busy: false,
              parentThreadId: thread.parentThreadId ?? null,
              branch: thread.branch,
              worktreePath: thread.worktreePath,
              latestTurnState: thread.latestTurn?.state ?? null,
              lastError: thread.session?.lastError ?? null,
              hasPendingApprovals: false,
              hasPendingUserInput: false,
              updatedAt: thread.updatedAt,
            }),
            onSome: summarizeThread,
          }),
          messages: thread.messages.slice(-MAX_RECENT_MESSAGES).map((message) => ({
            role: message.role,
            text: cutText(message.text, MAX_MESSAGE_CHARS),
            createdAt: message.createdAt,
          })),
          activities: thread.activities.slice(-MAX_RECENT_ACTIVITIES).map((activity) => ({
            kind: activity.kind,
            summary: cutText(activity.summary, 500),
            tone: activity.tone,
            createdAt: activity.createdAt,
          })),
          pullRequestUrls: thread.pullRequests.map((link) => link.url),
        };
      }),

    spawn_thread: (input) =>
      Effect.gen(function* () {
        const { invocation, thread: caller } = yield* callerThread;
        const snapshot = yield* snapshots
          .getShellSnapshot()
          .pipe(Effect.mapError((cause) => new ThreadOrchestrationSpawnFailedError({ cause })));

        const workers = liveWorkersOf(snapshot.threads, invocation.threadId);
        if (workers.length >= MAX_CHILD_THREADS) {
          return yield* new ThreadOrchestrationChildLimitError({ limit: MAX_CHILD_THREADS });
        }

        const projectId = (input.projectId ?? caller.projectId) as ProjectId;
        const project = snapshot.projects.find((entry) => entry.id === projectId);
        if (project === undefined) {
          return yield* new ThreadOrchestrationProjectNotFoundError({ projectId });
        }
        yield* resolveUsableProvider(input.providerInstanceId, input.model);

        const workerThreadId = ThreadId.make(yield* newUuid);
        const createdAt = yield* nowIso;

        const spawnFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause as Cause.Cause<never>)
                : Effect.fail(new ThreadOrchestrationSpawnFailedError({ cause })),
            ),
          );

        yield* spawnFailure(
          engine.dispatch({
            type: "thread.create",
            commandId: yield* newCommandId("mcp-thread-spawn", workerThreadId),
            threadId: workerThreadId,
            projectId,
            title: input.title,
            modelSelection: { instanceId: input.providerInstanceId, model: input.model },
            runtimeMode: input.runtimeMode ?? "full-access",
            interactionMode: input.interactionMode ?? "default",
            branch: caller.branch,
            worktreePath: null,
            createdAt,
            parentThreadId: invocation.threadId,
          }),
        );

        // A failure after thread.create would leave an empty parked worker
        // that still counts against the child cap — archive it on the way out.
        const cleaningSpawn = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : newCommandId("mcp-thread-cleanup", workerThreadId).pipe(
                    Effect.flatMap((commandId) =>
                      engine.dispatch({
                        type: "thread.archive",
                        commandId,
                        threadId: workerThreadId,
                      }),
                    ),
                    Effect.ignore,
                    Effect.andThen(Effect.failCause(cause)),
                  ),
            ),
            spawnFailure,
          );

        let worktreePath: string | null = null;
        if (input.isolateWorktree === true) {
          const baseRef = input.baseBranch ?? caller.branch ?? "HEAD";
          const branchUuid = yield* newUuid;
          const worktree = yield* cleaningSpawn(
            gitWorkflow.createWorktree({
              cwd: project.workspaceRoot,
              refName: baseRef,
              newRefName: buildTemporaryWorktreeBranchName(() => branchUuid),
              baseRefName: baseRef,
              path: null,
            }),
          );
          worktreePath = worktree.worktree.path;
          yield* cleaningSpawn(
            engine.dispatch({
              type: "thread.meta.update",
              commandId: yield* newCommandId("mcp-thread-worktree", workerThreadId),
              threadId: workerThreadId,
              branch: worktree.worktree.refName,
              worktreePath,
            }),
          );
          if (input.runSetupScript !== false) {
            yield* setupScriptRunner
              .runForThread({
                threadId: workerThreadId,
                projectId,
                projectCwd: project.workspaceRoot,
                worktreePath,
              })
              .pipe(
                Effect.catch((error) =>
                  Effect.logWarning("worker setup script failed to launch", {
                    threadId: workerThreadId,
                    error: error.message,
                  }),
                ),
              );
          }
        }

        yield* cleaningSpawn(
          engine.dispatch({
            type: "thread.turn.start",
            commandId: yield* newCommandId("mcp-thread-first-turn", workerThreadId),
            threadId: workerThreadId,
            message: {
              messageId: MessageId.make(yield* newUuid),
              role: "user",
              text: input.prompt,
              attachments: [],
            },
            runtimeMode: input.runtimeMode ?? "full-access",
            interactionMode: input.interactionMode ?? "default",
            createdAt: yield* nowIso,
          }),
        );

        return { threadId: workerThreadId, title: input.title, worktreePath };
      }),

    send_thread_message: (input) =>
      Effect.gen(function* () {
        const worker = yield* requireWorker(input.threadId);
        const delivery = input.delivery ?? "queue";
        return yield* dispatchCommand(
          {
            type: "thread.turn.start",
            commandId: yield* newCommandId("mcp-thread-message", input.threadId),
            threadId: input.threadId,
            message: {
              messageId: MessageId.make(yield* newUuid),
              role: "user",
              text: input.text,
              attachments: [],
            },
            delivery,
            // Only a bootstrap default on existing threads — the decider keeps
            // the worker's own stored modes for turn starts.
            runtimeMode: worker.runtimeMode,
            interactionMode: worker.interactionMode,
            createdAt: yield* nowIso,
          },
          { threadId: input.threadId, delivery },
        );
      }),

    wait_for_threads: (input) =>
      Effect.gen(function* () {
        yield* scope();
        const targets = new Set<ThreadId>(input.threadIds);
        const nowMillis = Effect.map(DateTime.now, (dt) => dt.epochMilliseconds);
        const deadlineMillis =
          (yield* nowMillis) + (input.timeoutSeconds ?? DEFAULT_WAIT_SECONDS) * 1000;

        const summariesFor = Effect.gen(function* () {
          const snapshot = yield* snapshots
            .getShellSnapshot()
            .pipe(Effect.mapError((cause) => new ThreadOrchestrationReadFailedError({ cause })));
          return snapshot.threads.filter((entry) => targets.has(entry.id)).map(summarizeThread);
        });

        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            // Subscribe before the first check so an idle transition landing
            // between the two is still observed.
            const events = yield* engine.subscribeDomainEvents;
            const mailbox = yield* Stream.toQueue(
              events.pipe(Stream.filter((event) => targets.has(event.aggregateId as ThreadId))),
              { capacity: "unbounded" },
            );
            let summaries = yield* summariesFor;
            while (summaries.some((entry) => entry.busy) && (yield* nowMillis) < deadlineMillis) {
              // The heartbeat covers projection lag: an event wakes the loop
              // fast, the sleep guarantees a re-check even if one was missed.
              yield* Effect.race(Queue.take(mailbox), Effect.sleep(WAIT_POLL_INTERVAL)).pipe(
                Effect.ignore,
              );
              summaries = yield* summariesFor;
            }
            return summaries;
          }),
        );

        return {
          timedOut: result.some((entry) => entry.busy),
          threads: result,
        };
      }),

    interrupt_thread: (input) =>
      Effect.gen(function* () {
        yield* requireWorker(input.threadId);
        return yield* dispatchCommand(
          {
            type: "thread.session.stop",
            commandId: yield* newCommandId("mcp-thread-interrupt", input.threadId),
            threadId: input.threadId,
            createdAt: yield* nowIso,
          },
          { threadId: input.threadId },
        );
      }),

    archive_thread: (input) =>
      Effect.gen(function* () {
        yield* requireWorker(input.threadId);
        return yield* dispatchCommand(
          {
            type: "thread.archive",
            commandId: yield* newCommandId("mcp-thread-archive", input.threadId),
            threadId: input.threadId,
          },
          { threadId: input.threadId },
        );
      }),

    rename_thread: (input) =>
      Effect.gen(function* () {
        yield* requireWorker(input.threadId);
        return yield* dispatchCommand(
          {
            type: "thread.meta.update",
            commandId: yield* newCommandId("mcp-thread-rename", input.threadId),
            threadId: input.threadId,
            title: input.title,
          },
          { threadId: input.threadId },
        );
      }),
  });
});

export const ThreadsToolkitHandlersLive = ThreadsToolkit.toLayer(make);
