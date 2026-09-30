import type { ReactNode } from "react";
import type { ThreadStatusPill } from "../Sidebar.logic";
import { cn } from "../../lib/utils";
import { LegacyThreadStatus } from "./LegacyThreadStatus";
import type { LegacySessionColor } from "./sessionColors";
import {
  resolveThreadStatusTrailingIndicator,
  sidebarHoverRevealHideClassName,
  threadRowStatusSlotClassName,
} from "./synaraStatusLayout";

export function LegacyThreadTrailing({
  status,
  sessionColor,
  isActive,
  slotOccupied,
  metadata,
  hoverActions,
  confirmingArchive,
}: {
  status: ThreadStatusPill | null;
  sessionColor?: LegacySessionColor | undefined;
  isActive?: boolean;
  slotOccupied?: boolean;
  metadata?: ReactNode;
  hoverActions?: ReactNode;
  confirmingArchive?: boolean;
}) {
  const trailingStatus = resolveThreadStatusTrailingIndicator({
    status,
    sessionColor,
    ...(isActive !== undefined ? { isActive } : {}),
    ...(slotOccupied !== undefined ? { slotOccupied } : {}),
  });
  // Same absolute anchor, cluster and status slot as Synara's normal/pinned rows.
  // Static metadata precedes the slot; hover actions are outside the flex flow.
  return (
    <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
      <div className="relative flex shrink-0 items-center justify-end gap-0.75">
        {metadata ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-0.75",
              hoverActions && sidebarHoverRevealHideClassName("thread-row"),
            )}
          >
            {metadata}
          </div>
        ) : null}
        {trailingStatus ? (
          <span
            data-legacy-thread-status
            className={
              hoverActions
                ? threadRowStatusSlotClassName()
                : "flex w-[15px] shrink-0 items-center justify-center leading-none tabular-nums"
            }
          >
            <LegacyThreadStatus status={trailingStatus} />
          </span>
        ) : null}
        {hoverActions ? (
          <div
            data-legacy-thread-actions
            data-confirming-archive={confirmingArchive}
            className="pointer-events-none absolute inset-y-0 right-0 my-auto inline-flex items-center opacity-0 transition-opacity group-hover/thread-row:pointer-events-auto group-hover/thread-row:opacity-100 group-focus-within/thread-row:pointer-events-auto group-focus-within/thread-row:opacity-100"
          >
            <div className="pointer-events-auto inline-flex items-center gap-2">{hoverActions}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
