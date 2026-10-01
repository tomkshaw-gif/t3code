import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { describe, expect, it } from "vite-plus/test";
import { filterSidebarV2VisibleThreads, sortPinnedThreadsForSidebar } from "../Sidebar.logic";
import { filterLegacyProjectThreads, previewLegacySidebarThreads } from "./threadVisibility";
import {
  groupLegacyWorkspaceThreads,
  orderLegacyWorkspaceThreads,
  visibleLegacyWorkspaceThreads,
} from "./workspaceGroups";

function thread(id: string, relationship: "fork" | "subagent" | null = null) {
  return {
    id: ThreadId.make(id),
    environmentId: EnvironmentId.make("local"),
    projectId: ProjectId.make("p"),
    archivedAt: null as string | null,
    lineage: {
      rootThreadId: ThreadId.make("root"),
      parentThreadId: relationship ? ThreadId.make("root") : null,
      relationshipToParent: relationship,
    },
    worktreePath: null as string | null,
    branch: null,
    pinnedAt: null as string | null,
    pinOrderKey: null,
    createdAt: "2026-09-30T00:00:00Z",
  };
}
const keyOf = (item: ReturnType<typeof thread>) =>
  scopedThreadKey(scopeThreadRef(item.environmentId, item.id));
const preview = (
  threads: ReturnType<typeof thread>[],
  activeThreadKey: string | null = null,
  projectExpanded = true,
) =>
  previewLegacySidebarThreads({
    threads,
    activeThreadKey,
    projectExpanded,
    previewCount: 1,
    isThreadListExpanded: false,
  });

describe("legacy sidebar thread visibility", () => {
  it("excludes pinned and Done threads from project previews and range selection", () => {
    const active = thread("active");
    const pinned = thread("pinned");
    const done = thread("done");
    const projectRows = filterLegacyProjectThreads(
      [done, pinned, active],
      new Set([keyOf(pinned), keyOf(done)]),
    );
    expect(projectRows).toEqual([active]);
    expect(preview(projectRows, keyOf(done)).renderedThreads).toEqual([active]);
    expect(preview([done], keyOf(done), false).renderedThreads).toEqual([done]);
  });
  it("hides pinned subagents and their folders but retains user-created forks", () => {
    const root = thread("root");
    const child = {
      ...thread("child", "subagent"),
      worktreePath: "/work/child",
      pinnedAt: "2026-09-30T01:00:00Z",
    };
    const fork = thread("fork", "fork");
    const archived = { ...thread("archived"), archivedAt: "2026-09-30T01:00:00Z" };
    const source = [root, child, fork, archived];
    const roster = filterSidebarV2VisibleThreads(source, null);
    expect(roster).toEqual([root, fork]);
    expect(groupLegacyWorkspaceThreads("p", roster).map((group) => group.label)).toEqual([
      "Main workspace",
    ]);
    expect(sortPinnedThreadsForSidebar(roster.filter((item) => item.pinnedAt !== null))).toEqual(
      [],
    );
    expect(preview(source, keyOf(child)).renderedThreads).toEqual([root]);
    expect(source).toEqual([root, child, fork, archived]);
  });

  it("does not let hidden agents consume the preview or trigger Show more", () => {
    const root = thread("root");
    const result = preview([thread("child", "subagent"), root]);
    expect(result.renderedThreads).toEqual([root]);
    expect(result.hasOverflowingThreads).toBe(false);
    expect(result.hiddenThreads).toEqual([]);
  });

  it("keeps the active thread beyond the preview, in its correct navigation position", () => {
    const threads = [thread("first"), thread("hidden"), thread("active")];
    const result = preview(threads, keyOf(threads[2]!));
    expect(result.renderedThreads.map((item) => item.id)).toEqual(["first", "active"]);
    expect(result.hiddenThreads.map((item) => item.id)).toEqual(["hidden"]);
    expect(result.hasOverflowingThreads).toBe(true);
  });

  it("does not select preview-hidden sessions when extending a visible range", () => {
    const threads = [thread("first"), thread("hidden"), thread("active")];
    const rows = preview(threads, keyOf(threads[2]!)).renderedThreads;
    const selection = useThreadSelectionStore.getState();
    selection.clearSelection();
    try {
      selection.setAnchor(keyOf(threads[0]!));
      selection.rangeSelectTo(keyOf(threads[2]!), rows.map(keyOf));
      expect([...useThreadSelectionStore.getState().selectedThreadKeys]).toEqual(rows.map(keyOf));
    } finally {
      useThreadSelectionStore.getState().clearSelection();
    }
  });

  it("keeps that active thread visible through a collapsed worktree folder", () => {
    const first = thread("first");
    const active = { ...thread("active"), worktreePath: "/work/feature" };
    const threads = [first, active];
    const group = groupLegacyWorkspaceThreads("p", threads)[1]!;
    const result = preview(threads, keyOf(active));
    expect(
      visibleLegacyWorkspaceThreads({
        projectKey: "p",
        threads: result.renderedThreads,
        showFolders: true,
        expandedByKey: { [group.key]: false },
        isActive: (item) => keyOf(item) === keyOf(active),
      }),
    ).toEqual([first, active]);
  });

  it("shows only the active user session in a collapsed project", () => {
    const root = thread("root");
    const fork = thread("fork", "fork");
    expect(preview([root, fork], keyOf(fork), false).renderedThreads).toEqual([fork]);
    const child = thread("child", "subagent");
    expect(preview([root, child], keyOf(child), false).shouldShowThreadPanel).toBe(false);
  });

  it("offers an empty project state when only archived sessions and agents remain", () => {
    expect(
      preview([
        thread("child", "subagent"),
        { ...thread("old"), archivedAt: "2026-09-30T01:00:00Z" },
      ]).showEmptyThreadState,
    ).toBe(true);
  });
});

