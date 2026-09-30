import { SynaraRunningSpinner } from "./SynaraRunningSpinner";
import type { ThreadStatusPill } from "../Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function LegacyThreadStatus({ status }: { status: ThreadStatusPill | null }) {
  if (!status) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={status.label}
            className="inline-flex shrink-0 items-center"
          />
        }
      >
        {status.pulse ? (
          <SynaraRunningSpinner />
        ) : (
          <span
            aria-hidden
            data-legacy-completion={status.label === "Completed" ? true : undefined}
            className={`size-1.5 rounded-full ${status.label === "Completed" ? "" : status.dotClass}`}
          />
        )}
      </TooltipTrigger>
      <TooltipPopup side="top">{status.label}</TooltipPopup>
    </Tooltip>
  );
}
