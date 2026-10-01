import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { SidebarThreadSummary } from "../../types";
import { isLegacyThreadDone } from "./threadDone";
import {
  hasUnseenCompletion,
  isSidebarSubagentThread,
  resolveThreadLastVisitedAt,
} from "../Sidebar.logic";

// Adapted from Synara's SidebarActivityView.logic.ts at
// 529ad049cb106c998010f5400189515008997aa4. See icons/Synara-LICENSE.
// T3 owns settlement, pinning and read state; the feed only arranges that state.
export interface ActivityItem {
  key: string;
  projectKey: string;
  createdAt: string;
  latestHumanMessageAt: string | null;
  settledAt: string | null;
  pinned: boolean;
  settled: boolean;
  unread: boolean;
}

export interface ActivityEntry extends ActivityItem {
  thread: SidebarThreadSummary;
}

export function isActivityThread(
  thread: Pick<
    SidebarThreadSummary,
    "archivedAt" | "deletedAt" | "lineage" | "latestRun" | "runtime" | "hasWorkingSubagents"
  >,
): boolean {
  return (
    thread.archivedAt == null &&
    thread.deletedAt == null &&
    !isSidebarSubagentThread(thread) &&
    (thread.latestRun != null ||
      threadRuntimeIsActive(thread.runtime) ||
      thread.hasWorkingSubagents === true)
  );
}

export function toActivityEntry(
  thread: SidebarThreadSummary,
  input: {
    projectKey: string;
    supportsPinning: boolean;
    supportsSettlement: boolean;
    localLastVisitedAt?: string | undefined;
  },
): ActivityEntry {
  return {
    key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
    projectKey: input.projectKey,
    createdAt: thread.createdAt,
    latestHumanMessageAt: thread.latestUserMessageAt,
    settledAt: thread.settledAt,
    pinned: input.supportsPinning && thread.pinnedAt != null,
    settled: isLegacyThreadDone(thread, input.supportsSettlement),
    unread: hasUnseenCompletion({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, input.localLastVisitedAt),
    }),
    thread,
  };
}

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}
export function activityRecency(item: ActivityItem): number {
  return timestamp(item.latestHumanMessageAt) || timestamp(item.createdAt);
}
const compareRecency = (a: ActivityItem, b: ActivityItem) =>
  activityRecency(b) - activityRecency(a) || a.key.localeCompare(b.key);

export function resolveActivityDayStartMs(nowMs: number): number {
  const start = new Date(nowMs);
  start.setHours(4, 0, 0, 0);
  if (start.getTime() > nowMs) start.setDate(start.getDate() - 1);
  return start.getTime();
}

export type ActivityGroupMode = "time" | "project";
export interface ActivityLayout {
  scope: string | null;
  groupMode: ActivityGroupMode;
  pinnedOpen: boolean;
  earlierOpen: boolean;
  doneOpen: boolean;
  extraPages: Readonly<Record<string, number>>;
}
export const DEFAULT_ACTIVITY_LAYOUT: ActivityLayout = {
  scope: null,
  groupMode: "time",
  pinnedOpen: true,
  earlierOpen: false,
  doneOpen: false,
  extraPages: {},
};
export interface ActivitySection<T> {
  key: string;
  label: string;
  projectKey?: string;
  rows: T[];
  total: number;
  open: boolean;
  collapsible: boolean;
  canShowMore: boolean;
  canShowLess: boolean;
  extraPages: number;
}

