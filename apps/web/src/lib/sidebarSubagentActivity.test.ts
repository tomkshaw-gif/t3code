import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { makeThreadFixture, type ThreadFixtureOverrides } from "../test-fixtures";
import type { SidebarThreadSummary } from "../types";
import {
  deriveWorkingSubagentThreadKeys,
  withWorkingSubagentActivity,
} from "./sidebarSubagentActivity";
import {
  filterSidebarV2VisibleThreads,
  resolveProjectStatusIndicator,
  resolveSidebarThreadStatus,
  resolveThreadStatusPill,
} from "../components/Sidebar.logic";
import {
  buildActivityFeed,
  DEFAULT_ACTIVITY_LAYOUT,
  isActivityThread,
  toActivityEntry,
} from "../components/legacySidebar/activity.logic";

const keyOf = (thread: SidebarThreadSummary) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
const thread = (id: string, overrides: ThreadFixtureOverrides = {}) =>
  makeThreadFixture({ id: ThreadId.make(id), ...overrides });
const root = thread("root");
const running = {
  status: "running" as const,
  activeRunId: null,
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerName: "Codex",
  lastError: null,
  updatedAt: "2026-10-01T10:00:00.000Z",
};
const child = (id: string, parentId: string, overrides: ThreadFixtureOverrides = {}) =>
  thread(id, {
    runtime: running,
    lineage: {
      rootThreadId: root.id,
      parentThreadId: ThreadId.make(parentId),
      relationshipToParent: "subagent",
    },
    ...overrides,
  });
const derive = (threads: readonly SidebarThreadSummary[]) => {
  const workingParents = deriveWorkingSubagentThreadKeys(threads);
  return threads.map((item) => withWorkingSubagentActivity(item, workingParents));
};

