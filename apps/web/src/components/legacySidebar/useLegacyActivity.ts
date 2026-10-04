import { useEffect, useMemo, useState } from "react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { SidebarThreadSummary } from "../../types";
import { useUiStateStore } from "../../uiStateStore";
import {
  buildActivityFeed,
  DEFAULT_ACTIVITY_LAYOUT,
  isActivityThread,
  toActivityEntry,
} from "./activity.logic";

export function useLegacyActivity({
  enabled,
  threads,
  resolveProjectKey,
  capabilities,
  activeKey,
}: {
  enabled: boolean;
  threads: readonly SidebarThreadSummary[];
  resolveProjectKey: (thread: SidebarThreadSummary) => string;
  capabilities: ReadonlyMap<string, { pinning: boolean; settlement: boolean }>;
  activeKey: string | null;
}) {
  const [layout, setLayout] = useState(DEFAULT_ACTIVITY_LAYOUT);
  const [now, setNow] = useState(() => Date.now());
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  useEffect(() => {
    if (!enabled) return;
    const update = () => setNow(Date.now());
    update();
    // Calendar sections roll over while the app is idle. No repaint loop.
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [enabled]);
  const entries = useMemo(
    () =>
      threads.filter(isActivityThread).map((thread) => {
        const capability = capabilities.get(thread.environmentId);
        return toActivityEntry(thread, {
          projectKey: resolveProjectKey(thread),
          supportsPinning: capability?.pinning === true,
          supportsSettlement: capability?.settlement === true,
          localLastVisitedAt:
            localVisits[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
        });
      }),
    [threads, capabilities, resolveProjectKey, localVisits],
  );
  const feed = useMemo(
    () => buildActivityFeed(entries, layout, now, activeKey),
    [activeKey, entries, layout, now],
  );
  return { feed, layout, setLayout, entries };
}
