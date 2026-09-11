import {
  McpCapabilityUnavailableError,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ProviderInstanceId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  ThreadTurnDeliveryMode,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as CheckpointDiffQuery from "../../../checkpointing/CheckpointDiffQuery.ts";
import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectSetupScriptRunner from "../../../project/ProjectSetupScriptRunner.ts";
import * as ProviderRegistry from "../../../provider/Services/ProviderRegistry.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  OrchestrationEngine.OrchestrationEngineService,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
  ProviderRegistry.ProviderRegistry,
  GitWorkflowService.GitWorkflowService,
  ProjectSetupScriptRunner.ProjectSetupScriptRunner,
  CheckpointDiffQuery.CheckpointDiffQuery,
];

/** At most this many live workers may hang off one orchestrator thread. */
export const MAX_CHILD_THREADS = 8;
export const MAX_WAIT_SECONDS = 600;
const MAX_READ_THREAD_TURNS = 10;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_RECENT_MESSAGES = 10;
const MAX_RECENT_ACTIVITIES = 15;

const ORCHESTRATOR_RULES =
  "You are the orchestrator of this group: you plan, delegate, and review — you do not implement work yourself. " +
  "Spawn a worker thread per independent unit of work, prefer isolateWorktree for anything that edits files, " +
  "then use wait_for_threads and read_thread to collect results. Worker results also arrive on their own: " +
  "each time a worker turn ends, its result lands in your message queue, so you can end your turn and get " +
  "woken when work finishes. Review worker output with get_thread_diff before integrating it. You may only " +
  "message, rename, interrupt, or archive threads you spawned; spawned workers cannot spawn their own.";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ThreadOrchestrationNotFoundError extends Schema.TaggedError<ThreadOrchestrationNotFoundError>()(
  "ThreadOrchestrationNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found.`;
  }
}

export class ThreadOrchestrationProjectNotFoundError extends Schema.TaggedError<ThreadOrchestrationProjectNotFoundError>()(
  "ThreadOrchestrationProjectNotFoundError",
  { projectId: Schema.String },
) {
  override get message(): string {
    return `Project ${this.projectId} was not found or is deleted.`;
  }
}

export class ThreadOrchestrationNotWorkerError extends Schema.TaggedError<ThreadOrchestrationNotWorkerError>()(
  "ThreadOrchestrationNotWorkerError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} is not a worker of this thread — only threads you spawned can be driven.`;
  }
}

export class ThreadOrchestrationChildLimitError extends Schema.TaggedError<ThreadOrchestrationChildLimitError>()(
  "ThreadOrchestrationChildLimitError",
  { limit: Schema.Int },
) {
  override get message(): string {
    return `This thread already has ${this.limit} live workers. Archive or interrupt one first.`;
  }
}

export class ThreadOrchestrationProviderUnavailableError extends Schema.TaggedError<ThreadOrchestrationProviderUnavailableError>()(
  "ThreadOrchestrationProviderUnavailableError",
  { providerInstanceId: Schema.String },
) {
  override get message(): string {
    return `Provider instance ${this.providerInstanceId} is not available. Call list_providers for usable instances.`;
  }
}

export class ThreadOrchestrationModelNotFoundError extends Schema.TaggedError<ThreadOrchestrationModelNotFoundError>()(
  "ThreadOrchestrationModelNotFoundError",
  {
    providerInstanceId: Schema.String,
    model: Schema.String,
    availableModels: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `Model ${this.model} is not listed on provider instance ${this.providerInstanceId}.`;
  }
}

export class ThreadOrchestrationSpawnFailedError extends Schema.TaggedError<ThreadOrchestrationSpawnFailedError>()(
  "ThreadOrchestrationSpawnFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not spawn the worker thread.";
  }
}

export class ThreadOrchestrationCommandFailedError extends Schema.TaggedError<ThreadOrchestrationCommandFailedError>()(
  "ThreadOrchestrationCommandFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The thread command could not be applied.";
  }
}

export class ThreadOrchestrationReadFailedError extends Schema.TaggedError<ThreadOrchestrationReadFailedError>()(
  "ThreadOrchestrationReadFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read thread state.";
  }
}

export class ThreadOrchestrationDiffFailedError extends Schema.TaggedError<ThreadOrchestrationDiffFailedError>()(
  "ThreadOrchestrationDiffFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not compute the thread diff — checkpoints may be missing or the worktree is gone.";
  }
}

