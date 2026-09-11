import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("051_ProjectionQueuedTurns", (it) => {
  it.effect("creates the queued-turn table keyed on thread + message", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 51 });

      yield* sql`
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
          'thread-1',
          'message-1',
          7,
          '{"instanceId":"grok","model":"grok-code-fast-1"}',
          'default',
          'Seed title',
          'thread-0',
          'plan-1',
          '2026-03-01T00:00:00.000Z'
        )
      `;

      const rows = yield* sql`
        SELECT
          thread_id AS "threadId",
          message_id AS "messageId",
          sequence,
          model_selection_json AS "modelSelectionJson",
          interaction_mode AS "interactionMode",
          title_seed AS "titleSeed",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          requested_at AS "requestedAt"
        FROM projection_queued_turns
      `;

      assert.deepStrictEqual(rows, [
        {
          threadId: "thread-1",
          messageId: "message-1",
          sequence: 7,
          modelSelectionJson: '{"instanceId":"grok","model":"grok-code-fast-1"}',
          interactionMode: "default",
          titleSeed: "Seed title",
          sourceProposedPlanThreadId: "thread-0",
          sourceProposedPlanId: "plan-1",
          requestedAt: "2026-03-01T00:00:00.000Z",
        },
      ]);

      const indexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_queued_turns)
      `;
      assert.ok(
        indexes.some((index) => index.name === "idx_projection_queued_turns_thread_sequence"),
      );
    }),
  );
});
