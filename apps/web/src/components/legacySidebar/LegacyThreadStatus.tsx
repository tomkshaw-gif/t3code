import { SidebarStatusTrailingGlyph } from "./SynaraStatusTrailingGlyph";
import type { ThreadStatusPill } from "../Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function LegacyThreadStatus({ status }: { status: ThreadStatusPill | null }) {
  if (!status) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0 items-center" />}>
        <SidebarStatusTrailingGlyph status={status} />
      </TooltipTrigger>
      <TooltipPopup side="top">{status.label}</TooltipPopup>
    </Tooltip>
  );
}
