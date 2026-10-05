import { useRender } from "@base-ui/react/use-render";
import { MessageSquareIcon, TerminalIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import { cn } from "../../lib/utils";
import { resolveLegacySidebarProviderEntry } from "./providerIcon";
import { resolveLegacyTerminalBadge, type LegacyTerminalStatus } from "./terminalBadge";
import { useEnvironment } from "../../state/environments";
import type { SidebarThreadSummary } from "../../types";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { synchronizeTerminalPulse } from "../ThreadStatusIndicators";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SynaraFolderIcon } from "./SynaraFolderIcon";
import "./legacySidebar.css";

// Feature-owned controls let the legacy sidebar follow Synara's row layout
// without changing the primitives used by T3's current sidebar.
export function LegacySidebarButton({
  className,
  render,
  size: _size,
  ...props
}: useRender.ComponentProps<"button"> & { size?: "sm" | "md" }) {
  return useRender({
    defaultTagName: "button",
    render,
    props: {
      ...props,
      type: "button",
      "data-slot": "sidebar-menu-button",
      className: className,
      "data-legacy-sidebar-header-row": true,
    },
  });
}

export function LegacySidebarSub({ className, ...props }: ComponentProps<"ul">) {
  return <ul {...props} data-legacy-sidebar-thread-list className={className} />;
}

export function LegacySidebarMoreButton({
  className,
  ...props
}: useRender.ComponentProps<"button"> & { size?: "sm" | "md" }) {
  return <LegacySidebarButton {...props} data-legacy-sidebar-more className={className} />;
}

export function LegacySidebarFolder({ expanded = false }: { expanded?: boolean }) {
  return <SynaraFolderIcon expanded={expanded} />;
}

export function LegacySidebarProjectIcon({ expanded }: { expanded: boolean }) {
  // A consistent Synara folder, including projects with saved T3 defaults.
  return <LegacySidebarFolder expanded={expanded} />;
}

export function LegacySidebarProviderIcon({
  thread,
  terminalStatus = null,
  terminalCount = 0,
}: {
  thread: SidebarThreadSummary;
  terminalStatus?: LegacyTerminalStatus | null;
  terminalCount?: number;
}) {
  const environment = useEnvironment(thread.environmentId);
  const { modelSelection, runtime } = thread;
  const entry = useMemo(
    () => resolveLegacySidebarProviderEntry(environment?.serverConfig, { modelSelection, runtime }),
    [environment?.serverConfig, modelSelection, runtime],
  );
  const terminalBadge = resolveLegacyTerminalBadge({
    runningCount: terminalCount,
    status: terminalStatus,
  });
  return (
    <span className="relative inline-flex shrink-0">
      <span data-legacy-sidebar-provider aria-hidden>
        {entry ? (
          <ProviderInstanceIcon
            driverKind={entry.driverKind}
            displayName={entry.displayName}
            accentColor={entry.accentColor}
            acpRegistryAgentId={entry.acpRegistryAgentId}
            acpRegistryIconUrl={entry.acpRegistryIconUrl}
            iconClassName="size-3 text-inherit"
          />
        ) : (
          <MessageSquareIcon className="size-3" strokeWidth={1.5} />
        )}
      </span>
      {terminalBadge ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="img"
                aria-label={terminalBadge.tooltip}
                data-legacy-terminal-chip
                className={terminalBadge.count === null ? terminalBadge.colorClass : undefined}
              />
            }
          >
            {terminalBadge.count !== null ? (
              <span
                className={cn(
                  "text-4xs font-semibold leading-none tabular-nums",
                  terminalBadge.colorClass,
                )}
              >
                {terminalBadge.count}
              </span>
            ) : (
              <TerminalIcon
                className={cn(
                  "size-2.5",
                  terminalBadge.pulse && "motion-safe:animate-status-pulse",
                )}
                onAnimationStart={synchronizeTerminalPulse}
              />
            )}
          </TooltipTrigger>
          <TooltipPopup side="top">{terminalBadge.tooltip}</TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );
}
