import { useRender } from "@base-ui/react/use-render";
import { MessageSquareIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import { resolveLegacySidebarProviderEntry } from "./providerIcon";
import { useEnvironment } from "../../state/environments";
import type { SidebarThreadSummary } from "../../types";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
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

export function LegacySidebarProviderIcon({ thread }: { thread: SidebarThreadSummary }) {
  const environment = useEnvironment(thread.environmentId);
  const { modelSelection, runtime } = thread;
  const entry = useMemo(
    () => resolveLegacySidebarProviderEntry(environment?.serverConfig, { modelSelection, runtime }),
    [environment?.serverConfig, modelSelection, runtime],
  );
  return (
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
  );
}
