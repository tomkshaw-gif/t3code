/**
 * ProjectionQueuedTurnRepository - Projection repository interface for parked user turns.
 *
 * Owns the per-thread FIFO of user messages sent with delivery "queue" while a
 * turn is busy. The drain reactor reads the head entry when the session goes
 * idle and dispatches it as a real turn start.
 *
 * @module ProjectionQueuedTurnRepository
 */
import {
  IsoDateTime,
  MessageId,
  ModelSelection,
  OrchestrationProposedPlanId,
  ProviderInteractionMode,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionQueuedTurn = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  // The persisted event sequence — the FIFO's authoritative order key.
  sequence: Schema.Int,
  modelSelection: Schema.NullOr(ModelSelection),
  titleSeed: Schema.NullOr(TrimmedNonEmptyString),
  interactionMode: Schema.NullOr(ProviderInteractionMode),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  requestedAt: IsoDateTime,
});
export type ProjectionQueuedTurn = typeof ProjectionQueuedTurn.Type;

export const UpsertProjectionQueuedTurnInput = ProjectionQueuedTurn;
export type UpsertProjectionQueuedTurnInput = typeof UpsertProjectionQueuedTurnInput.Type;

export const RemoveProjectionQueuedTurnInput = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
});
export type RemoveProjectionQueuedTurnInput = typeof RemoveProjectionQueuedTurnInput.Type;

export const ListProjectionQueuedTurnsByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionQueuedTurnsByThreadInput =
  typeof ListProjectionQueuedTurnsByThreadInput.Type;

export const DeleteProjectionQueuedTurnsByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionQueuedTurnsByThreadInput =
  typeof DeleteProjectionQueuedTurnsByThreadInput.Type;

export interface ProjectionQueuedTurnRepositoryShape {
  /**
   * Inserts or replaces the queued entry for `{threadId, messageId}` — message
   * ids are the queue's identity, so re-queueing moves the entry to the tail.
   */
  readonly upsert: (
    row: UpsertProjectionQueuedTurnInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Removes one queued entry, no-op when it is absent.
   */
  readonly remove: (
    input: RemoveProjectionQueuedTurnInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Lists a thread's queued entries oldest-first (FIFO drain order).
   */
  readonly listByThreadId: (
    input: ListProjectionQueuedTurnsByThreadInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionQueuedTurn>, ProjectionRepositoryError>;

  /**
   * Hard-deletes all queued entries for a thread (thread re-creation reset).
   */
  readonly deleteByThreadId: (
    input: DeleteProjectionQueuedTurnsByThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionQueuedTurnRepository extends Context.Service<
  ProjectionQueuedTurnRepository,
  ProjectionQueuedTurnRepositoryShape
>()("t3/persistence/Services/ProjectionQueuedTurns/ProjectionQueuedTurnRepository") {}
