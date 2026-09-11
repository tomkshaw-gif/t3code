import {
  CheckpointRef,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as CheckpointDiffQuery from "../../../checkpointing/CheckpointDiffQuery.ts";
import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import * as ProjectSetupScriptRunner from "../../../project/ProjectSetupScriptRunner.ts";
import * as ProviderRegistry from "../../../provider/Services/ProviderRegistry.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ThreadsToolkitHandlersLive } from "./handlers.ts";
import { MAX_CHILD_THREADS, ThreadsToolkit } from "./tools.ts";

const PROJECT_ID = ProjectId.make("project-1");
const ORCHESTRATOR_ID = ThreadId.make("thread-orchestrator");
const WORKER_ID = ThreadId.make("thread-worker");
const PROVIDER_INSTANCE_ID = ProviderInstanceId.make("codex");

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(7),
  digest: (_algorithm, data) => Effect.succeed(data),
});

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
  threadId: ThreadId = ORCHESTRATOR_ID,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId,
  providerSessionId: "provider-session-1",
  providerInstanceId: PROVIDER_INSTANCE_ID,
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

function makeProject(): OrchestrationProjectShell {
  return {
    id: PROJECT_ID,
    title: "Project",
    workspaceRoot: "/workspace/project",
    defaultModelSelection: null,
    scripts: [],
    repositoryIdentity: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function makeThread(
  overrides: Partial<OrchestrationThreadShell> & Pick<OrchestrationThreadShell, "id">,
): OrchestrationThreadShell {
  return {
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: { instanceId: PROVIDER_INSTANCE_ID, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: null,
    parentThreadId: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: "2026-08-20T00:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function makeProvider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: PROVIDER_INSTANCE_ID,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-01T00:00:00.000Z",
    availability: "available",
    models: [
      {
        slug: "gpt-5",
        name: "GPT-5",
        isCustom: false,
        isDefault: true,
        capabilities: null,
      },
    ],
    ...overrides,
  } as ServerProvider;
}

function makeDetail(
  shell: OrchestrationThreadShell,
  overrides: Partial<OrchestrationThread> = {},
): OrchestrationThreadDetailSnapshot {
  return {
    snapshotSequence: 0,
    thread: {
      ...shell,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: shell.session,
      ...overrides,
    },
  };
}

interface HarnessOptions {
  readonly threads?: ReadonlyArray<OrchestrationThreadShell>;
  readonly details?: ReadonlyMap<ThreadId, Partial<OrchestrationThread>>;
  readonly providerList?: ReadonlyArray<ServerProvider>;
  readonly worktreePath?: string;
}

const makeHarness = Effect.fn("makeThreadsToolkitHarness")(function* (
  options: HarnessOptions = {},
) {
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  const worktrees = yield* Ref.make<ReadonlyArray<{ cwd: string; refName: string }>>([]);
  const threads =
    options.threads === undefined
      ? [makeThread({ id: ORCHESTRATOR_ID, title: "Orchestrator" })]
      : options.threads;
  const project = makeProject();
  const eventBus = yield* PubSub.unbounded<OrchestrationEvent>();

  const dispatch: OrchestrationEngineShape["dispatch"] = (command) =>
    Ref.update(commands, (recorded) => [...recorded, command]).pipe(Effect.as({ sequence: 1 }));

  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getShellSnapshot: () =>
        Effect.succeed({
          snapshotSequence: 0,
          projects: [project],
          threads: [...threads],
          updatedAt: "2026-08-20T00:00:00.000Z",
        }),
      getThreadShellById: (threadId: ThreadId) =>
        Effect.succeed(Option.fromNullishOr(threads.find((t) => t.id === threadId) ?? null)),
      getThreadDetailSnapshot: (threadId: ThreadId) =>
        Effect.succeed(
          Option.fromNullishOr(
            threads
              .filter((t) => t.id === threadId)
              .map((t) => makeDetail(t, options.details?.get(threadId) ?? {}))
              .at(0) ?? null,
          ),
        ),
    }),
    Layer.mock(OrchestrationEngineService)({
      readEvents: () => Stream.empty,
      dispatch,
      streamDomainEvents: Stream.empty,
      subscribeDomainEvents: PubSub.subscribe(eventBus).pipe(Effect.map(Stream.fromSubscription)),
      latestSequence: Effect.succeed(0),
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({
      getProviders: Effect.succeed(options.providerList ?? [makeProvider()]),
    }),
    Layer.mock(GitWorkflowService.GitWorkflowService)({
      createWorktree: (input: { cwd: string; refName: string }) =>
        Ref.update(worktrees, (recorded) => [
          ...recorded,
          { cwd: input.cwd, refName: input.refName },
        ]).pipe(
          Effect.as({
            worktree: {
              path: options.worktreePath ?? "/workspace/worker-wt",
              refName: input.refName,
            },
          }),
        ),
    }),
    Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
      runForThread: () => Effect.succeed({ status: "no-script" }),
    }),
    Layer.mock(CheckpointDiffQuery.CheckpointDiffQuery)({
      getFullThreadDiff: (input: { threadId: ThreadId; toTurnCount: number }) =>
        Effect.succeed({
          threadId: input.threadId,
          fromTurnCount: 0,
          toTurnCount: input.toTurnCount,
          diff: "diff --git a/x.ts b/x.ts\n+change\n",
        }),
    }),
    Layer.succeed(Crypto.Crypto, testCrypto),
  );

  const toolkit = yield* ThreadsToolkit.pipe(
    Effect.provide(ThreadsToolkitHandlersLive.pipe(Layer.provide(dependencies))),
  );
  const call = <Name extends keyof typeof ThreadsToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["threads"],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof ThreadsToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
      Effect.provide(dependencies),
    );
  return { commands, worktrees, eventBus, call };
});

