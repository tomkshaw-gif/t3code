import type { ThreadStatusPill } from "../Sidebar.logic";
import { cn } from "../../lib/utils";
import type { LegacySessionColor } from "./sessionColors";

export type LegacyThreadStatusIndicator =
  | ThreadStatusPill
  | (Omit<ThreadStatusPill, "label"> & { label: "Needs attention" });

const needsAttentionStatus: LegacyThreadStatusIndicator = {
  label: "Needs attention",
  colorClass: "text-[#eab308]",
  dotClass: "bg-[#eab308]",
  pulse: false,
};

// Ported from Synara 529ad049cb106c998010f5400189515008997aa4:
// sidebarRowStyles.ts and Sidebar.tsx/Sidebar.logic.ts. See icons/Synara-LICENSE.
// T3 scale utilities below are pixel-equivalent to Synara's arbitrary rem values.
export function sidebarHoverRevealHideClassName(group: "project-header" | "thread-row"): string {
  return group === "project-header"
    ? "transition-opacity group-hover/project-header:pointer-events-none group-hover/project-header:opacity-0 group-has-[:focus-visible]/project-header:pointer-events-none group-has-[:focus-visible]/project-header:opacity-0"
    : "transition-opacity group-hover/thread-row:pointer-events-none group-hover/thread-row:opacity-0 group-focus-within/thread-row:pointer-events-none group-focus-within/thread-row:opacity-0";
}

export function threadRowStatusSlotClassName(): string {
  return cn(
    "flex w-[15px] shrink-0 items-center justify-center leading-none tabular-nums",
    sidebarHoverRevealHideClassName("thread-row"),
    "text-muted-foreground/38",
  );
}

export function resolveThreadStatusTrailingIndicator(input: {
  status: ThreadStatusPill | null;
  sessionColor?: LegacySessionColor | undefined;
  slotOccupied?: boolean;
  isActive?: boolean;
}): LegacyThreadStatusIndicator | null {
  const { status } = input;
  if (input.slotOccupied === true) {
    return null;
  }
  // A personal attention marker survives visits and runtime changes until cleared.
  if (input.sessionColor === "yellow") return needsAttentionStatus;
  if (status === null) return null;
  if (status.label === "Completed" && input.isActive === true) {
    return null;
  }
  return status;
}

export function resolveThreadRowTrailingReserveClass(input: {
  metaChipCount: number;
  hasTrailingGlyph: boolean;
}): string {
  const hoverReserve =
    "transition-[padding] duration-150 ease-out group-hover/thread-row:pr-19 group-focus-within/thread-row:pr-19";
  const { metaChipCount, hasTrailingGlyph } = input;
  if (metaChipCount <= 0) {
    return cn(hasTrailingGlyph ? "pr-7" : "pr-2", hoverReserve);
  }
  if (metaChipCount === 1) {
    return cn(hasTrailingGlyph ? "pr-12" : "pr-7", hoverReserve);
  }
  if (metaChipCount === 2) {
    return cn(hasTrailingGlyph ? "pr-16" : "pr-12", hoverReserve);
  }
  return cn(hasTrailingGlyph ? "pr-18" : "pr-17", hoverReserve);
}
