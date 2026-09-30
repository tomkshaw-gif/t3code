import { describe, expect, it } from "vite-plus/test";
import type { ThreadStatusPill } from "../Sidebar.logic";
import { resolveThreadStatusTrailingIndicator } from "./synaraStatusLayout";

function status(label: ThreadStatusPill["label"]): ThreadStatusPill {
  return {
    label,
    colorClass: "",
    dotClass: "",
    pulse: label === "Working" || label === "Connecting",
  };
}

describe("Synara trailing status visibility", () => {
  it("leaves the slot empty for an idle thread", () => {
    expect(resolveThreadStatusTrailingIndicator({ status: null })).toBeNull();
  });

  it.each([
    "Completed",
    "Working",
    "Connecting",
    "Pending Approval",
    "Awaiting Input",
    "Plan Ready",
    "Waiting",
  ] as const)("gives the slot to a keyboard jump hint instead of overlapping %s", (label) => {
    const current = status(label);
    expect(
      resolveThreadStatusTrailingIndicator({ status: current, slotOccupied: true }),
    ).toBeNull();
    expect(resolveThreadStatusTrailingIndicator({ status: current, slotOccupied: false })).toBe(
      current,
    );
  });

  it("clears an unread completion for the active thread while retaining it elsewhere", () => {
    const completed = status("Completed");
    expect(resolveThreadStatusTrailingIndicator({ status: completed, isActive: true })).toBeNull();
    expect(resolveThreadStatusTrailingIndicator({ status: completed, isActive: false })).toBe(
      completed,
    );
  });

  it.each([
    "Working",
    "Connecting",
    "Pending Approval",
    "Awaiting Input",
    "Plan Ready",
    "Waiting",
  ] as const)("retains %s when its thread is active", (label) => {
    const current = status(label);
    expect(resolveThreadStatusTrailingIndicator({ status: current, isActive: true })).toBe(current);
  });
});
