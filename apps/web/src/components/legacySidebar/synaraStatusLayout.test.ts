import { describe, expect, it } from "vite-plus/test";
import type { ThreadStatusPill } from "../Sidebar.logic";
import { resolveThreadStatusTrailingIndicator } from "./synaraStatusLayout";
import { LEGACY_SESSION_COLORS, type LegacySessionColor } from "./sessionColors";

function status(label: ThreadStatusPill["label"]): ThreadStatusPill {
  return {
    label,
    colorClass: "",
    dotClass: "",
    pulse: label === "Working" || label === "Connecting",
  };
}

describe("Synara trailing status visibility", () => {
  it.each([
    null,
    "Completed",
    "Working",
    "Connecting",
    "Pending Approval",
    "Awaiting Input",
    "Plan Ready",
    "Waiting",
  ] as const)("keeps manual attention set while an active thread becomes %s", (label) => {
    expect(
      resolveThreadStatusTrailingIndicator({
        status: label ? status(label) : null,
        sessionColor: "pink",
        isActive: true,
      }),
    ).toMatchObject({ label: "Needs attention", pulse: false });
  });

  it("restores the current native indicator after attention is cleared", () => {
    const working = status("Working");
    const completed = status("Completed");
    expect(resolveThreadStatusTrailingIndicator({ status: working })).toBe(working);
    expect(resolveThreadStatusTrailingIndicator({ status: null })).toBeNull();
    expect(resolveThreadStatusTrailingIndicator({ status: completed, isActive: true })).toBeNull();
    expect(resolveThreadStatusTrailingIndicator({ status: completed, isActive: false })).toBe(
      completed,
    );
    const approval = status("Pending Approval");
    expect(resolveThreadStatusTrailingIndicator({ status: approval })).toBe(approval);
  });

  it.each(Object.keys(LEGACY_SESSION_COLORS) as LegacySessionColor[])(
    "shows a persistent %s dot for idle, active and running threads",
    (sessionColor) => {
      for (const current of [null, status("Completed"), status("Working")]) {
        expect(
          resolveThreadStatusTrailingIndicator({ status: current, sessionColor, isActive: true }),
        ).toMatchObject({
          label:
            sessionColor === "pink" ? "Needs attention" : LEGACY_SESSION_COLORS[sessionColor].label,
          pulse: false,
        });
      }
      expect(
        resolveThreadStatusTrailingIndicator({ status: null, sessionColor, slotOccupied: true }),
      ).toBeNull();
    },
  );

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
