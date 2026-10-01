import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { SidebarThreadSummary } from "../types";

const keyOf = (thread: SidebarThreadSummary) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

// Adapted from Synara PR #1209; see components/legacySidebar/icons/Synara-LICENSE.
// Roll up before sidebar filters hide child rows.
// Every lineage edge is visited once, including nested agents and malformed cycles.
export function deriveWorkingSubagentThreadKeys(
  threads: readonly SidebarThreadSummary[],
): ReadonlySet<string> {
  const byKey = new Map(threads.map((thread) => [keyOf(thread), thread]));
  const workingParents = new Set<string>();
  for (const thread of threads) {
    if (
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      thread.hasPendingApprovals ||
      thread.hasPendingUserInput ||
      !threadRuntimeIsActive(thread.runtime)
    )
      continue;

    let child = thread;
    while (child.lineage.relationshipToParent === "subagent" && child.lineage.parentThreadId) {
      const parentKey = scopedThreadKey(
        scopeThreadRef(child.environmentId, child.lineage.parentThreadId),
      );
      if (workingParents.has(parentKey)) break;
      const parent = byKey.get(parentKey);
      if (!parent || parent.archivedAt !== null || parent.deletedAt !== null) break;
      workingParents.add(parentKey);
      child = parent;
    }
  }
  return workingParents;
}

export function withWorkingSubagentActivity(
  thread: SidebarThreadSummary,
  workingParents: ReadonlySet<string>,
): SidebarThreadSummary {
  return workingParents.has(keyOf(thread)) ? { ...thread, hasWorkingSubagents: true } : thread;
}
