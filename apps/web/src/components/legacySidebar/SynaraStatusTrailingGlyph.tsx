import { cn } from "../../lib/utils";
import type { LegacyThreadStatusIndicator } from "./synaraStatusLayout";
import { SynaraRunningSpinner as ThreadRunningSpinner } from "./SynaraRunningSpinner";

// Synara's SidebarStatusTrailingGlyph.tsx; local imports and equivalent Tailwind variable syntax.
export function SidebarUnreadCompletionGlyph({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Unread completion"
      className={cn("size-[7px] shrink-0 rounded-full bg-(--color-text-accent)", className)}
    />
  );
}

export function SidebarStatusTrailingGlyph({ status }: { status: LegacyThreadStatusIndicator }) {
  if (status.label === "Completed") {
    return <SidebarUnreadCompletionGlyph />;
  }
  if (status.label === "Needs attention") {
    return (
      <span
        role="img"
        aria-label={status.label}
        className={cn("size-[7px] shrink-0 rounded-full", status.dotClass)}
      />
    );
  }
  if (status.pulse) {
    return (
      <span role="img" aria-label={status.label} className="inline-flex shrink-0">
        <ThreadRunningSpinner />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={status.label}
      className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)}
    />
  );
}