describe("sidebar subagent activity", () => {
  it("keeps a completed, read or manually Done parent working without changing its runtime", () => {
    const parent = {
      ...root,
      settledOverride: "settled" as const,
      lastVisitedAt: "2026-10-01T11:00:00.000Z",
      latestRun: {
        runId: RunId.make("parent-run"),
        status: "completed" as const,
        requestedAt: "2026-10-01T09:00:00.000Z",
        startedAt: "2026-10-01T09:00:00.000Z",
        completedAt: "2026-10-01T10:00:00.000Z",
        assistantMessageId: null,
      },
    };
    const [displayParent] = derive([parent, child("agent", "root")]);
    expect(resolveThreadStatusPill({ thread: displayParent! })).toMatchObject({
      label: "Working",
      pulse: true,
    });
    expect(resolveSidebarThreadStatus(displayParent!)).toBe("working");
    expect(
      resolveProjectStatusIndicator([resolveThreadStatusPill({ thread: displayParent! })])?.label,
    ).toBe("Working");
    expect(displayParent!.runtime).toBe(parent.runtime);
    expect(displayParent!.settledOverride).toBe("settled");
    expect(parent).not.toHaveProperty("hasWorkingSubagents");
  });

  it("rolls nested children up before collapsed/hidden subagents are filtered", () => {
    const middle = child("middle", "root", { runtime: null });
    const threads = derive([root, middle, child("leaf", "middle")]);
    expect(threads.slice(0, 2).every((item) => item.hasWorkingSubagents)).toBe(true);
    expect(filterSidebarV2VisibleThreads(threads, null).map((item) => item.id)).toEqual([root.id]);
    const entries = threads.filter(isActivityThread).map((item) =>
      toActivityEntry(item, {
        projectKey: "project",
        supportsPinning: true,
        supportsSettlement: true,
      }),
    );
    expect(entries.map((item) => item.thread.id)).toEqual([root.id]);
    expect(
      buildActivityFeed(
        entries,
        { ...DEFAULT_ACTIVITY_LAYOUT, earlierOpen: true },
        Date.parse(running.updatedAt),
      )
        .sections.flatMap((section) => section.rows)
        .map((entry) => entry.thread.id),
    ).toEqual([root.id]);
    expect(resolveThreadStatusPill({ thread: entries[0]!.thread })?.label).toBe("Working");
  });

  it.each(["preparing", "queued", "starting", "running", "waiting"] as const)(
    "counts a child in %s as working",
    (status) => {
      expect(
        deriveWorkingSubagentThreadKeys([
          root,
          child("agent", "root", { runtime: { ...running, status } }),
        ]).has(keyOf(root)),
      ).toBe(true);
    },
  );

  it.each(["completed", "interrupted", "failed", "idle"] as const)(
    "clears the spinner when the last child becomes %s",
    (status) => {
      const active = child("agent", "root");
      expect(derive([root, active])[0]!.hasWorkingSubagents).toBe(true);
      const [displayParent] = derive([root, { ...active, runtime: { ...running, status } }]);
      expect(displayParent).toBe(root);
      expect(resolveThreadStatusPill({ thread: displayParent! })?.label).not.toBe("Working");
    },
  );

  it("keeps the spinner until every working child stops, including removal", () => {
    const first = child("first", "root");
    const second = child("second", "root");
    expect(derive([root, first, second])[0]!.hasWorkingSubagents).toBe(true);
    expect(derive([root, second])[0]!.hasWorkingSubagents).toBe(true);
    expect(derive([root])[0]).toBe(root);
  });

  it.each(["hasPendingApprovals", "hasPendingUserInput"] as const)(
    "does not count children blocked on %s and keeps the parent's own blocker ahead of child work",
    (blocker) => {
      expect(
        deriveWorkingSubagentThreadKeys([root, child("agent", "root", { [blocker]: true })]).size,
      ).toBe(0);
      const [parent] = derive([{ ...root, [blocker]: true }, child("agent", "root")]);
      expect(resolveThreadStatusPill({ thread: parent! })?.label).toBe(
        blocker === "hasPendingApprovals" ? "Pending Approval" : "Awaiting Input",
      );
      expect(resolveSidebarThreadStatus(parent!)).toBe(
        blocker === "hasPendingApprovals" ? "approval" : "input",
      );
    },
  );

  it.each(["archivedAt", "deletedAt"] as const)(
    "ignores children and ancestor paths marked %s",
    (field) => {
      const time = "2026-10-01T10:00:00.000Z";
      expect(
        deriveWorkingSubagentThreadKeys([root, child("agent", "root", { [field]: time })]).size,
      ).toBe(0);
      expect(
        deriveWorkingSubagentThreadKeys([{ ...root, [field]: time }, child("agent", "root")]).size,
      ).toBe(0);
      expect(
        deriveWorkingSubagentThreadKeys([
          root,
          child("middle", "root", { runtime: null, [field]: time }),
          child("leaf", "middle"),
        ]).size,
      ).toBe(0);
    },
  );

  it("does not follow missing parents or user fork relationships", () => {
    const fork = child("fork", "root", {
      lineage: { ...root.lineage, parentThreadId: root.id, relationshipToParent: "fork" },
    });
    expect(deriveWorkingSubagentThreadKeys([root, child("orphan", "missing")]).size).toBe(0);
    expect(deriveWorkingSubagentThreadKeys([root, fork]).size).toBe(0);
    const keys = deriveWorkingSubagentThreadKeys([
      root,
      { ...fork, runtime: null },
      child("leaf", "fork"),
    ]);
    expect(keys.has(keyOf(fork))).toBe(true);
    expect(keys.has(keyOf(root))).toBe(false);
  });

  it("isolates identical thread IDs across environments", () => {
    const remote = EnvironmentId.make("remote");
    const remoteRoot = { ...root, environmentId: remote };
    const keys = deriveWorkingSubagentThreadKeys([
      root,
      remoteRoot,
      child("agent", "root", { environmentId: remote }),
    ]);
    expect([...keys]).toEqual([keyOf(remoteRoot)]);
  });

  it.each(["codex", "claude", "cursor", "grok", "opencode", "antigravity"])(
    "uses the same lineage rule for %s agents",
    (provider) => {
      expect(
        deriveWorkingSubagentThreadKeys([
          root,
          child("agent", "root", {
            providerInstanceId: ProviderInstanceId.make(provider),
            runtime: { ...running, providerInstanceId: ProviderInstanceId.make(provider) },
          }),
        ]).has(keyOf(root)),
      ).toBe(true);
    },
  );

  it("terminates malformed cycles and keeps unrelated shell references stable", () => {
    const first = child("first", "second");
    const second = child("second", "first", { runtime: null });
    const keys = deriveWorkingSubagentThreadKeys([root, first, second]);
    expect(keys.size).toBe(2);
    expect(withWorkingSubagentActivity(root, keys)).toBe(root);
  });
});