describe("threads toolkit", () => {
  it.effect("refuses a credential without the threads capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness.call("list_threads", {}, ["preview"]).pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "McpCapabilityUnavailableError",
        capability: "threads",
        threadId: ORCHESTRATOR_ID,
      });
      expect(yield* Ref.get(harness.commands)).toEqual([]);
    }),
  );

  it.effect("reports the orchestrator's live workers in context", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        threads: [
          makeThread({ id: ORCHESTRATOR_ID, title: "Orchestrator" }),
          makeThread({ id: WORKER_ID, title: "Worker", parentThreadId: ORCHESTRATOR_ID }),
          makeThread({ id: ThreadId.make("thread-other"), title: "Unrelated" }),
        ],
      });
      const result = yield* harness.call("get_orchestration_context", {});
      expect(result.threadId).toBe(ORCHESTRATOR_ID);
      expect(result.workers.map((w) => w.threadId)).toEqual([WORKER_ID]);
    }),
  );

  it.effect("spawns a worker with parentThreadId and sends the first turn", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("spawn_thread", {
        title: "worker: audit auth",
        prompt: "Audit the auth module.",
        providerInstanceId: PROVIDER_INSTANCE_ID,
        model: "gpt-5",
      });
      const commands = yield* Ref.get(harness.commands);
      expect(commands).toMatchObject([
        {
          type: "thread.create",
          threadId: result.threadId,
          projectId: PROJECT_ID,
          title: "worker: audit auth",
          parentThreadId: ORCHESTRATOR_ID,
        },
        {
          type: "thread.turn.start",
          threadId: result.threadId,
          message: { role: "user", text: "Audit the auth module." },
        },
      ]);
      expect(result.worktreePath).toBeNull();
    }),
  );

  it.effect("isolates a worker in a worktree when asked", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("spawn_thread", {
        title: "worker: fix tests",
        prompt: "Fix the failing tests.",
        providerInstanceId: PROVIDER_INSTANCE_ID,
        model: "gpt-5",
        isolateWorktree: true,
      });
      expect(result.worktreePath).toBe("/workspace/worker-wt");
      expect(yield* Ref.get(harness.worktrees)).toMatchObject([
        { cwd: "/workspace/project", refName: "main" },
      ]);
      const commands = yield* Ref.get(harness.commands);
      expect(commands).toMatchObject([
        { type: "thread.create", threadId: result.threadId },
        {
          type: "thread.meta.update",
          threadId: result.threadId,
          worktreePath: "/workspace/worker-wt",
        },
        { type: "thread.turn.start", threadId: result.threadId },
      ]);
    }),
  );

  it.effect("refuses to spawn past the live-worker cap", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        threads: [
          makeThread({ id: ORCHESTRATOR_ID }),
          ...Array.from({ length: MAX_CHILD_THREADS }, (_, index) =>
            makeThread({
              id: ThreadId.make(`thread-worker-${index}`),
              parentThreadId: ORCHESTRATOR_ID,
            }),
          ),
        ],
      });
      const error = yield* harness
        .call("spawn_thread", {
          title: "worker: over cap",
          prompt: "x",
          providerInstanceId: PROVIDER_INSTANCE_ID,
          model: "gpt-5",
        })
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "ThreadOrchestrationChildLimitError",
        limit: MAX_CHILD_THREADS,
      });
      expect(yield* Ref.get(harness.commands)).toEqual([]);
    }),
  );

  it.effect("rejects an unavailable provider instance before creating anything", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        providerList: [makeProvider({ enabled: false })],
      });
      const error = yield* harness
        .call("spawn_thread", {
          title: "worker: no provider",
          prompt: "x",
          providerInstanceId: PROVIDER_INSTANCE_ID,
          model: "gpt-5",
        })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "ThreadOrchestrationProviderUnavailableError" });
      expect(yield* Ref.get(harness.commands)).toEqual([]);
    }),
  );

  it.effect("queues a follow-up message to an owned worker by default", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        threads: [
          makeThread({ id: ORCHESTRATOR_ID }),
          makeThread({ id: WORKER_ID, parentThreadId: ORCHESTRATOR_ID }),
        ],
      });
      const result = yield* harness.call("send_thread_message", {
        threadId: WORKER_ID,
        text: "Also check the migration file.",
      });
      expect(result).toEqual({ threadId: WORKER_ID, delivery: "queue" });
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        {
          type: "thread.turn.start",
          threadId: WORKER_ID,
          delivery: "queue",
          message: { text: "Also check the migration file." },
        },
      ]);
    }),
  );

  it.effect("refuses to message a thread it did not spawn", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        threads: [
          makeThread({ id: ORCHESTRATOR_ID }),
          makeThread({ id: WORKER_ID, parentThreadId: ThreadId.make("thread-other") }),
        ],
      });
      const error = yield* harness
        .call("send_thread_message", { threadId: WORKER_ID, text: "hi" })
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "ThreadOrchestrationNotWorkerError",
        threadId: WORKER_ID,
      });
      expect(yield* Ref.get(harness.commands)).toEqual([]);
    }),
  );

  it.effect("wait_for_threads returns immediately when targets are idle", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        threads: [
          makeThread({ id: ORCHESTRATOR_ID }),
          makeThread({ id: WORKER_ID, parentThreadId: ORCHESTRATOR_ID }),
        ],
      });
      const result = yield* harness.call("wait_for_threads", {
        threadIds: [WORKER_ID],
        timeoutSeconds: 5,
      });
      expect(result.timedOut).toBe(false);
      expect(result.threads).toMatchObject([{ threadId: WORKER_ID, busy: false }]);
    }),
  );

  // it.live: the wait loop's deadline is wall-clock; under it.effect's
  // TestClock neither the sleep nor DateTime.now advances.
  it.live("wait_for_threads reports busy targets at the deadline", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        threads: [
          makeThread({ id: ORCHESTRATOR_ID }),
          makeThread({
            id: WORKER_ID,
            parentThreadId: ORCHESTRATOR_ID,
            session: {
              threadId: WORKER_ID,
              status: "running",
              providerName: "Codex",
              providerInstanceId: PROVIDER_INSTANCE_ID,
              runtimeMode: "full-access",
              activeTurnId: TurnId.make("turn-1"),
              lastError: null,
              updatedAt: "2026-08-20T00:00:00.000Z",
            },
          }),
        ],
      });
      const result = yield* harness.call("wait_for_threads", {
        threadIds: [WORKER_ID],
        timeoutSeconds: 1,
      });
      expect(result.timedOut).toBe(true);
      expect(result.threads).toMatchObject([{ threadId: WORKER_ID, busy: true }]);
    }),
  );

  it.effect("archives and renames only threads it spawned", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        threads: [
          makeThread({ id: ORCHESTRATOR_ID }),
          makeThread({ id: WORKER_ID, parentThreadId: ORCHESTRATOR_ID }),
        ],
      });
      yield* harness.call("archive_thread", { threadId: WORKER_ID });
      yield* harness.call("rename_thread", { threadId: WORKER_ID, title: "worker: done" });
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        { type: "thread.archive", threadId: WORKER_ID },
        { type: "thread.meta.update", threadId: WORKER_ID, title: "worker: done" },
      ]);
    }),
  );

  it.effect("lists providers so the orchestrator can pick a worker target", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("list_providers", {});
      expect(result.providers).toMatchObject([
        {
          instanceId: PROVIDER_INSTANCE_ID,
          available: true,
          models: [{ slug: "gpt-5", isDefault: true }],
        },
      ]);
    }),
  );

  it.effect("returns the worker's full checkpoint diff", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        threads: [
          makeThread({ id: ORCHESTRATOR_ID }),
          makeThread({ id: WORKER_ID, parentThreadId: ORCHESTRATOR_ID }),
        ],
        details: new Map([
          [
            WORKER_ID,
            {
              checkpoints: [
                {
                  turnId: TurnId.make("turn-1"),
                  checkpointTurnCount: 1,
                  checkpointRef: CheckpointRef.make("refs/t3/checkpoint/1"),
                  status: "ready",
                  files: [],
                  assistantMessageId: null,
                  completedAt: "2026-08-20T00:00:00.000Z",
                },
              ],
            },
          ],
        ]),
      });
      const result = yield* harness.call("get_thread_diff", { threadId: WORKER_ID });
      expect(result).toMatchObject({
        threadId: WORKER_ID,
        toTurnCount: 1,
        diff: expect.stringContaining("diff --git"),
        truncated: false,
      });
    }),
  );

  it.effect("returns an empty diff for a thread with no checkpoints", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        threads: [
          makeThread({ id: ORCHESTRATOR_ID }),
          makeThread({ id: WORKER_ID, parentThreadId: ORCHESTRATOR_ID }),
        ],
      });
      const result = yield* harness.call("get_thread_diff", { threadId: WORKER_ID });
      expect(result).toMatchObject({ threadId: WORKER_ID, toTurnCount: 0, diff: "" });
    }),
  );

  it.effect("injects contextFromThreadIds digests into the worker's first prompt", () =>
    Effect.gen(function* () {
      const specThreadId = ThreadId.make("thread-spec");
      const harness = yield* makeHarness({
        threads: [
          makeThread({ id: ORCHESTRATOR_ID }),
          makeThread({ id: specThreadId, title: "spec thread" }),
        ],
        details: new Map([
          [
            specThreadId,
            {
              messages: [
                {
                  id: MessageId.make("m1"),
                  role: "user",
                  text: "The badge must sit beside the pin marker.",
                  turnId: null,
                  streaming: false,
                  createdAt: "2026-08-20T00:00:00.000Z",
                  updatedAt: "2026-08-20T00:00:00.000Z",
                },
              ],
            },
          ],
        ]),
      });
      const result = yield* harness.call("spawn_thread", {
        title: "worker: implement badge",
        prompt: "Implement the badge.",
        providerInstanceId: PROVIDER_INSTANCE_ID,
        model: "gpt-5",
        contextFromThreadIds: [specThreadId],
      });
      const turnStart = (yield* Ref.get(harness.commands)).find(
        (command) => command.type === "thread.turn.start",
      );
      expect(turnStart?.type === "thread.turn.start" ? turnStart.message.text : "").toContain(
        "The badge must sit beside the pin marker.",
      );
      expect(turnStart?.type === "thread.turn.start" ? turnStart.message.text : "").toContain(
        "Implement the badge.",
      );
      expect(turnStart?.type === "thread.turn.start" ? turnStart.message.text : "").toContain(
        "<orchestration_context>",
      );
      expect(result.threadId).toBeDefined();
    }),
  );
});
