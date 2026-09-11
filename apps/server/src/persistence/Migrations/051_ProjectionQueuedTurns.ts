import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_queued_turns (
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      model_selection_json TEXT,
      interaction_mode TEXT,
      title_seed TEXT,
      source_proposed_plan_thread_id TEXT,
      source_proposed_plan_id TEXT,
      requested_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, message_id)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_queued_turns_thread_sequence
    ON projection_queued_turns(thread_id, sequence)
  `;
});
