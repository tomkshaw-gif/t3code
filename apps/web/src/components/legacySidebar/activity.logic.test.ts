import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { makeThreadFixture } from "../../test-fixtures";
import {
  activityRecency,
  buildActivityFeed,
  DEFAULT_ACTIVITY_LAYOUT,
  isActivityThread,
  markActivityRead,
  resolveActivityDayStartMs,
  toActivityEntry,
  type ActivityItem,
} from "./activity.logic";

const iso = (day: number, hour = 12, minute = 0) =>
  new Date(2026, 8, day, hour, minute).toISOString();
const now = new Date(2026, 8, 30, 16).getTime();
function item(key: string, overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    key,
    projectKey: "project-a",
    createdAt: iso(20),
    latestHumanMessageAt: iso(30),
    settledAt: null,
    pinned: false,
    settled: false,
    unread: false,
    ...overrides,
  };
}
const feed = (
  items: ActivityItem[],
  layout = DEFAULT_ACTIVITY_LAYOUT,
  at = now,
  activeKey: string | null = null,
) => buildActivityFeed(items, layout, at, activeKey);
const completedRun = {
  runId: RunId.make("run"),
  status: "completed" as const,
  requestedAt: iso(30, 10),
  startedAt: iso(30, 10),
  completedAt: iso(30, 11),
  assistantMessageId: null,
};

describe("native Activity adapter", () => {
  it("excludes drafts, archived/deleted sessions and subagents, while keeping user forks", () => {
    const draft = makeThreadFixture();
    const worked = makeThreadFixture({ latestRun: completedRun });
    expect(isActivityThread(draft)).toBe(false);
    expect(isActivityThread(worked)).toBe(true);
    expect(isActivityThread({ ...worked, archivedAt: iso(30) })).toBe(false);
    expect(isActivityThread({ ...worked, deletedAt: iso(30) })).toBe(false);
    const lineage = {
      ...worked.lineage,
      parentThreadId: ThreadId.make("parent"),
      relationshipToParent: "subagent" as const,
    };
    expect(isActivityThread({ ...worked, lineage })).toBe(false);
    expect(
      isActivityThread({ ...worked, lineage: { ...lineage, relationshipToParent: "fork" } }),
    ).toBe(true);
  });
  it.each(["preparing", "queued", "starting", "running", "waiting"] as const)(
    "includes a first turn in %s before its run projection arrives",
    (status) => {
      expect(
        isActivityThread(
          makeThreadFixture({
            latestRun: null,
            runtime: {
              status,
              activeRunId: RunId.make("run"),
              providerInstanceId: ProviderInstanceId.make("codex"),
              providerName: "Codex",
              lastError: null,
              updatedAt: iso(30),
            },
          }),
        ),
      ).toBe(true);
    },
  );
  it("uses native settlement overrides and capability gates, not stale settled timestamps", () => {
    const thread = makeThreadFixture({
      latestRun: completedRun,
      settledOverride: "active",
      settledAt: iso(30),
      pinnedAt: iso(30),
    });
    const options = { projectKey: "p", supportsPinning: true, supportsSettlement: true };
    expect(toActivityEntry(thread, options)).toMatchObject({ settled: false, pinned: true });
    expect(toActivityEntry({ ...thread, settledOverride: "settled" }, options).settled).toBe(true);
    expect(
      toActivityEntry(
        { ...thread, settledOverride: "settled" },
        { ...options, supportsPinning: false, supportsSettlement: false },
      ),
    ).toMatchObject({ settled: false, pinned: false });
  });
  it("keeps same-id sessions in different environments distinct", () => {
    const thread = makeThreadFixture({ latestRun: completedRun });
    const options = { projectKey: "shared-repo", supportsPinning: true, supportsSettlement: true };
    const local = toActivityEntry(thread, options);
    const remote = toActivityEntry(
      { ...thread, environmentId: EnvironmentId.make("remote") },
      options,
    );
    expect(local.key).not.toBe(remote.key);
    expect(
      feed([local, remote], { ...DEFAULT_ACTIVITY_LAYOUT, earlierOpen: true }).visibleKeys,
    ).toHaveLength(2);
  });
  it("honors authoritative server read state and falls back locally only on older servers", () => {
    const thread = makeThreadFixture({ latestRun: completedRun, lastVisitedAt: iso(30, 10) });
    const options = {
      projectKey: "p",
      supportsPinning: true,
      supportsSettlement: true,
      localLastVisitedAt: iso(30, 12),
    };
    expect(toActivityEntry(thread, options).unread).toBe(true);
    expect(toActivityEntry({ ...thread, lastVisitedAt: iso(30, 12) }, options).unread).toBe(false);
    const { lastVisitedAt: _, ...oldServer } = thread;
    expect(toActivityEntry(oldServer, options).unread).toBe(false);
    expect(toActivityEntry({ ...thread, lastVisitedAt: null }, options).unread).toBe(false);
  });
});

