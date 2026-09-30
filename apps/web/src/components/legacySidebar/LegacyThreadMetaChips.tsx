import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SynaraIcon } from "./SynaraIcon";
import type { LegacyThreadMetaChip } from "./threadMeta";

// Synara SidebarMetaChip.tsx: 15px slots, overlapping by a step of 8px.
// The worktree chip is in front of the fork chip. See icons/Synara-LICENSE.
export function LegacyThreadMetaChips({ chips }: { chips: readonly LegacyThreadMetaChip[] }) {
  if (chips.length === 0) return null;
  const tooltip = chips.map((chip) => chip.tooltip).join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={tooltip}
            className="relative inline-flex h-[15px] shrink-0 items-center justify-center"
            style={{ width: 15 + 8 * (chips.length - 1) }}
          >
            {chips.map((chip, index) => (
              <span
                key={chip.id}
                data-legacy-icon-chip={chips.length > 1 ? "stacked" : undefined}
                className="absolute top-1/2 inline-flex size-[15px] -translate-y-1/2 items-center justify-center rounded-full"
                style={{ left: index * 8, zIndex: index + 1 }}
              >
                <SynaraIcon name={chip.id} className={`size-[15px] ${chip.colorClass}`} />
              </span>
            ))}
          </span>
        }
      />
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
