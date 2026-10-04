import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect } from "react";

import { useThreadShells } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useUiStateStore } from "../uiStateStore";

const pendingThreadKeys = new Set<string>();
const MIGRATED_KEY_PREFIX = "t3code:thread-visited-migrated:v1:";

/**
 * One-way migration of the browser-local visited watermarks into servers with
 * visited tracking. Before tracking existed, "Done" lived in this browser's
 * localStorage; pushing those watermarks up seeds the server value so other
 * devices see the same read state. Persist completed evaluations per scoped
 * thread, including those with nothing to push, so later server-side Mark unread
 * rewinds survive reloads even if local visits advance.
 */
export function useThreadVisitedMigration(): void {
  const threads = useThreadShells();
  const visitThreadMutation = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  useEffect(() => {
    for (const thread of threads) {
      // Field absent → the environment's server has no visited tracking; keep
      // the local value in play and reconsider if the server upgrades.
      if (thread.lastVisitedAt === undefined) continue;
      const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      if (pendingThreadKeys.has(threadKey)) continue;
      const migratedKey = `${MIGRATED_KEY_PREFIX}${threadKey}`;
      try {
        if (window.localStorage.getItem(migratedKey) === "1") continue;
      } catch {
        // Without durable storage, a repeated migration could undo Mark unread.
        continue;
      }
      const local = useUiStateStore.getState().threadLastVisitedAtById[threadKey];
      const localMs = local ? Date.parse(local) : Number.NaN;
      const serverMs = thread.lastVisitedAt === null ? null : Date.parse(thread.lastVisitedAt);
      if (
        !local ||
        !Number.isFinite(localMs) ||
        (serverMs !== null && Number.isFinite(serverMs) && serverMs >= localMs)
      ) {
        try {
          window.localStorage.setItem(migratedKey, "1");
        } catch {
          // Storage-unavailable evaluations leave migration skipped.
        }
        continue;
      }
      pendingThreadKeys.add(threadKey);
      void (async () => {
        try {
          const result = await visitThreadMutation({
            environmentId: thread.environmentId,
            input: { threadId: thread.id, visitedAt: local },
          });
          if (result._tag === "Success") window.localStorage.setItem(migratedKey, "1");
        } catch {
          // Leave failures eligible for retry on the next shell update/reconnect.
        } finally {
          pendingThreadKeys.delete(threadKey);
        }
      })();
    }
  }, [threads, visitThreadMutation]);
}