export const ThreadsToolError = Schema.Union([
  McpCapabilityUnavailableError,
  ThreadOrchestrationNotFoundError,
  ThreadOrchestrationProjectNotFoundError,
  ThreadOrchestrationNotWorkerError,
  ThreadOrchestrationChildLimitError,
  ThreadOrchestrationProviderUnavailableError,
  ThreadOrchestrationModelNotFoundError,
  ThreadOrchestrationSpawnFailedError,
  ThreadOrchestrationCommandFailedError,
  ThreadOrchestrationReadFailedError,
  ThreadOrchestrationDiffFailedError,
]);
export type ThreadsToolError = typeof ThreadsToolError.Type;

// ---------------------------------------------------------------------------
// Shared result shapes
// ---------------------------------------------------------------------------

/** Compact per-thread view an orchestrator reasons over. */
export const OrchestrationThreadSummary = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  providerInstanceId: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  status: Schema.String.annotate({
    description:
      "Session status: starting/running mean busy; ready/interrupted/stopped/error mean idle.",
  }),
  busy: Schema.Boolean,
  parentThreadId: Schema.NullOr(ThreadId),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  latestTurnState: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  updatedAt: Schema.String,
});
export type OrchestrationThreadSummary = typeof OrchestrationThreadSummary.Type;

// ---------------------------------------------------------------------------
// Tool inputs / results
// ---------------------------------------------------------------------------

export const GetOrchestrationContextResult = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  model: Schema.NullOr(Schema.String),
  providerInstanceId: Schema.NullOr(Schema.String),
  capabilities: Schema.Array(Schema.String),
  workers: Schema.Array(OrchestrationThreadSummary).annotate({
    description: "Live (non-archived) worker threads spawned by this thread.",
  }),
});
export type GetOrchestrationContextResult = typeof GetOrchestrationContextResult.Type;

export const ListProjectsResult = Schema.Struct({
  projects: Schema.Array(
    Schema.Struct({
      projectId: ProjectId,
      title: Schema.String,
      workspaceRoot: Schema.String,
    }),
  ),
});
export type ListProjectsResult = typeof ListProjectsResult.Type;

export const ListProvidersResult = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      instanceId: ProviderInstanceId,
      driver: Schema.String,
      displayName: Schema.NullOr(Schema.String),
      available: Schema.Boolean.annotate({
        description: "False when the provider is disabled, uninstalled, or unavailable.",
      }),
      status: Schema.String,
      models: Schema.Array(
        Schema.Struct({
          slug: Schema.String,
          name: Schema.String,
          isDefault: Schema.Boolean,
        }),
      ),
    }),
  ),
});
export type ListProvidersResult = typeof ListProvidersResult.Type;

export const ListThreadsInput = Schema.Struct({
  projectId: Schema.optional(
    ProjectId.annotate({ description: "Defaults to this thread's project." }),
  ),
});
export type ListThreadsInput = typeof ListThreadsInput.Type;

export const ListThreadsResult = Schema.Struct({
  threads: Schema.Array(OrchestrationThreadSummary),
});
export type ListThreadsResult = typeof ListThreadsResult.Type;

export const ReadThreadInput = Schema.Struct({
  threadId: ThreadId,
  turnLimit: Schema.optional(
    PositiveInt.annotate({
      description: `How many recent turns of history to include. Default ${MAX_READ_THREAD_TURNS}.`,
    }),
  ),
});
export type ReadThreadInput = typeof ReadThreadInput.Type;

export const ReadThreadResult = Schema.Struct({
  thread: OrchestrationThreadSummary,
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.String,
      text: Schema.String,
      createdAt: Schema.String,
    }),
  ),
  activities: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      summary: Schema.String,
      tone: Schema.String,
      createdAt: Schema.String,
    }),
  ),
  pullRequestUrls: Schema.Array(Schema.String),
});
export type ReadThreadResult = typeof ReadThreadResult.Type;

export const GetThreadDiffResult = Schema.Struct({
  threadId: ThreadId,
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
  diff: Schema.String.annotate({
    description: "Unified patch diff of everything the worker changed, empty when nothing changed.",
  }),
  truncated: Schema.Boolean.annotate({
    description:
      "True when the diff was cut off at the size cap — read files directly for the rest.",
  }),
});
export type GetThreadDiffResult = typeof GetThreadDiffResult.Type;

