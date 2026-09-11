import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { ModelSelection } from "@t3tools/contracts";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionQueuedTurnsByThreadInput,
  ListProjectionQueuedTurnsByThreadInput,
  ProjectionQueuedTurn,
  ProjectionQueuedTurnRepository,
  type ProjectionQueuedTurnRepositoryShape,
  RemoveProjectionQueuedTurnInput,
  UpsertProjectionQueuedTurnInput,
} from "../Services/ProjectionQueuedTurns.ts";

const ProjectionQueuedTurnDbRowSchema = ProjectionQueuedTurn.mapFields(
  Struct.assign({
    modelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
  }),
);

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionQueuedTurnRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertQueuedTurn = SqlSchema.void({
    Request: ProjectionQueuedTurnDbRowSchema,
    execute: (row) =>
      sql`
        INSERT INTO projection_queued_turns (
          thread_id,
          message_id,
          sequence,
          model_selection_json,
          interaction_mode,
          title_seed,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          requested_at
        )
        VALUES (
          ${row.threadId},
          ${row.messageId},
          ${row.sequence},
          ${row.modelSelection},
          ${row.interactionMode},
          ${row.titleSeed},
          ${row.sourceProposedPlanThreadId},
          ${row.sourceProposedPlanId},
          ${row.requestedAt}
        )
        ON CONFLICT (thread_id, message_id)
        DO UPDATE SET
          sequence = excluded.sequence,
          model_selection_json = excluded.model_selection_json,
          interaction_mode = excluded.interaction_mode,
          title_seed = excluded.title_seed,
          source_proposed_plan_thread_id = excluded.source_proposed_plan_thread_id,
          source_proposed_plan_id = excluded.source_proposed_plan_id,
          requested_at = excluded.requested_at
      `,
  });

  const removeQueuedTurn = SqlSchema.void({
    Request: RemoveProjectionQueuedTurnInput,
    execute: ({ threadId, messageId }) =>
      sql`
        DELETE FROM projection_queued_turns
        WHERE thread_id = ${threadId}
          AND message_id = ${messageId}
      `,
  });

  const listQueuedTurnsByThread = SqlSchema.findAll({
    Request: ListProjectionQueuedTurnsByThreadInput,
    Result: ProjectionQueuedTurnDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          message_id AS "messageId",
          sequence,
          model_selection_json AS "modelSelection",
          interaction_mode AS "interactionMode",
          title_seed AS "titleSeed",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          requested_at AS "requestedAt"
        FROM projection_queued_turns
        WHERE thread_id = ${threadId}
        ORDER BY sequence ASC, message_id ASC
      `,
  });

  const deleteQueuedTurnsByThread = SqlSchema.void({
    Request: DeleteProjectionQueuedTurnsByThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_queued_turns
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionQueuedTurnRepositoryShape["upsert"] = (row) =>
    upsertQueuedTurn(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionQueuedTurnRepository.upsert:query",
          "ProjectionQueuedTurnRepository.upsert:encodeRequest",
        ),
      ),
    );

  const remove: ProjectionQueuedTurnRepositoryShape["remove"] = (input) =>
    removeQueuedTurn(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionQueuedTurnRepository.remove:query")),
    );

  const listByThreadId: ProjectionQueuedTurnRepositoryShape["listByThreadId"] = (input) =>
    listQueuedTurnsByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionQueuedTurnRepository.listByThreadId:query",
          "ProjectionQueuedTurnRepository.listByThreadId:decodeRows",
        ),
      ),
    );

  const deleteByThreadId: ProjectionQueuedTurnRepositoryShape["deleteByThreadId"] = (input) =>
    deleteQueuedTurnsByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionQueuedTurnRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    remove,
    listByThreadId,
    deleteByThreadId,
  } satisfies ProjectionQueuedTurnRepositoryShape;
});

export const ProjectionQueuedTurnRepositoryLive = Layer.effect(
  ProjectionQueuedTurnRepository,
  makeProjectionQueuedTurnRepository,
);
