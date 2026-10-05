import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";
import {
  alignLegacyProjectTreeThreads,
  arrangeLegacyProjectThreads,
  type LegacyProjectThreadRow,
  type LegacyProjectTreeThread,
} from "./threadTree";
import { visibleLegacyWorkspaceThreads } from "./workspaceGroups";

type SidebarThread = LegacyProjectTreeThread;

export function filterLegacyProjectThreads<T extends SidebarThread>(
  threads: readonly T[],
  pinnedKeys: ReadonlySet<string>,
): T[] {
  return filterSidebarV2VisibleThreads(threads, null).filter(
    (thread) => !pinnedKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
  );
}

function keyOfThread(thread: SidebarThread): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

function activeRowIndex<T extends SidebarThread>(
  rows: readonly LegacyProjectThreadRow<T>[],
  activeThreadKey: string | null,
): number {
  if (!activeThreadKey) return -1;
  return rows.findIndex((row) => keyOfThread(row.thread) === activeThreadKey);
}

// Parent through the open thread. Earlier siblings share the root but are not this path.
function activeChainKeys<T extends SidebarThread>(
  rows: readonly LegacyProjectThreadRow<T>[],
  activeThreadKey: string | null,
): Set<string> {
  const keys = new Set<string>();
  const index = activeRowIndex(rows, activeThreadKey);
  const activeRow = index < 0 ? undefined : rows[index];
  if (!activeRow) return keys;
  keys.add(keyOfThread(activeRow.thread));
  let depth = activeRow.depth;
  for (let cursor = index - 1; cursor >= 0 && depth > 0; cursor -= 1) {
    const row = rows[cursor];
    if (!row || row.rootKey !== activeRow.rootKey) break;
    if (row.depth !== depth - 1) continue;
    keys.add(keyOfThread(row.thread));
    depth = row.depth;
  }
  return keys;
}

// Synara keeps the prefix from the coordinator through the open row when that
// row sits past Show more. Siblings after the open row stay on the next page.
function revealedPrefixKeys<T extends SidebarThread>(
  rows: readonly LegacyProjectThreadRow<T>[],
  activeThreadKey: string | null,
): Set<string> {
  const keys = new Set<string>();
  const index = activeRowIndex(rows, activeThreadKey);
  const activeRow = index < 0 ? undefined : rows[index];
  if (!activeRow) return keys;
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const row = rows[cursor];
    if (!row || row.rootKey !== activeRow.rootKey) break;
    keys.add(keyOfThread(row.thread));
    if (row.depth === 0) break;
  }
  return keys;
}

// Rendering and keyboard navigation share the same preview. An open subagent
// stays under its parent, including when that row is past Show more or the
// project is closed. Idle subagents do not take a preview slot.
export function previewLegacySidebarThreads<T extends SidebarThread>(input: {
  threads: readonly T[];
  previewCount: number;
  projectExpanded: boolean;
  isThreadListExpanded: boolean;
  activeThreadKey: string | null;
  extraPages?: number;
  pinnedKeys?: ReadonlySet<string>;
  workspace?: {
    projectKey: string;
    expandedByKey: Readonly<Record<string, boolean>>;
    showFolders: boolean;
    workspaceOrder?: readonly string[];
  };
}) {
  const arranged = arrangeLegacyProjectThreads({
    threads: input.threads,
    activeThreadKey: input.activeThreadKey,
    ...(input.pinnedKeys ? { pinnedKeys: input.pinnedKeys } : {}),
  });
  const chainKeys = activeChainKeys(arranged, input.activeThreadKey);
  const prefixKeys = revealedPrefixKeys(arranged, input.activeThreadKey);
  const rowByKey = new Map(arranged.map((row) => [keyOfThread(row.thread), row] as const));
  // Collapsed folders must not spend preview slots. A revealed child is grouped
  // with its parent so a folder collapse cannot drop the open lineage.
  const displayRows =
    input.projectExpanded && input.workspace
      ? visibleLegacyWorkspaceThreads({
          ...input.workspace,
          threads: alignLegacyProjectTreeThreads(arranged),
          isActive: (thread) => chainKeys.has(keyOfThread(thread)),
        }).flatMap((thread) => {
          const row = rowByKey.get(keyOfThread(thread));
          return row ? [row] : [];
        })
      : arranged;
  const threads = displayRows.map((row) => row.thread);
  const hasOverflowingThreads = threads.length > input.previewCount;
  const limit =
    input.isThreadListExpanded && input.extraPages === undefined
      ? threads.length
      : input.previewCount * (1 + Math.max(0, input.extraPages ?? 0));
  const renderedKeys = new Set(threads.slice(0, limit).map(keyOfThread));
  if (input.activeThreadKey && !renderedKeys.has(input.activeThreadKey)) {
    for (const thread of threads) {
      if (prefixKeys.has(keyOfThread(thread))) renderedKeys.add(keyOfThread(thread));
    }
  }
  const renderedThreads = input.projectExpanded
    ? threads.filter((thread) => renderedKeys.has(keyOfThread(thread)))
    : threads.filter((thread) => chainKeys.has(keyOfThread(thread)));
  const visibleKeys = new Set(renderedThreads.map(keyOfThread));
  const rowDepthByKey: Record<string, number> = {};
  for (const thread of renderedThreads) {
    rowDepthByKey[keyOfThread(thread)] = rowByKey.get(keyOfThread(thread))?.depth ?? 0;
  }
  return {
    renderedThreads,
    hiddenThreads: threads.filter((thread) => !visibleKeys.has(keyOfThread(thread))),
    hasOverflowingThreads,
    canShowMoreThreads: threads.length > limit && visibleKeys.size < threads.length,
    canShowLessThreads: limit > input.previewCount,
    shouldShowThreadPanel: input.projectExpanded || renderedThreads.length > 0,
    showEmptyThreadState:
      input.projectExpanded && arranged.length === 0 && !input.workspace?.showFolders,
    rowDepthByKey,
    activeChainKeys: chainKeys,
  };
}