export const SpawnThreadInput = Schema.Struct({
  title: TrimmedNonEmptyString.annotate({
    description: "Short worker name shown in the sidebar, e.g. 'worker: audit auth module'.",
  }),
  prompt: TrimmedNonEmptyString.annotate({
    description:
      "The worker's first instruction. Be self-contained: it cannot see this conversation.",
  }),
  providerInstanceId: ProviderInstanceId.annotate({
    description: "Target provider instance from list_providers.",
  }),
  model: TrimmedNonEmptyString.annotate({
    description: "Model slug on that instance, from list_providers.",
  }),
  projectId: Schema.optional(
    ProjectId.annotate({ description: "Defaults to this thread's project." }),
  ),
  runtimeMode: Schema.optional(
    RuntimeMode.annotate({
      description:
        "Worker approval mode. 'full-access' (default) runs unattended; 'approval-required' makes the human approve each action in the worker's thread.",
    }),
  ),
  interactionMode: Schema.optional(ProviderInteractionMode),
  isolateWorktree: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Give the worker its own git worktree off baseBranch so it can edit files without colliding with this thread or other workers. Strongly recommended for parallel work.",
    }),
  ),
  baseBranch: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Branch the worktree forks from. Defaults to this thread's current branch, then HEAD.",
    }),
  ),
  runSetupScript: Schema.optional(
    Schema.Boolean.annotate({
      description: "Run the project's setup script in the worktree. Default true.",
    }),
  ),
  contextFromThreadIds: Schema.optional(
    Schema.Array(ThreadId).check(Schema.isMaxLength(4)).annotate({
      description:
        "Threads whose recent transcripts get attached to the worker's first prompt as context — e.g. a spec thread or a sibling whose output this worker needs. Max 4.",
    }),
  ),
});
export type SpawnThreadInput = typeof SpawnThreadInput.Type;

export const SpawnThreadResult = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  worktreePath: Schema.NullOr(Schema.String),
});
export type SpawnThreadResult = typeof SpawnThreadResult.Type;

export const SendThreadMessageInput = Schema.Struct({
  threadId: ThreadId,
  text: TrimmedNonEmptyString,
  delivery: Schema.optional(
    ThreadTurnDeliveryMode.annotate({
      description:
        "'queue' (default) parks the message until the worker's current turn ends; 'steer' injects into the running turn immediately.",
    }),
  ),
});
export type SendThreadMessageInput = typeof SendThreadMessageInput.Type;

export const SendThreadMessageResult = Schema.Struct({
  threadId: ThreadId,
  delivery: ThreadTurnDeliveryMode,
});
export type SendThreadMessageResult = typeof SendThreadMessageResult.Type;

export const WaitForThreadsInput = Schema.Struct({
  threadIds: Schema.Array(ThreadId).check(Schema.isMinLength(1)),
  timeoutSeconds: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_WAIT_SECONDS)).annotate({
      description: `How long to wait, max ${MAX_WAIT_SECONDS}s. Default 120. Returns early once every listed thread is idle.`,
    }),
  ),
});
export type WaitForThreadsInput = typeof WaitForThreadsInput.Type;

export const WaitForThreadsResult = Schema.Struct({
  timedOut: Schema.Boolean.annotate({
    description: "True when the deadline hit with threads still busy.",
  }),
  threads: Schema.Array(OrchestrationThreadSummary),
});
export type WaitForThreadsResult = typeof WaitForThreadsResult.Type;

export const ThreadTargetInput = Schema.Struct({
  threadId: ThreadId,
});
export type ThreadTargetInput = typeof ThreadTargetInput.Type;

export const RenameThreadInput = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
});
export type RenameThreadInput = typeof RenameThreadInput.Type;

