import type { MouseEvent } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SynaraIcon } from "./SynaraIcon";

export function LegacyProjectActions({
  title,
  shortcut,
  onAction,
}: {
  title: string;
  shortcut: string | null;
  onAction: (
    event: MouseEvent<HTMLButtonElement>,
    action: "thread" | "terminal" | "pull-requests",
  ) => void;
}) {
  return (
    <div data-legacy-project-actions>
      {(
        [
          { action: "pull-requests", icon: "git-compare", label: "Pull requests" },
          { action: "terminal", icon: "console", label: "New terminal thread" },
          { action: "thread", icon: "compose", label: "New thread" },
        ] as const
      ).map(({ action, icon, label }) => (
        <Tooltip key={action}>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-legacy-sidebar-toolbar-button
                data-testid={action === "thread" ? "new-thread-button" : undefined}
                aria-label={`${label} in ${title}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => onAction(event, action)}
              />
            }
          >
            <SynaraIcon name={icon} />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {action === "thread" && shortcut ? `${label} (${shortcut})` : label}
          </TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
