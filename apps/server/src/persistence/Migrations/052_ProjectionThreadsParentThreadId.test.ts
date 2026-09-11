import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("052_ProjectionThreadsParentThreadId", (it) => {
  it.effect("adds the parent_thread_id column defaulting to null", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 52 });

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          created_at,
          updated_at
        )
        VALUES (
          'thread-worker',
          'project-1',
          'Worker',
          '{}',
          'full-access',
          'default',
          '2026-03-01T00:00:00.000Z',
          '2026-03-01T00:00:00.000Z'
        )
      `;

      const rows = yield* sql<{
        readonly threadId: string;
        readonly parentThreadId: string | null;
      }>`
        SELECT
          thread_id AS "threadId",
          parent_thread_id AS "parentThreadId"
        FROM projection_threads
      `;

      assert.deepStrictEqual(rows, [{ threadId: "thread-worker", parentThreadId: null }]);

      yield* sql`
        UPDATE projection_threads
        SET parent_thread_id = 'thread-orchestrator'
        WHERE thread_id = 'thread-worker'
      `;

      const updated = yield* sql<{ readonly parentThreadId: string | null }>`
        SELECT parent_thread_id AS "parentThreadId"
        FROM projection_threads
        WHERE thread_id = 'thread-worker'
      `;
      assert.deepStrictEqual(updated, [{ parentThreadId: "thread-orchestrator" }]);
    }),
  );
});
