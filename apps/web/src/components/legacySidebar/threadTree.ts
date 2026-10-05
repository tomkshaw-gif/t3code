import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { SidebarThreadSummary } from "../../types";
import { isSidebarSubagentThread } from "../Sidebar.logic";
import {
  groupLegacyWorkspaceThreads,
  type LegacyWorkspaceGroup,
  type WorkspaceProject,
} from "./workspaceGroups";

const EMPTY_PINNED_KEYS: ReadonlySet<string> = new Set();

export type LegacyProjectTreeThread = Pick<
  SidebarThreadSummary,
  "id" | "environmentId" | "projectId" | "archivedAt" | "lineage" | "worktreePath" | "branch"
> & {
  readonly deletedAt?: SidebarThreadSummary["deletedAt"];
};

export interface LegacyProjectThreadRow<T> {
  readonly thread: T;
  readonly depth: number;
  readonly rootKey: string;
}

// Depth 1 uses the icon slot. Each further level steps 10px, and the elbow stops at 3.
export function legacySubagentIndentPx(depth: number): number {
  return Math.max(0, Math.min(depth - 1, 3)) * 10;
}

function threadKeyOf(thread: Pick<LegacyProjectTreeThread, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

function subagentParentKey(thread: LegacyProjectTreeThread): string | null {
  if (!isSidebarSubagentThread(thread) || thread.lineage.parentThreadId == null) return null;
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.lineage.parentThreadId));
}

// Synara's project tree. Subagent children stay hidden until the open thread is in
// that lineage, then the ancestor chain is indented under the parent. Forks stay
// top-level. A missing parent hides its subtree. Pinned and Done roots stay in
// their own sections unless the open thread sits under them.
export function arrangeLegacyProjectThreads<T extends LegacyProjectTreeThread>(input: {
  threads: readonly T[];
  activeThreadKey: string | null;
  pinnedKeys?: ReadonlySet<string>;
}): LegacyProjectThreadRow<T>[] {
  const pinnedKeys = input.pinnedKeys ?? EMPTY_PINNED_KEYS;
  const byKey = new Map<string, T>();
  const eligible: T[] = [];
  for (const thread of input.threads) {
    if (thread.archivedAt !== null || thread.deletedAt != null) continue;
    const key = threadKeyOf(thread);
    if (byKey.has(key)) continue;
    byKey.set(key, thread);
    eligible.push(thread);
  }

  const childrenByParent = new Map<string, T[]>();
  const roots: T[] = [];
  for (const thread of eligible) {
    const parentKey = subagentParentKey(thread);
    if (parentKey && byKey.has(parentKey)) {
      const siblings = childrenByParent.get(parentKey);
      if (siblings) siblings.push(thread);
      else childrenByParent.set(parentKey, [thread]);
      continue;
    }
    // Orphans stay hidden. Promoting them would show a coordinator's agents as chats.
    if (parentKey) continue;
    roots.push(thread);
  }

  const ancestorKeys = new Set<string>();
  if (input.activeThreadKey) {
    const seen = new Set<string>();
    let current: string | null = input.activeThreadKey;
    while (current && !seen.has(current)) {
      seen.add(current);
      const thread = byKey.get(current);
      if (!thread) break;
      const parentKey = subagentParentKey(thread);
      if (!parentKey || !byKey.has(parentKey)) break;
      ancestorKeys.add(parentKey);
      current = parentKey;
    }
  }

  const rows: LegacyProjectThreadRow<T>[] = [];
  const visited = new Set<string>();
  const visit = (thread: T, depth: number, rootKey: string) => {
    const key = threadKeyOf(thread);
    if (visited.has(key)) return;
    visited.add(key);
    rows.push({ thread, depth, rootKey });
    if (!ancestorKeys.has(key)) return;
    for (const child of childrenByParent.get(key) ?? []) {
      visit(child, depth + 1, rootKey);
    }
  };

  for (const root of roots) {
    const key = threadKeyOf(root);
    // The open thread itself stays in Pinned or Done. Bring the root back only
    // so an open child has a parent row to sit under.
    if (pinnedKeys.has(key) && !ancestorKeys.has(key)) continue;
    visit(root, 0, key);
  }

  return rows;
}

export function alignLegacyProjectTreeThreads<T extends LegacyProjectTreeThread>(
  rows: readonly LegacyProjectThreadRow<T>[],
): T[] {
  const rootThreadByKey = new Map<string, T>();
  for (const row of rows) {
    if (row.depth === 0) rootThreadByKey.set(row.rootKey, row.thread);
  }
  return rows.map((row) => {
    const root = rootThreadByKey.get(row.rootKey);
    if (row.depth === 0 || !root) return row.thread;
    // Group with the coordinator's checkout. The rendered row keeps its own path.
    return {
      ...row.thread,
      worktreePath: root.worktreePath,
      branch: root.branch,
      projectId: root.projectId,
    };
  });
}

export function groupLegacyProjectTreeThreads<T extends LegacyProjectTreeThread>(
  projectKey: string,
  rows: readonly LegacyProjectThreadRow<T>[],
  preferredOrder: readonly string[] = [],
  projects: readonly WorkspaceProject[] = [],
): LegacyWorkspaceGroup<T>[] {
  const realByKey = new Map(rows.map((row) => [threadKeyOf(row.thread), row.thread] as const));
  return groupLegacyWorkspaceThreads(
    projectKey,
    alignLegacyProjectTreeThreads(rows),
    preferredOrder,
    projects,
  ).map((group) => ({
    ...group,
    threads: group.threads.flatMap((thread) => {
      const real = realByKey.get(threadKeyOf(thread));
      return real ? [real] : [];
    }),
  }));
}
