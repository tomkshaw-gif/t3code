import type { SidebarThreadSummary } from "../../types";
import { formatWorktreePathForDisplay } from "../../worktreeCleanup";

export interface LegacyThreadMetaChip {
  id: "fork" | "worktree";
  tooltip: string;
  colorClass: string;
}

// Synara's fork -> worktree order, adapted to T3's authoritative lineage.
// Creating a worktree and forking a conversation are independent operations.
export function resolveLegacyThreadMetaChips(
  thread: Pick<SidebarThreadSummary, "lineage" | "worktreePath" | "branch">,
): LegacyThreadMetaChip[] {
  const chips: LegacyThreadMetaChip[] = [];
  if (thread.lineage.relationshipToParent === "fork" && thread.lineage.parentThreadId) {
    chips.push({
      id: "fork",
      tooltip: "Forked thread",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
    });
  }
  const path = thread.worktreePath?.trim();
  if (path) {
    const displayPath = formatWorktreePathForDisplay(path);
    chips.push({
      id: "worktree",
      tooltip: thread.branch
        ? `Worktree: ${displayPath} (${thread.branch})`
        : `Worktree: ${displayPath}`,
      colorClass: "text-muted-foreground/55",
    });
  }
  return chips;
}
