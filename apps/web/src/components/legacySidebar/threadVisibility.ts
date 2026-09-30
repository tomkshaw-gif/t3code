import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { SidebarThreadSummary } from "../../types";
import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";

type SidebarThread = Pick<
  SidebarThreadSummary,
  "id" | "environmentId" | "projectId" | "archivedAt" | "lineage"
>;

export function filterLegacyProjectThreads<T extends SidebarThread>(
  threads: readonly T[],
  pinnedKeys: ReadonlySet<string>,
): T[] {
  return filterSidebarV2VisibleThreads(threads, null).filter(
    (thread) => !pinnedKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
  );
}

// Rendering and keyboard navigation share the same preview. An active thread
// remains visible even when it falls beyond Show more or its project is closed.
export function previewLegacySidebarThreads<T extends SidebarThread>(input: {
  threads: readonly T[];
  previewCount: number;
  projectExpanded: boolean;
  isThreadListExpanded: boolean;
  activeThreadKey: string | null;
  extraPages?: number;
}) {
  const threads = filterSidebarV2VisibleThreads(input.threads, null);
  const keyOf = (thread: T) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
  const active = threads.find((thread) => keyOf(thread) === input.activeThreadKey);
  const hasOverflowingThreads = threads.length > input.previewCount;
  const limit =
    input.isThreadListExpanded && input.extraPages === undefined
      ? threads.length
      : input.previewCount * (1 + Math.max(0, input.extraPages ?? 0));
  const preview = threads.slice(0, limit);
  const renderedKeys = new Set(preview.map(keyOf));
  if (active) renderedKeys.add(keyOf(active));
  const renderedThreads = input.projectExpanded
    ? threads.filter((thread) => renderedKeys.has(keyOf(thread)))
    : active
      ? [active]
      : [];
  const visibleKeys = new Set(renderedThreads.map(keyOf));
  return {
    renderedThreads,
    hiddenThreads: threads.filter((thread) => !visibleKeys.has(keyOf(thread))),
    hasOverflowingThreads,
    canShowMoreThreads: threads.length > limit && visibleKeys.size < threads.length,
    canShowLessThreads: limit > input.previewCount,
    shouldShowThreadPanel: input.projectExpanded || active !== undefined,
    showEmptyThreadState: input.projectExpanded && threads.length === 0,
  };
}
