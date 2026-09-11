import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import { resolveSidebarThreadStatus, type SidebarThreadStatus } from "../Sidebar.logic";

export type WorkerRowStatus = SidebarThreadStatus | "queued";

/**
 * Same status vocabulary as the sidebar plus "queued": a parked follow-up on
 * an otherwise-idle worker reads as queued, not idle.
 */
export function workerRowStatus(
  thread: Pick<
    EnvironmentThreadShell,
    "hasPendingApprovals" | "hasPendingUserInput" | "session" | "backgroundLiveness" | "queuedTurns"
  >,
): WorkerRowStatus {
  const status = resolveSidebarThreadStatus(thread);
  if (status === "ready" && (thread.queuedTurns?.length ?? 0) > 0) return "queued";
  return status;
}

const STATUS_ORDER: Record<WorkerRowStatus, number> = {
  approval: 0,
  input: 1,
  failed: 2,
  working: 3,
  queued: 4,
  monitoring: 5,
  ready: 6,
};

type WorkerStatusSource = Parameters<typeof workerRowStatus>[0];

/** Attention first, then in-flight, then settled — stable by createdAt. */
export function sortWorkerRows<R extends { thread: WorkerStatusSource & { createdAt: string } }>(
  rows: ReadonlyArray<R>,
): R[] {
  return [...rows].sort(
    (a, b) =>
      STATUS_ORDER[workerRowStatus(a.thread)] - STATUS_ORDER[workerRowStatus(b.thread)] ||
      a.thread.createdAt.localeCompare(b.thread.createdAt),
  );
}

/** True while a worker still has work in flight — drives auto-expand. */
export function workerRowInFlight(thread: WorkerStatusSource): boolean {
  const status = workerRowStatus(thread);
  return status === "working" || status === "queued" || status === "monitoring";
}
