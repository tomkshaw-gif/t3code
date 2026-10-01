import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { makeThreadFixture } from "../../test-fixtures";
import {
  isLegacyThreadDone,
  partitionLegacySidebarThreads,
  toggleLegacyThreadDone,
} from "./threadDone";

const visitedAt = "2026-10-01T02:00:00Z";
function actions() {
  return {
    visitedAt,
    settle: vi.fn(async () => true),
    unsettle: vi.fn(async () => true),
    visit: vi.fn(async (_watermark: string) => true),
    markLocal: vi.fn(),
  };
}

describe("shared sidebar Done state", () => {
  it("moves only explicit Done threads on supported environments out of project lists", () => {
    const local = EnvironmentId.make("local");
    const remote = EnvironmentId.make("remote");
    const done = makeThreadFixture({ environmentId: local, settledOverride: "settled" });
    const restored = makeThreadFixture({
      environmentId: local,
      settledOverride: "active",
      settledAt: visitedAt,
    });
    const unsupported = makeThreadFixture({ environmentId: remote, settledOverride: "settled" });
    const result = partitionLegacySidebarThreads([done, restored, unsupported], new Set([local]));
    expect(result.done).toEqual([done]);
    expect(result.active).toEqual([restored, unsupported]);
    expect(isLegacyThreadDone({ ...done, settledOverride: null }, true)).toBe(false);
    expect(partitionLegacySidebarThreads([done], new Set()).active).toEqual([done]);
  });

  it("returns an undone thread to its project without changing read state", async () => {
    const input = actions();
    expect(
      await toggleLegacyThreadDone(makeThreadFixture({ settledOverride: "settled" }), input),
    ).toBe(true);
    expect(input.unsettle).toHaveBeenCalledOnce();
    expect(input.settle).not.toHaveBeenCalled();
    expect(input.visit).not.toHaveBeenCalled();
    expect(input.markLocal).not.toHaveBeenCalled();
    const restored = makeThreadFixture({ settledOverride: "active", settledAt: visitedAt });
    expect(
      partitionLegacySidebarThreads([restored], new Set([restored.environmentId])).done,
    ).toEqual([]);
  });

  it("marks a successfully settled thread read using the click's original watermark", async () => {
    const input = actions();
    let finishSettlement = (_success: boolean) => {};
    const settlement = new Promise<boolean>((resolve) => {
      finishSettlement = resolve;
    });
    input.settle.mockImplementation(() => settlement);
    const result = toggleLegacyThreadDone(makeThreadFixture({ lastVisitedAt: null }), input);
    expect(input.visit).not.toHaveBeenCalled();
    finishSettlement(true);
    expect(await result).toBe(true);
    expect(input.visit).toHaveBeenCalledWith(visitedAt);
    expect(input.markLocal).toHaveBeenCalledWith(visitedAt);
  });

  it("does not mark read when settling fails", async () => {
    const input = actions();
    input.settle.mockResolvedValue(false);
    expect(await toggleLegacyThreadDone(makeThreadFixture(), input)).toBe(false);
    expect(input.visit).not.toHaveBeenCalled();
    expect(input.markLocal).not.toHaveBeenCalled();
  });

  it("retains local unread state if the server rejects its read watermark", async () => {
    const input = actions();
    input.visit.mockResolvedValue(false);
    expect(await toggleLegacyThreadDone(makeThreadFixture({ lastVisitedAt: null }), input)).toBe(
      false,
    );
    expect(input.settle).toHaveBeenCalledOnce();
    expect(input.markLocal).not.toHaveBeenCalled();
  });

  it("keeps the local read-tracking fallback for older servers", async () => {
    const input = actions();
    expect(await toggleLegacyThreadDone({ settledOverride: null }, input)).toBe(true);
    expect(input.visit).not.toHaveBeenCalled();
    expect(input.markLocal).toHaveBeenCalledWith(visitedAt);
  });

  it("reports an Undo failure without changing read state", async () => {
    const input = actions();
    input.unsettle.mockResolvedValue(false);
    expect(
      await toggleLegacyThreadDone(makeThreadFixture({ settledOverride: "settled" }), input),
    ).toBe(false);
    expect(input.markLocal).not.toHaveBeenCalled();
  });
});
