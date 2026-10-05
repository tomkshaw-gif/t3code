import { PencilIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { LegacyThreadStatusIndicator } from "./synaraStatusLayout";
import { SynaraRunningSpinner as ThreadRunningSpinner } from "./SynaraRunningSpinner";

/** Quiet marker for a chat whose composer holds a message the user has not sent yet. */
export function LegacyDraftGlyph() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label="Unsent draft"
            data-legacy-draft-glyph
            className="inline-flex shrink-0 text-warning-foreground"
          />
        }
      >
        <PencilIcon className="size-3" aria-hidden />
      </TooltipTrigger>
      <TooltipPopup side="top">Unsent draft</TooltipPopup>
    </Tooltip>
  );
}

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
