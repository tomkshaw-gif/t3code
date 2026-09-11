import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, ThreadId, type OrchestrationQueuedTurn } from "@t3tools/contracts";
import { DEFAULT_RUNTIME_MODE } from "../../types";
import { sortWorkerRows, workerRowInFlight, workerRowStatus } from "./ComposerWorkersStrip.logic";

const runningSession = {
  threadId: ThreadId.make("thread-1"),
  status: "running" as const,
  providerName: "Codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  runtimeMode: DEFAULT_RUNTIME_MODE,
  activeTurnId: "turn-1" as never,
  lastError: null,
  updatedAt: "2026-03-09T10:00:00.000Z",
};

const idleWorker = {
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  session: null,
  backgroundLiveness: null,
  queuedTurns: [] as OrchestrationQueuedTurn[],
};

const queuedTurn = { messageId: "m1" } as unknown as OrchestrationQueuedTurn;

describe("workerRowStatus", () => {
  it("reports queued when a parked send sits on an idle worker", () => {
    expect(workerRowStatus({ ...idleWorker, queuedTurns: [queuedTurn] })).toBe("queued");
  });

  it("keeps working when a running worker also has a parked send", () => {
    expect(
      workerRowStatus({ ...idleWorker, session: runningSession, queuedTurns: [queuedTurn] }),
    ).toBe("working");
  });

  it("lets attention states outrank in-flight ones", () => {
    expect(
      workerRowStatus({ ...idleWorker, session: runningSession, hasPendingApprovals: true }),
    ).toBe("approval");
  });
});

describe("sortWorkerRows", () => {
  const at = (second: number) => new Date(Date.UTC(2026, 2, 9, 10, 0, second)).toISOString();
  const row = (id: string, second: number, status: object) => ({
    thread: { ...idleWorker, createdAt: at(second), ...status },
    id,
  });

  it("orders attention first, then in-flight, then settled", () => {
    const sorted = sortWorkerRows([
      row("idle", 0, {}),
      row("working", 1, { session: runningSession }),
      row("failed", 2, { session: { ...runningSession, status: "error" as const } }),
      row("queued", 3, { queuedTurns: [queuedTurn] }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["failed", "working", "queued", "idle"]);
  });

  it("keeps createdAt order inside a status", () => {
    const sorted = sortWorkerRows([
      row("later", 5, { session: runningSession }),
      row("earlier", 1, { session: runningSession }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["earlier", "later"]);
  });
});

describe("workerRowInFlight", () => {
  it("is true for working, queued, and monitoring only", () => {
    expect(workerRowInFlight({ ...idleWorker, session: runningSession })).toBe(true);
    expect(workerRowInFlight({ ...idleWorker, queuedTurns: [queuedTurn] })).toBe(true);
    expect(workerRowInFlight({ ...idleWorker, backgroundLiveness: "monitoring" })).toBe(true);
    expect(workerRowInFlight(idleWorker)).toBe(false);
    expect(workerRowInFlight({ ...idleWorker, hasPendingApprovals: true })).toBe(false);
  });
});
