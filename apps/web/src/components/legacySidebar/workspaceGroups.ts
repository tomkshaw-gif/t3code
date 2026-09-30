interface WorkspaceThread {
  readonly environmentId: string;
  readonly projectId: string;
  readonly worktreePath: string | null;
  readonly branch: string | null;
}

export interface LegacyWorkspaceGroup<T> {
  key: string;
  label: string;
  path: string | null;
  threads: T[];
}

function workspacePathKey(path: string | null): string | null {
  if (!path) return null;
  // Windows paths are case insensitive; POSIX paths are not. Environment and
  // physical project remain part of the key even when two paths are identical.
  return /^(?:[a-z]:[\\/]|\\\\|\/\/[^/]+\/[^/]+)/i.test(path)
    ? path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
    : path.replace(/\/+$/, "") || "/";
}

export function groupLegacyWorkspaceThreads<T extends WorkspaceThread>(
  projectKey: string,
  threads: readonly T[],
  preferredOrder: readonly string[] = [],
): LegacyWorkspaceGroup<T>[] {
  const groups = new Map<string, LegacyWorkspaceGroup<T>>();
  for (const thread of threads) {
    const key = `legacy-workspace:${JSON.stringify([
      projectKey,
      thread.environmentId,
      thread.projectId,
      workspacePathKey(thread.worktreePath),
    ])}`;
    let group = groups.get(key);
    if (!group) {
      const folderName = thread.worktreePath
        ?.replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .at(-1);
      group = {
        key,
        label: thread.worktreePath ? folderName || thread.branch || "Worktree" : "Main workspace",
        path: thread.worktreePath,
        threads: [],
      };
      groups.set(key, group);
    }
    group.threads.push(thread);
  }
  const ranks = new Map(preferredOrder.map((key, index) => [key, index]));
  return [...groups.values()].sort(
    (left, right) =>
      (ranks.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
      (ranks.get(right.key) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function orderLegacyWorkspaceThreads<T extends WorkspaceThread>(
  projectKey: string,
  threads: readonly T[],
  preferredOrder: readonly string[] = [],
): T[] {
  return groupLegacyWorkspaceThreads(projectKey, threads, preferredOrder).flatMap(
    (group) => group.threads,
  );
}

export function hasLegacyWorkspaceFolders<T>(groups: readonly LegacyWorkspaceGroup<T>[]): boolean {
  return groups.length > 1 || groups.some((group) => group.path !== null);
}

export function visibleLegacyWorkspaceThreads<T extends WorkspaceThread>(input: {
  projectKey: string;
  threads: readonly T[];
  expandedByKey: Readonly<Record<string, boolean>>;
  isActive: (thread: T) => boolean;
  showFolders?: boolean;
  workspaceOrder?: readonly string[];
}): T[] {
  const groups = groupLegacyWorkspaceThreads(input.projectKey, input.threads, input.workspaceOrder);
  if (!(input.showFolders ?? hasLegacyWorkspaceFolders(groups))) return [...input.threads];
  return groups.flatMap((group) =>
    input.expandedByKey[group.key] !== false ? group.threads : group.threads.filter(input.isActive),
  );
}
