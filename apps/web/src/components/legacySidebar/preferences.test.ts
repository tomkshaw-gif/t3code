import { describe, expect, it } from "vite-plus/test";
import { createMemoryStorage } from "../../lib/storage";
import {
  createLegacySidebarPreferences,
  mergeVisibleWorkspaceOrder,
  moveLegacySidebarItem,
  orderLegacyPinnedProjects,
  sanitizeWorkspaceOrders,
} from "./preferences";

describe("legacy folder arrangement", () => {
  it("moves a folder in either direction without moving any threads between workspaces", () => {
    expect(moveLegacySidebarItem(["main", "feature", "fix"], "fix", "main")).toEqual([
      "fix",
      "main",
      "feature",
    ]);
    expect(moveLegacySidebarItem(["main", "feature", "fix"], "main", "fix")).toEqual([
      "feature",
      "fix",
      "main",
    ]);
    expect(moveLegacySidebarItem(["main", "feature"], "removed", "main")).toEqual([
      "main",
      "feature",
    ]);
  });

  it("retains folders hidden behind Show more when the visible folders are rearranged", () => {
    expect(
      mergeVisibleWorkspaceOrder(["main", "hidden", "feature", "other"], ["feature", "main"]),
    ).toEqual(["feature", "hidden", "main", "other"]);
  });

  it("ignores stale or duplicate drag targets without losing newly added folders", () => {
    expect(
      mergeVisibleWorkspaceOrder(
        ["main", "new", "feature"],
        ["deleted", "feature", "feature", "main"],
      ),
    ).toEqual(["feature", "new", "main"]);
    expect(mergeVisibleWorkspaceOrder(["main", "feature"], ["deleted"])).toEqual([
      "main",
      "feature",
    ]);
  });

  it("restores each project's folder order after reload", () => {
    const storage = createMemoryStorage();
    const first = createLegacySidebarPreferences(storage);
    first.getState().setWorkspaceOrder("local-project", ["feature", "main", "feature"]);
    first.getState().setWorkspaceOrder("remote-project", ["main", "fix"]);
    const reloaded = createLegacySidebarPreferences(storage);
    expect(reloaded.getState().workspaceOrderByProject).toEqual({
      "local-project": ["feature", "main"],
      "remote-project": ["main", "fix"],
    });
  });

  it("rejects malformed saved orders without breaking navigation", () => {
    expect(
      sanitizeWorkspaceOrders({
        workspaceOrderByProject: { bad: false, good: ["main", 3, "main", "feature"] },
      }),
    ).toEqual({ good: ["main", "feature"] });
    expect(sanitizeWorkspaceOrders(null)).toEqual({});
  });
});

describe("legacy personal organization preferences", () => {
  it("upgrades existing folder preferences without losing their order", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      "t3code:legacy-sidebar-layout:v1",
      JSON.stringify({
        state: { workspaceOrderByProject: { project: ["feature", "main"] } },
        version: 0,
      }),
    );
    const store = createLegacySidebarPreferences(storage);
    expect(store.getState().workspaceOrderByProject).toEqual({ project: ["feature", "main"] });
    expect(store.getState().pinnedProjectKeys).toEqual([]);
    expect(store.getState().sessionColors).toEqual({});
    store.getState().toggleProjectPin("project");
    store.getState().setSessionColor(["local:session"], "yellow");
    expect(createLegacySidebarPreferences(storage).getState().workspaceOrderByProject).toEqual({
      project: ["feature", "main"],
    });
  });

  it("persists favorites and colours separately for sessions in different environments", () => {
    const storage = createMemoryStorage();
    const store = createLegacySidebarPreferences(storage);
    store.getState().toggleProjectPin("local-project");
    store.getState().toggleProjectPin("remote-project");
    store.getState().setSessionColor(["local:same-id"], "yellow");
    store.getState().setSessionColor(["remote:same-id"], "blue");
    let reloaded = createLegacySidebarPreferences(storage);
    expect(reloaded.getState().pinnedProjectKeys).toEqual(["local-project", "remote-project"]);
    expect(reloaded.getState().sessionColors).toEqual({
      "local:same-id": "yellow",
      "remote:same-id": "blue",
    });
    reloaded.getState().toggleProjectPin("local-project");
    reloaded.getState().setSessionColor(["local:same-id"], null);
    reloaded = createLegacySidebarPreferences(storage);
    expect(reloaded.getState().pinnedProjectKeys).toEqual(["remote-project"]);
    expect(reloaded.getState().sessionColors).toEqual({ "remote:same-id": "blue" });
  });

  it("ignores unsupported saved colours and malformed favorites", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      "t3code:legacy-sidebar-layout:v1",
      JSON.stringify({
        state: {
          pinnedProjectKeys: ["p", false, "p"],
          sessionColors: {
            good: "yellow",
            invalid: "chartreuse",
            object: { color: "red" },
            inherited: "constructor",
          },
        },
        version: 0,
      }),
    );
    const store = createLegacySidebarPreferences(storage);
    expect(store.getState().pinnedProjectKeys).toEqual(["p"]);
    expect(store.getState().sessionColors).toEqual({ good: "yellow" });
  });

  it("keeps favorites first while preserving the selected sort within each group", () => {
    const projects = [
      { projectKey: "b" },
      { projectKey: "a" },
      { projectKey: "d" },
      { projectKey: "c" },
    ];
    expect(orderLegacyPinnedProjects(projects, ["c", "a", "missing"])).toEqual([
      projects[1],
      projects[3],
      projects[0],
      projects[2],
    ]);
    expect(orderLegacyPinnedProjects(projects, [])).toEqual(projects);
  });
});