export const ThreadActionResult = Schema.Struct({
  threadId: ThreadId,
});
export type ThreadActionResult = typeof ThreadActionResult.Type;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const GetOrchestrationContextTool = Tool.make("get_orchestration_context", {
  description: `Who am I: this thread's id, project, provider, granted capabilities, and the worker threads it has spawned. ${ORCHESTRATOR_RULES}`,
  success: GetOrchestrationContextResult,
  failure: ThreadsToolError,
  dependencies,
})
  .annotate(Tool.Title, "Get orchestration context")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ListProjectsTool = Tool.make("list_projects", {
  description: "List the projects on this server that worker threads can be spawned into.",
  success: ListProjectsResult,
  failure: ThreadsToolError,
  dependencies,
})
  .annotate(Tool.Title, "List projects")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ListProvidersTool = Tool.make("list_providers", {
  description:
    "List configured provider instances and their models. Use it to pick providerInstanceId and model for spawn_thread — for example a frontier model for review and a cheaper instance for implementation.",
  success: ListProvidersResult,
  failure: ThreadsToolError,
  dependencies,
})
  .annotate(Tool.Title, "List providers")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ListThreadsTool = Tool.make("list_threads", {
  description:
    "List live threads in a project (default: this thread's project) with session status, so you can see what is running before delegating.",
  parameters: ListThreadsInput,
  success: ListThreadsResult,
  failure: ThreadsToolError,
  dependencies,
})
  .annotate(Tool.Title, "List threads")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ReadThreadTool = Tool.make("read_thread", {
  description:
    "Read a thread's recent messages, activity, status, and linked pull request URLs. Use it to collect a finished worker's result or diagnose a stuck one.",
  parameters: ReadThreadInput,
  success: ReadThreadResult,
  failure: ThreadsToolError,
  dependencies,
})
  .annotate(Tool.Title, "Read thread")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const SpawnThreadTool = Tool.make("spawn_thread", {
  description: `Spawn a worker thread on any configured provider and model, send it the prompt as its first turn, and return its thread id. ${ORCHESTRATOR_RULES} At most ${MAX_CHILD_THREADS} live workers per orchestrator.`,
  parameters: SpawnThreadInput,
  success: SpawnThreadResult,
  failure: ThreadsToolError,
  dependencies,
})
  .annotate(Tool.Title, "Spawn worker thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const SendThreadMessageTool = Tool.make("send_thread_message", {
  description:
    "Send a follow-up message to a worker thread you spawned. Defaults to delivery 'queue' so it lands after the worker's current turn; use 'steer' to redirect a running turn.",
  parameters: SendThreadMessageInput,
  success: SendThreadMessageResult,
  failure: ThreadsToolError,
  dependencies,
})
  .annotate(Tool.Title, "Send message to worker thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const GetThreadDiffTool = Tool.make("get_thread_diff", {
  description:
    "Get the unified diff of every file change a worker thread made across all its turns, built from turn checkpoints. The review step before integrating a worker's output — you cannot merge it, but you can read it and decide whether the work is done or needs a follow-up message.",
  parameters: ThreadTargetInput,
  success: GetThreadDiffResult,
  failure: ThreadsToolError,
  dependencies,
})
  .annotate(Tool.Title, "Get worker diff")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const WaitForThreadsTool = Tool.make("wait_for_threads", {
  description:
    "Block until every listed thread goes idle (no running turn) or the timeout hits, then return each thread's status. The normal way to collect a wave of spawned workers.",
  parameters: WaitForThreadsInput,
  success: WaitForThreadsResult,
  failure: ThreadsToolError,
  dependencies,
})
  .annotate(Tool.Title, "Wait for threads")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const InterruptThreadTool = Tool.make("interrupt_thread", {
  description:
    "Stop a worker thread's running session. Use when a worker is stuck or its work is no longer needed. Only works on threads you spawned.",
  parameters: ThreadTargetInput,
  success: ThreadActionResult,
  failure: ThreadsToolError,
  dependencies,
})
  .annotate(Tool.Title, "Interrupt worker thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ArchiveThreadTool = Tool.make("archive_thread", {
  description:
    "Archive a finished worker thread once its result is collected, keeping the thread list clean. Only works on threads you spawned.",
  parameters: ThreadTargetInput,
  success: ThreadActionResult,
  failure: ThreadsToolError,
  dependencies,
})
  .annotate(Tool.Title, "Archive worker thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const RenameThreadTool = Tool.make("rename_thread", {
  description: "Rename a worker thread you spawned.",
  parameters: RenameThreadInput,
  success: ThreadActionResult,
  failure: ThreadsToolError,
  dependencies,
})
  .annotate(Tool.Title, "Rename worker thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ThreadsToolkit = Toolkit.make(
  GetOrchestrationContextTool,
  ListProjectsTool,
  ListProvidersTool,
  ListThreadsTool,
  ReadThreadTool,
  GetThreadDiffTool,
  SpawnThreadTool,
  SendThreadMessageTool,
  WaitForThreadsTool,
  InterruptThreadTool,
  ArchiveThreadTool,
  RenameThreadTool,
);
