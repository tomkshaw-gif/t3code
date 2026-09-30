import { describe, expect, it } from "vite-plus/test";
import {
  groupLegacyWorkspaceThreads,
  hasLegacyWorkspaceFolders,
  orderLegacyWorkspaceThreads,
  visibleLegacyWorkspaceThreads,
} from "./workspaceGroups";

const thread = (id: string, worktreePath: string | null, environmentId = "local") => ({
  id,
  worktreePath,
  environmentId,
  projectId: "project",
  branch: null,
});

describe("legacy workspace navigation", () => {
  it("names grouped physical checkouts without changing their worktree semantics or saved keys", () => {
    const threads = [thread("futures", null), { ...thread("cfd", null), projectId: "cfd" }];
    const projects = [
      {
        environmentId: "local",
        id: "project",
        workspaceRoot: "C:\\CODEX\\trade-copier-mvp",
        title: "Futures",
      },
      {
        environmentId: "local",
        id: "cfd",
        workspaceRoot: "C:\\CODEX\\trade-copier-mvp-cfd\\",
        title: "CFD",
      },
    ];
    const original = groupLegacyWorkspaceThreads("repo", threads);
    const named = groupLegacyWorkspaceThreads("repo", threads, [], projects);
    expect(named.map((group) => group.label)).toEqual(["trade-copier-mvp", "trade-copier-mvp-cfd"]);
    expect(named.map((group) => group.path)).toEqual([null, null]);
    expect(named.map((group) => group.key)).toEqual(original.map((group) => group.key));
    expect(named[1]!.displayPath).toBe(projects[1]!.workspaceRoot);
    const ordered = groupLegacyWorkspaceThreads("repo", threads, [original[1]!.key], projects);
    expect(ordered.map((group) => group.threads[0]!.id)).toEqual(["cfd", "futures"]);
  });

  it("uses the explicit worktree name instead of the main project's folder", () => {
    const groups = groupLegacyWorkspaceThreads(
      "repo",
      [thread("feature", "/work/fix-stops")],
      [],
      [{ environmentId: "local", id: "project", workspaceRoot: "/work/main", title: "Repo" }],
    );
    expect(groups[0]!.label).toBe("fix-stops");
    expect(groups[0]!.displayPath).toBe("/work/fix-stops");
    expect(groups[0]!.path).toBe("/work/fix-stops");
  });

  it("distinguishes checkouts with identical folder basenames", () => {
    const groups = groupLegacyWorkspaceThreads(
      "repo",
      [thread("local", null), thread("remote", null, "remote")],
      [],
      [
        { environmentId: "local", id: "project", workspaceRoot: "/local/repo", title: "Repo" },
        {
          environmentId: "remote",
          id: "project",
          workspaceRoot: "/remote/repo",
          title: "Repo",
          environmentLabel: "Server",
        },
      ],
    );
    expect(groups.map((group) => group.label)).toEqual(["repo · /local/repo", "repo · Server"]);
  });

  it("keeps names distinct when grouped checkouts share an environment label and basename", () => {
    const groups = groupLegacyWorkspaceThreads(
      "repo",
      [thread("a", null), { ...thread("b", null), projectId: "other" }],
      [],
      [
        {
          environmentId: "local",
          environmentLabel: "Local",
          id: "project",
          workspaceRoot: "C:\\first\\repo",
          title: "Repo",
        },
        {
          environmentId: "local",
          environmentLabel: "Local",
          id: "other",
          workspaceRoot: "C:\\second\\repo",
          title: "Repo",
        },
      ],
    );
    expect(new Set(groups.map((group) => group.label)).size).toBe(2);
    expect(groups[0]!.label).toContain("C:\\first\\repo");
    expect(groups[1]!.label).toContain("C:\\second\\repo");
  });

  it("uses saved folder order for both rows and keyboard navigation", () => {
    const threads = [
      thread("main", null),
      thread("feature", "/work/feature"),
      thread("fix", "/work/fix"),
    ];
    const groups = groupLegacyWorkspaceThreads("p", threads);
    const saved = [groups[2]!.key, groups[0]!.key];
    expect(orderLegacyWorkspaceThreads("p", threads, saved).map((item) => item.id)).toEqual([
      "fix",
      "main",
      "feature",
    ]);
    expect(
      visibleLegacyWorkspaceThreads({
        projectKey: "p",
        threads,
        workspaceOrder: saved,
        expandedByKey: {},
        isActive: () => false,
      }).map((item) => item.id),
    ).toEqual(["fix", "main", "feature"]);
  });
  it("keeps a single main workspace flat", () => {
    expect(hasLegacyWorkspaceFolders(groupLegacyWorkspaceThreads("p", [thread("1", null)]))).toBe(
      false,
    );
  });

  it("groups each checkout while keeping sorted order inside it", () => {
    const threads = [thread("a", "/work/feature"), thread("b", null), thread("c", "/work/feature")];
    const groups = groupLegacyWorkspaceThreads("p", threads);
    expect(groups.map((group) => group.label)).toEqual(["feature", "Main workspace"]);
    expect(orderLegacyWorkspaceThreads("p", threads).map((item) => item.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(hasLegacyWorkspaceFolders(groups)).toBe(true);
  });

  it("never combines identical paths across environments or physical projects", () => {
    const threads = [
      thread("a", "/work/feature"),
      thread("b", "/work/feature", "remote"),
      { ...thread("c", "/work/feature"), projectId: "other" },
    ];
    expect(groupLegacyWorkspaceThreads("p", threads)).toHaveLength(3);
  });

  it("normalizes Windows separators and case but preserves POSIX case", () => {
    expect(
      groupLegacyWorkspaceThreads("p", [
        thread("a", "C:\\Work\\Feature\\"),
        thread("b", "c:/work/feature"),
      ]),
    ).toHaveLength(1);
    expect(
      groupLegacyWorkspaceThreads("p", [
        thread("a", "/work/Feature"),
        thread("b", "/work/feature"),
      ]),
    ).toHaveLength(2);
  });

  it("groups Windows UNC paths despite case and separator differences", () => {
    expect(
      groupLegacyWorkspaceThreads("p", [
        thread("a", "\\\\Server\\Share\\Feature\\"),
        thread("b", "//server/share/feature"),
      ]),
    ).toHaveLength(1);
  });

  it("keeps the active thread visible when its folder is collapsed", () => {
    const threads = [
      thread("active", "/work/feature"),
      thread("hidden", "/work/feature"),
      thread("main", null),
    ];
    const group = groupLegacyWorkspaceThreads("p", threads)[0]!;
    const visible = visibleLegacyWorkspaceThreads({
      projectKey: "p",
      threads,
      expandedByKey: { [group.key]: false },
      isActive: (item) => item.id === "active",
    });
    expect(visible.map((item) => item.id)).toEqual(["active", "main"]);
  });

  it("respects collapsed folders when the preview contains only the main workspace", () => {
    const threads = [thread("main", null)];
    const group = groupLegacyWorkspaceThreads("p", threads)[0]!;
    const visible = visibleLegacyWorkspaceThreads({
      projectKey: "p",
      threads,
      showFolders: true,
      expandedByKey: { [group.key]: false },
      isActive: () => false,
    });
    expect(visible).toEqual([]);
  });

  it("restores navigation order when a folder is reopened", () => {
    const threads = [
      thread("a", "/work/feature"),
      thread("main", null),
      thread("b", "/work/feature"),
    ];
    const groups = groupLegacyWorkspaceThreads("p", threads);
    const closed = { [groups[0]!.key]: false };
    const input = { projectKey: "p", threads, isActive: () => false };
    expect(
      visibleLegacyWorkspaceThreads({ ...input, expandedByKey: closed }).map((item) => item.id),
    ).toEqual(["main"]);
    expect(
      visibleLegacyWorkspaceThreads({ ...input, expandedByKey: {} }).map((item) => item.id),
    ).toEqual(["a", "b", "main"]);
  });
});
