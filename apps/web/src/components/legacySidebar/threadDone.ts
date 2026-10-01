import type { EnvironmentId } from "@t3tools/contracts";
import type { SidebarThreadSummary } from "../../types";

export function isLegacyThreadDone(
  thread: Pick<SidebarThreadSummary, "settledOverride">,
  supportsSettlement: boolean,
): boolean {
  return supportsSettlement && thread.settledOverride === "settled";
}

export function partitionLegacySidebarThreads<
  T extends Pick<SidebarThreadSummary, "environmentId" | "settledOverride">,
>(threads: readonly T[], settlementEnvironmentIds: ReadonlySet<EnvironmentId>) {
  const active: T[] = [];
  const done: T[] = [];
  for (const thread of threads) {
    (isLegacyThreadDone(thread, settlementEnvironmentIds.has(thread.environmentId))
      ? done
      : active
    ).push(thread);
  }
  return { active, done };
}

export async function toggleLegacyThreadDone(
  thread: Pick<SidebarThreadSummary, "settledOverride" | "lastVisitedAt">,
  input: {
    visitedAt: string;
    settle: () => Promise<boolean>;
    unsettle: () => Promise<boolean>;
    visit: (visitedAt: string) => Promise<boolean>;
    markLocal: (visitedAt: string) => void;
  },
): Promise<boolean> {
  if (thread.settledOverride === "settled") return input.unsettle();
  if (!(await input.settle())) return false;
  // The click's watermark must not consume a completion that arrives while settling.
  if (thread.lastVisitedAt !== undefined && !(await input.visit(input.visitedAt))) return false;
  input.markLocal(input.visitedAt);
  return true;
}
