import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { describe, expect, it } from "vite-plus/test";
import {
  alignLegacyProjectTreeThreads,
  arrangeLegacyProjectThreads,
  groupLegacyProjectTreeThreads,
  legacySubagentIndentPx,
} from "./threadTree";
import { previewLegacySidebarThreads } from "./threadVisibility";
import { groupLegacyWorkspaceThreads } from "./workspaceGroups";

function thread(id: string, relationship: "fork" | "subagent" | null = null, parentId = "root") {
  return {
    id: ThreadId.make(id),
    environmentId: EnvironmentId.make("local"),
    projectId: ProjectId.make("p"),
    archivedAt: null as string | null,
    deletedAt: null,
    lineage: {
      rootThreadId: ThreadId.make("root"),
      parentThreadId: relationship ? ThreadId.make(parentId) : null,
      relationshipToParent: relationship,
    },
    worktreePath: null as string | null,
    branch: null as string | null,
  };
}

const keyOf = (item: {
  environmentId: ReturnType<typeof EnvironmentId.make>;
  id: ReturnType<typeof ThreadId.make>;
}) => scopedThreadKey(scopeThreadRef(item.environmentId, item.id));

describe("legacy project thread tree", () => {
  it("keeps idle subagents out and reveals the open lineage", () => {
    const root = thread("root");
    const child = thread("child", "subagent");
    const grandchild = thread("grandchild", "subagent", "child");
    expect(arrangeLegacyProjectThreads({ threads: [root, child], activeThreadKey: null })).toEqual([
      { thread: root, depth: 0, rootKey: keyOf(root) },
    ]);
    expect(
      arrangeLegacyProjectThreads({
        threads: [grandchild, child, root],
        activeThreadKey: keyOf(grandchild),
      }).map((row) => ({ id: row.thread.id, depth: row.depth })),
    ).toEqual([
      { id: root.id, depth: 0 },
      { id: child.id, depth: 1 },
      { id: grandchild.id, depth: 2 },
    ]);
  });

  it("hides a subagent whose parent is not in the list", () => {
    expect(
      arrangeLegacyProjectThreads({
        threads: [thread("child", "subagent")],
        activeThreadKey: keyOf(thread("child", "subagent")),
      }),
    ).toEqual([]);
  });

  it("keeps a user fork beside its parent", () => {
    const root = thread("root");
    const fork = thread("fork", "fork");
    expect(
      arrangeLegacyProjectThreads({
        threads: [root, fork],
        activeThreadKey: keyOf(fork),
      }).map((row) => row.thread.id),
    ).toEqual(["root", "fork"]);
  });

  it("brings a pinned coordinator back only while its child is open", () => {
    const root = thread("root");
    const child = thread("child", "subagent");
    const pinnedKeys = new Set([keyOf(root)]);
    expect(
      arrangeLegacyProjectThreads({
        threads: [root, child],
        activeThreadKey: null,
        pinnedKeys,
      }),
    ).toEqual([]);
    expect(
      arrangeLegacyProjectThreads({
        threads: [root, child],
        activeThreadKey: keyOf(root),
        pinnedKeys,
      }),
    ).toEqual([]);
    expect(
      arrangeLegacyProjectThreads({
        threads: [root, child],
        activeThreadKey: keyOf(child),
        pinnedKeys,
      }).map((row) => row.thread.id),
    ).toEqual(["root", "child"]);
  });

  it("stops on a lineage cycle", () => {
    const left = thread("left", "subagent", "right");
    const right = thread("right", "subagent", "left");
    expect(
      arrangeLegacyProjectThreads({
        threads: [left, right],
        activeThreadKey: keyOf(left),
      }),
    ).toEqual([]);
    const root = thread("root");
    const loop = thread("loop", "subagent", "loop");
    expect(
      arrangeLegacyProjectThreads({
        threads: [root, loop],
        activeThreadKey: keyOf(loop),
      }).map((row) => row.thread.id),
    ).toEqual(["root"]);
  });

  it("groups an open child in its parent's folder and keeps the child's own path", () => {
    const root = thread("root");
    const child = { ...thread("child", "subagent"), worktreePath: "/work/child" };
    const rows = arrangeLegacyProjectThreads({
      threads: [root, child],
      activeThreadKey: keyOf(child),
    });
    expect(alignLegacyProjectTreeThreads(rows).map((item) => item.worktreePath)).toEqual([
      null,
      null,
    ]);
    const groups = groupLegacyProjectTreeThreads("p", rows);
    expect(groups.map((group) => group.label)).toEqual(["Main workspace"]);
    expect(groups[0]?.threads.map((item) => item.id)).toEqual(["root", "child"]);
    expect(groups[0]?.threads[1]?.worktreePath).toBe("/work/child");
    expect(groups[0]?.path).toBeNull();
  });

  it("does not let an idle subagent trigger Show more", () => {
    const root = thread("root");
    const result = previewLegacySidebarThreads({
      threads: [root, thread("child", "subagent"), thread("next")],
      previewCount: 1,
      projectExpanded: true,
      isThreadListExpanded: false,
      activeThreadKey: null,
    });
    expect(result.renderedThreads.map((item) => item.id)).toEqual(["root"]);
    expect(result.hasOverflowingThreads).toBe(true);
    expect(result.hiddenThreads.map((item) => item.id)).toEqual(["next"]);
  });

  it("shows siblings of the open child, and a closed project keeps only the lineage", () => {
    const root = thread("root");
    const earlier = thread("earlier", "subagent");
    const child = thread("child", "subagent");
    const later = thread("later", "subagent");
    const threads = [root, earlier, child, later];
    const open = previewLegacySidebarThreads({
      threads,
      previewCount: 10,
      projectExpanded: true,
      isThreadListExpanded: false,
      activeThreadKey: keyOf(child),
    });
    expect(open.renderedThreads.map((item) => item.id)).toEqual([
      "root",
      "earlier",
      "child",
      "later",
    ]);
    const collapsed = previewLegacySidebarThreads({
      threads,
      previewCount: 10,
      projectExpanded: false,
      isThreadListExpanded: false,
      activeThreadKey: keyOf(child),
    });
    expect(collapsed.renderedThreads.map((item) => item.id)).toEqual(["root", "child"]);
    expect([...collapsed.activeChainKeys]).toEqual([keyOf(child), keyOf(root)]);
  });

  it("pulls earlier siblings into view when the open child is past Show more", () => {
    const root = thread("root");
    const earlier = thread("earlier", "subagent");
    const child = thread("child", "subagent");
    const later = thread("later", "subagent");
    const result = previewLegacySidebarThreads({
      threads: [root, earlier, child, later],
      previewCount: 1,
      projectExpanded: true,
      isThreadListExpanded: false,
      activeThreadKey: keyOf(child),
    });
    expect(result.renderedThreads.map((item) => item.id)).toEqual(["root", "earlier", "child"]);
    expect(result.hiddenThreads.map((item) => item.id)).toEqual(["later"]);
  });

  it("keeps a pinned coordinator and its open child when the child's folder is collapsed", () => {
    const root = thread("root");
    const child = { ...thread("child", "subagent"), worktreePath: "/work/child" };
    const childFolder = groupLegacyWorkspaceThreads("p", [root, child]).find(
      (group) => group.path === "/work/child",
    );
    const flat = groupLegacyProjectTreeThreads(
      "p",
      arrangeLegacyProjectThreads({
        threads: [root, child],
        activeThreadKey: keyOf(child),
        pinnedKeys: new Set([keyOf(root)]),
      }),
    ).flatMap((group) => group.threads);
    const result = previewLegacySidebarThreads({
      threads: flat,
      previewCount: 10,
      projectExpanded: true,
      isThreadListExpanded: false,
      activeThreadKey: keyOf(child),
      pinnedKeys: new Set([keyOf(root)]),
      workspace: {
        projectKey: "p",
        expandedByKey: { [childFolder?.key ?? "missing"]: false },
        showFolders: true,
      },
    });
    expect(result.renderedThreads.map((item) => item.id)).toEqual(["root", "child"]);
    expect(result.rowDepthByKey[keyOf(child)]).toBe(1);
    expect(result.renderedThreads[1]?.worktreePath).toBe("/work/child");
  });

  it("caps the elbow indent", () => {
    expect(legacySubagentIndentPx(1)).toBe(0);
    expect(legacySubagentIndentPx(2)).toBe(10);
    expect(legacySubagentIndentPx(4)).toBe(30);
    expect(legacySubagentIndentPx(8)).toBe(30);
  });
});