/** The same sections drive rendering, range selection, jumps and prewarming. */
export function buildActivityFeed<T extends ActivityItem>(
  items: readonly T[],
  layout: ActivityLayout,
  nowMs: number,
) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.projectKey, (counts.get(item.projectKey) ?? 0) + 1);
  const scopeOptions = [...counts]
    .map(([projectKey, count]) => ({ projectKey, count }))
    .sort((a, b) => b.count - a.count || a.projectKey.localeCompare(b.projectKey));
  const scope = layout.scope !== null && counts.has(layout.scope) ? layout.scope : null;
  const scoped = items.filter((item) => scope === null || item.projectKey === scope);
  const pinned = scoped.filter((item) => item.pinned).sort(compareRecency);
  const active = scoped.filter((item) => !item.pinned && !item.settled).sort(compareRecency);
  const done = scoped
    .filter((item) => !item.pinned && item.settled)
    .sort(
      (a, b) =>
        (timestamp(b.settledAt) || activityRecency(b)) -
          (timestamp(a.settledAt) || activityRecency(a)) || a.key.localeCompare(b.key),
    );
  const sections: ActivitySection<T>[] = [];
  function add(
    key: string,
    label: string,
    rows: T[],
    open = true,
    collapsible = false,
    paged = false,
    projectKey?: string,
  ) {
    if (rows.length === 0) return;
    const pages = paged
      ? Math.min(
          Math.ceil(Math.max(0, rows.length - 20) / 20),
          Math.max(0, Math.floor(layout.extraPages[key] ?? 0)),
        )
      : 0;
    const limit = paged ? 20 + pages * 20 : rows.length;
    sections.push({
      key,
      label,
      ...(projectKey ? { projectKey } : {}),
      rows: open ? rows.slice(0, limit) : [],
      total: rows.length,
      open,
      collapsible,
      canShowMore: open && rows.length > limit,
      canShowLess: open && paged && pages > 0,
      extraPages: pages,
    });
  }
  add("pinned", "Pinned", pinned, layout.pinnedOpen, true);
  if (layout.groupMode === "project") {
    const groups = new Map<string, T[]>();
    // Rows retain human-send order; groups also have a stable project-key tie break.
    for (const item of active) {
      const group = groups.get(item.projectKey);
      if (group) group.push(item);
      else groups.set(item.projectKey, [item]);
    }
    const orderedGroups = [...groups].sort(
      ([a, left], [b, right]) =>
        activityRecency(right[0]!) - activityRecency(left[0]!) || a.localeCompare(b),
    );
    for (const [key, rows] of orderedGroups)
      add(`project:${key}`, key, rows, true, false, true, key);
  } else {
    const recent = active
      .filter((item) => timestamp(item.latestHumanMessageAt) >= resolveActivityDayStartMs(nowMs))
      .slice(0, 5);
    const recentKeys = new Set(recent.map((item) => item.key));
    const todayStart = new Date(nowMs);
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const rest = active.filter((item) => !recentKeys.has(item.key));
    add("recent", "Recent", recent);
    add(
      "today",
      "Today",
      rest.filter((item) => activityRecency(item) >= todayStart.getTime()),
    );
    add(
      "yesterday",
      "Yesterday",
      rest.filter(
        (item) =>
          activityRecency(item) < todayStart.getTime() &&
          activityRecency(item) >= yesterdayStart.getTime(),
      ),
    );
    add(
      "earlier",
      "Earlier",
      rest.filter((item) => activityRecency(item) < yesterdayStart.getTime()),
      layout.earlierOpen,
      true,
      true,
    );
  }
  add("done", "Done", done, layout.doneOpen, true, true);
  return {
    scope,
    scopeOptions,
    sections,
    visibleKeys: [...new Set(sections.flatMap((section) => section.rows.map((item) => item.key)))],
    // Synara's mark-all-read intentionally covers all projects, even under a filter.
    unread: items.filter((item) => item.unread),
  };
}

/** Servers with read tracking must receive the watermark; old servers keep it locally. */
export async function markActivityRead<
  T extends ActivityItem & { thread: Pick<SidebarThreadSummary, "lastVisitedAt"> },
>(
  items: readonly T[],
  input: {
    visitedAt: string;
    visit: (item: T, visitedAt: string) => Promise<boolean>;
    markLocal: (key: string, visitedAt: string) => void;
  },
): Promise<number> {
  const outcomes = await Promise.all(
    items.map(async (item) => {
      if (item.thread.lastVisitedAt !== undefined && !(await input.visit(item, input.visitedAt)))
        return false;
      input.markLocal(item.key, input.visitedAt);
      return true;
    }),
  );
  return outcomes.filter((success) => !success).length;
}
