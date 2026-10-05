import { describe, expect, it } from "vite-plus/test";
import { resolveLegacyTerminalBadge, type LegacyTerminalStatus } from "./terminalBadge";

const running: LegacyTerminalStatus = {
  label: "Terminal process running",
  colorClass: "text-teal-600",
  pulse: true,
};

describe("resolveLegacyTerminalBadge", () => {
  it("hides the chip when nothing is running", () => {
    expect(resolveLegacyTerminalBadge({ runningCount: 0, status: null })).toBeNull();
  });

  it("shows the pulsing glyph for one running terminal", () => {
    expect(resolveLegacyTerminalBadge({ runningCount: 1, status: running })).toEqual({
      tooltip: "Terminal process running",
      count: null,
      colorClass: "text-teal-600",
      pulse: true,
    });
  });

  it("replaces the glyph with a count when several terminals are running", () => {
    expect(resolveLegacyTerminalBadge({ runningCount: 3, status: running })).toEqual({
      tooltip: "3 terminals open",
      count: 3,
      colorClass: "text-teal-600",
      pulse: false,
    });
  });
});