describe("legacy pinned sessions and paging", () => {
  it("does not spend preview slots on collapsed worktrees or select their hidden sessions", () => {
    const closed = [thread("closed-1"), thread("closed-2")].map((item) => ({
      ...item,
      worktreePath: "/work/closed",
    }));
    const open = [thread("open-1"), thread("open-2"), thread("open-3")];
    const source = [...closed, ...open];
    const group = groupLegacyWorkspaceThreads("p", source)[0]!;
    const page = (extraPages: number) =>
      previewLegacySidebarThreads({
        threads: source,
        previewCount: 2,
        projectExpanded: true,
        isThreadListExpanded: extraPages > 0,
        extraPages,
        activeThreadKey: null,
        workspace: { projectKey: "p", expandedByKey: { [group.key]: false }, showFolders: true },
      });
    expect(page(0).renderedThreads).toEqual(open.slice(0, 2));
    expect(page(0).hiddenThreads).toEqual([open[2]]);
    expect(page(0).canShowMoreThreads).toBe(true);
    expect(page(1).renderedThreads).toEqual(open);
    expect(page(1).canShowMoreThreads).toBe(false);
    const selection = useThreadSelectionStore.getState();
    selection.clearSelection();
    try {
      selection.setAnchor(keyOf(open[0]!));
      selection.rangeSelectTo(keyOf(open[2]!), page(1).renderedThreads.map(keyOf));
      expect([...useThreadSelectionStore.getState().selectedThreadKeys]).toEqual(open.map(keyOf));
    } finally {
      selection.clearSelection();
    }
  });

  it("does not show an empty-project message or Show more when every folder is collapsed", () => {
    const source = [thread("main"), { ...thread("feature"), worktreePath: "/work/feature" }];
    const groups = groupLegacyWorkspaceThreads("p", source);
    const expandedByKey = Object.fromEntries(groups.map((group) => [group.key, false]));
    const input = {
      threads: source,
      previewCount: 1,
      projectExpanded: true,
      isThreadListExpanded: false,
      workspace: { projectKey: "p", expandedByKey, showFolders: true },
    };
    const closed = previewLegacySidebarThreads({ ...input, activeThreadKey: null });
    expect(closed.renderedThreads).toEqual([]);
    expect(closed.canShowMoreThreads).toBe(false);
    expect(closed.showEmptyThreadState).toBe(false);
    expect(
      previewLegacySidebarThreads({ ...input, activeThreadKey: keyOf(source[1]!) }).renderedThreads,
    ).toEqual([source[1]]);
  });

  it("keeps pinned-only worktrees in the folder roster while rendering their sessions once", () => {
    const pin = {
      ...thread("pin"),
      worktreePath: "/work/feature",
      pinnedAt: "2026-09-30T01:00:00Z",
    };
    const main = thread("main");
    const source = [pin, main];
    const groups = groupLegacyWorkspaceThreads("p", source);
    const roster = orderLegacyWorkspaceThreads(
      "p",
      filterLegacyProjectThreads(source, new Set([keyOf(pin)])),
      groups.map((group) => group.key),
    );
    const rendered = preview(roster).renderedThreads;
    expect(groups.map((group) => group.label)).toEqual(["feature", "Main workspace"]);
    expect([...source.filter((item) => item.pinnedAt), ...rendered]).toEqual([pin, main]);
  });

  it("renders eligible pinned sessions once without consuming project preview slots", () => {
    const first = { ...thread("pin"), pinnedAt: "2026-09-30T01:00:00Z" };
    const remote = { ...first, environmentId: EnvironmentId.make("remote") };
    const normal = thread("normal");
    const fork = thread("fork", "fork");
    const source = [first, remote, thread("agent", "subagent"), normal, fork];
    const pinned = [first];
    const projectRows = filterLegacyProjectThreads(source, new Set(pinned.map(keyOf)));
    // Remote server without pinning support is not in the pinned roster.
    expect(projectRows).toEqual([remote, normal, fork]);
    const rendered = preview(projectRows, keyOf(first)).renderedThreads;
    const navigation = [...pinned, ...rendered].map(keyOf);
    expect(navigation).toEqual([keyOf(first), keyOf(remote)]);
    expect(new Set(navigation).size).toBe(navigation.length);
    // Unpin puts the session back under its own project.
    expect(filterLegacyProjectThreads(source, new Set())).toEqual([first, remote, normal, fork]);
  });

  it("adds and removes one batch while keeping the active session reachable", () => {
    const source = Array.from({ length: 7 }, (_, index) => thread(String(index)));
    const page = (extraPages: number) =>
      previewLegacySidebarThreads({
        threads: source,
        previewCount: 2,
        extraPages,
        isThreadListExpanded: extraPages > 0,
        projectExpanded: true,
        activeThreadKey: keyOf(source[6]!),
      });
    expect(page(0).renderedThreads.map((item) => item.id)).toEqual(["0", "1", "6"]);
    expect(page(1).renderedThreads.map((item) => item.id)).toEqual(["0", "1", "2", "3", "6"]);
    expect(page(2).renderedThreads).toEqual(source);
    expect(page(2).canShowMoreThreads).toBe(false);
    expect(page(3).canShowMoreThreads).toBe(false);
    expect(page(3).canShowLessThreads).toBe(true);
    expect(page(0).canShowLessThreads).toBe(false);
    expect(page(1).hiddenThreads.map((item) => item.id)).toEqual(["4", "5"]);
  });
});
