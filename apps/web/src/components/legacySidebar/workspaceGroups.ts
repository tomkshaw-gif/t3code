interface WorkspaceThread {
  readonly environmentId: string;
  readonly projectId: string;
  readonly worktreePath: string | null;
  readonly branch: string | null;
}

interface WorkspaceProject {
  readonly environmentId: string;
  readonly id: string;
  readonly workspaceRoot: string;
  readonly title: string;
  readonly environmentLabel?: string | null;
}

export interface LegacyWorkspaceGroup<T> {
  key: string;
  label: string;
  path: string | null;
  displayPath: string | null;
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
  projects: readonly WorkspaceProject[] = [],
): LegacyWorkspaceGroup<T>[] {
  const groups = new Map<string, LegacyWorkspaceGroup<T>>();
  const projectByKey = new Map(
    projects.map((project) => [JSON.stringify([project.environmentId, project.id]), project]),
  );
  for (const thread of threads) {
    const key = `legacy-workspace:${JSON.stringify([
      projectKey,
      thread.environmentId,
      thread.projectId,
      workspacePathKey(thread.worktreePath),
    ])}`;
    let group = groups.get(key);
    if (!group) {
      const project = projectByKey.get(JSON.stringify([thread.environmentId, thread.projectId]));
      const displayPath = thread.worktreePath ?? project?.workspaceRoot ?? null;
      const folderName = displayPath
        ?.replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .at(-1);
      group = {
        key,
        label:
          folderName ||
          (thread.worktreePath ? thread.branch || "Worktree" : project?.title || "Main workspace"),
        // The main checkout remains null for T3's new-thread/worktree semantics.
        path: thread.worktreePath,
        displayPath,
        threads: [],
      };
      groups.set(key, group);
    }
    group.threads.push(thread);
  }
  const labelCounts = new Map<string, number>();
  for (const group of groups.values()) {
    labelCounts.set(group.label, (labelCounts.get(group.label) ?? 0) + 1);
  }
  for (const group of groups.values()) {
    if ((labelCounts.get(group.label) ?? 0) < 2) continue;
    const thread = group.threads[0]!;
    const project = projectByKey.get(JSON.stringify([thread.environmentId, thread.projectId]));
    group.label += ` · ${project?.environmentLabel || group.displayPath || thread.environmentId}`;
  }
  // Two checkouts can share both a folder basename and an environment label.
  // Include the checkout path in that case, then scoped identity if even the
  // path is identical (e.g. the same remote path in separate environments).
  const ambiguousLabels = new Set<string>();
  const seenLabels = new Set<string>();
  for (const group of groups.values()) {
    if (seenLabels.has(group.label)) ambiguousLabels.add(group.label);
    seenLabels.add(group.label);
  }
  for (const group of groups.values()) {
    if (!ambiguousLabels.has(group.label)) continue;
    const thread = group.threads[0]!;
    group.label += ` · ${group.displayPath ?? thread.projectId} (${thread.environmentId}/${thread.projectId})`;
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