describe("Synara Activity feed ordering and navigation", () => {
  it("partitions pins and Done without duplicate rows; native unpin/Undo returns rows to activity", () => {
    const entries = [
      item("active"),
      item("pin", { pinned: true }),
      item("done", { settled: true, settledAt: iso(30) }),
    ];
    const layout = { ...DEFAULT_ACTIVITY_LAYOUT, doneOpen: true };
    expect(
      feed(entries, layout).sections.map((section) => [
        section.key,
        section.rows.map((row) => row.key),
      ]),
    ).toEqual([
      ["pinned", ["pin"]],
      ["recent", ["active"]],
      ["done", ["done"]],
    ]);
    expect(
      feed(
        entries.map((entry) => ({ ...entry, pinned: false, settled: false })),
        layout,
      ).sections.map((section) => section.key),
    ).toEqual(["recent"]);
    expect(entries[1]?.pinned).toBe(true);
  });
  it("orders on human sends with deterministic ties; background updates and reads do not move sessions", () => {
    const entries = [item("b"), item("a"), item("older", { latestHumanMessageAt: iso(30, 9) })];
    expect(feed(entries).visibleKeys).toEqual(["a", "b", "older"]);
    expect(
      feed(entries.toReversed().map((entry) => ({ ...entry, unread: !entry.unread }))).visibleKeys,
    ).toEqual(["a", "b", "older"]);
    expect(activityRecency(item("invalid", { latestHumanMessageAt: "invalid" }))).toBe(
      Date.parse(iso(20)),
    );
  });
  it("keeps Recent at five; calendar buckets do not duplicate its rows", () => {
    const entries = Array.from({ length: 7 }, (_, i) =>
      item(`today-${i}`, { latestHumanMessageAt: iso(30, 12, i) }),
    );
    entries.push(
      item("yesterday", { latestHumanMessageAt: iso(29) }),
      item("earlier", { latestHumanMessageAt: iso(27) }),
    );
    const result = feed(entries, { ...DEFAULT_ACTIVITY_LAYOUT, earlierOpen: true });
    expect(result.sections.map((section) => [section.key, section.rows.length])).toEqual([
      ["recent", 5],
      ["today", 2],
      ["yesterday", 1],
      ["earlier", 1],
    ]);
    expect(result.visibleKeys).toHaveLength(9);
  });
  it("rolls Recent at 4am local, carrying overnight human sends until then", () => {
    const before = new Date(2026, 8, 30, 3, 59).getTime();
    const after = new Date(2026, 8, 30, 4).getTime();
    const entries = [item("night", { latestHumanMessageAt: iso(29, 23) })];
    expect(resolveActivityDayStartMs(before)).toBe(new Date(2026, 8, 29, 4).getTime());
    expect(feed(entries, DEFAULT_ACTIVITY_LAYOUT, before).sections[0]?.key).toBe("recent");
    expect(feed(entries, DEFAULT_ACTIVITY_LAYOUT, after).sections[0]?.key).toBe("yesterday");
  });
  it("collapses and pages the same mounted roster used for jump and range navigation", () => {
    const entries = Array.from({ length: 43 }, (_, i) =>
      item(`old-${i}`, { latestHumanMessageAt: iso(20) }),
    );
    entries.push(item("done", { settled: true }), item("pinned", { pinned: true }));
    expect(feed(entries).visibleKeys).toEqual(["pinned"]);
    const opened = {
      ...DEFAULT_ACTIVITY_LAYOUT,
      pinnedOpen: false,
      earlierOpen: true,
      doneOpen: true,
    };
    expect(feed(entries, opened).visibleKeys).toHaveLength(21);
    const paged = feed(entries, { ...opened, extraPages: { earlier: 1 } });
    expect(paged.visibleKeys).toHaveLength(41);
    expect(paged.sections.find((section) => section.key === "earlier")).toMatchObject({
      canShowMore: true,
      canShowLess: true,
    });
    expect(feed(entries, { ...opened, extraPages: { earlier: 2 } }).visibleKeys).toHaveLength(44);
  });
  it("filters grouped projects, orders project groups by recent human sends, and recovers removed scopes", () => {
    const entries = [
      item("a"),
      item("b", { projectKey: "project-b", latestHumanMessageAt: iso(30, 13) }),
      item("c", { projectKey: "project-b" }),
    ];
    const grouped = { ...DEFAULT_ACTIVITY_LAYOUT, groupMode: "project" as const };
    expect(feed(entries, grouped).sections.map((section) => section.projectKey)).toEqual([
      "project-b",
      "project-a",
    ]);
    expect(feed(entries, { ...grouped, scope: "project-b" }).visibleKeys).toEqual(["b", "c"]);
    const removed = feed(
      entries.filter((entry) => entry.projectKey !== "project-b"),
      { ...grouped, scope: "project-b" },
    );
    expect(removed.scope).toBeNull();
    expect(removed.visibleKeys).toEqual(["a"]);
  });
  it("breaks project recency ties by project identity, not the first thread's identity", () => {
    const entries = [
      item("a", { projectKey: "project-b" }),
      item("z", { projectKey: "project-a" }),
    ];
    expect(
      feed(entries, { ...DEFAULT_ACTIVITY_LAYOUT, groupMode: "project" }).sections.map(
        (section) => section.projectKey,
      ),
    ).toEqual(["project-a", "project-b"]);
  });
  it("clamps paging after archival shrinks a section, so Show less can remove a visible page", () => {
    const entries = Array.from({ length: 21 }, (_, i) =>
      item(`old-${i}`, { latestHumanMessageAt: iso(20) }),
    );
    const layout = { ...DEFAULT_ACTIVITY_LAYOUT, earlierOpen: true, extraPages: { earlier: 10 } };
    const section = feed(entries, layout).sections[0]!;
    expect(section).toMatchObject({ extraPages: 1, canShowMore: false, canShowLess: true });
    expect(
      feed(entries, { ...layout, extraPages: { earlier: section.extraPages - 1 } }).visibleKeys,
    ).toHaveLength(20);
    expect(feed(entries.slice(0, 10), layout).sections[0]).toMatchObject({
      extraPages: 0,
      canShowLess: false,
    });
  });
  it("mark-all-read includes unseen Done, collapsed and out-of-scope rows", () => {
    const entries = [
      item("hidden", { unread: true, latestHumanMessageAt: iso(20) }),
      item("done", { settled: true, unread: true }),
      item("other", { projectKey: "b", unread: true }),
    ];
    const result = feed(entries, { ...DEFAULT_ACTIVITY_LAYOUT, scope: "project-a" });
    expect(result.visibleKeys).toEqual([]);
    expect(result.unread.map((entry) => entry.key)).toEqual(["hidden", "done", "other"]);
  });
  it("keeps the open thread visible under a collapsed section and past the page cap", () => {
    const entries = Array.from({ length: 25 }, (_, index) =>
      item(`old-${index}`, { latestHumanMessageAt: iso(20, 12, index) }),
    );
    const collapsed = feed(entries, DEFAULT_ACTIVITY_LAYOUT, now, "old-0");
    const earlier = collapsed.sections.find((section) => section.key === "earlier");
    expect(earlier?.open).toBe(false);
    expect(earlier?.rows).toEqual([]);
    expect(earlier?.revealed.map((row) => row.key)).toEqual(["old-0"]);
    expect(collapsed.visibleKeys).toContain("old-0");

    const opened = feed(entries, { ...DEFAULT_ACTIVITY_LAYOUT, earlierOpen: true }, now, "old-0");
    const openEarlier = opened.sections.find((section) => section.key === "earlier");
    expect(openEarlier?.revealed).toEqual([]);
    expect(openEarlier?.rows).toHaveLength(21);
    expect(openEarlier?.rows.at(-1)?.key).toBe("old-0");
    expect(openEarlier?.canShowMore).toBe(true);

    const onPage = feed(entries, { ...DEFAULT_ACTIVITY_LAYOUT, earlierOpen: true }, now, "old-24");
    const page = onPage.sections.find((section) => section.key === "earlier");
    expect(page?.rows).toHaveLength(20);
    expect(page?.rows.filter((row) => row.key === "old-24")).toHaveLength(1);
  });
});

describe("Activity read mutations", () => {
  it("syncs capable servers and does not clear unread locally after a failed server update", async () => {
    const entries = [
      { ...item("success"), thread: { lastVisitedAt: iso(29) } },
      { ...item("failed"), thread: { lastVisitedAt: null } },
      { ...item("old-server"), thread: {} },
    ];
    const visit = vi.fn(async (entry: (typeof entries)[number]) => entry.key !== "failed");
    const markLocal = vi.fn();
    expect(await markActivityRead(entries, { visitedAt: iso(30), visit, markLocal })).toBe(1);
    expect(visit.mock.calls.map(([entry]) => entry.key)).toEqual(["success", "failed"]);
    expect(markLocal.mock.calls).toEqual([
      ["old-server", iso(30)],
      ["success", iso(30)],
    ]);
  });
});
