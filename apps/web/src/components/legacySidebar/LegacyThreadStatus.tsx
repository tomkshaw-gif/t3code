import { LoaderCircleIcon } from "lucide-react";
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
        {status.label === "Working" || status.label === "Connecting" ? (
          <LoaderCircleIcon aria-hidden className={`size-3 ${status.colorClass}`} />
        ) : (
          <span aria-hidden className={`size-1.5 rounded-full ${status.dotClass}`} />
        )}
      </TooltipTrigger>
      <TooltipPopup side="top">{status.label}</TooltipPopup>
    </Tooltip>
  );
}
