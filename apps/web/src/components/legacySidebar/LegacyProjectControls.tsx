import { SynaraIcon } from "./SynaraIcon";
import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { resolveProjectExpanded, useUiStateStore } from "../../uiStateStore";
import { useLegacySidebarPreferences } from "./preferences";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function LegacyProjectPinButton({
  projectKey,
  title,
}: {
  projectKey: string;
  title: string;
}) {
  const pinned = useLegacySidebarPreferences((state) =>
    state.pinnedProjectKeys.includes(projectKey),
  );
  const toggle = useLegacySidebarPreferences((state) => state.toggleProjectPin);
  const label = `${pinned ? "Unpin" : "Pin"} project: ${title}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-legacy-project-pin-button
            data-pinned={pinned}
            aria-label={label}
            aria-pressed={pinned}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggle(projectKey);
            }}
          />
        }
      >
        <SynaraIcon name={pinned ? "pin-filled" : "pin"} />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function LegacyProjectsDisclosureButton({
  projects,
  activeProjectKey,
  preferenceKeys,
}: {
  projects: readonly SidebarProjectSnapshot[];
  activeProjectKey: string | null;
  preferenceKeys: (project: SidebarProjectSnapshot) => string[];
}) {
  const expanded = useUiStateStore((state) => state.projectExpandedById);
  const setExpanded = useUiStateStore((state) => state.setProjectExpanded);
  const allExpanded =
    projects.length > 0 &&
    projects.every((project) => resolveProjectExpanded(expanded, preferenceKeys(project)));
  const label = allExpanded
    ? activeProjectKey
      ? "Collapse all except the active project"
      : "Collapse all projects"
    : "Expand all projects";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-legacy-sidebar-toolbar-button
            aria-label={label}
            disabled={projects.length === 0}
            onClick={() => {
              const keys = projects.flatMap(preferenceKeys);
              setExpanded(keys, !allExpanded);
              if (allExpanded) {
                const active = projects.find((project) => project.projectKey === activeProjectKey);
                if (active) setExpanded(preferenceKeys(active), true);
              }
            }}
          />
        }
      >
        <SynaraIcon name={allExpanded ? "minimize" : "expand"} />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function LegacyProjectHoverDetails({
  project,
  chatCount,
  onEdit,
}: {
  project: SidebarProjectSnapshot;
  chatCount: number;
  onEdit: (member: SidebarProjectGroupMember) => void;
}) {
  const pinned = useLegacySidebarPreferences((state) =>
    state.pinnedProjectKeys.includes(project.projectKey),
  );
  const toggle = useLegacySidebarPreferences((state) => state.toggleProjectPin);
  return (
    <div
      data-thread-selection-safe
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="flex w-64 flex-col gap-2 p-3 text-xs"
    >
      <div className="font-medium">{project.displayName}</div>
      <div className="opacity-70">
        {chatCount} {chatCount === 1 ? "session" : "sessions"}
      </div>
      {project.memberProjects.map((member) => (
        <div key={member.physicalProjectKey}>
          {member.environmentLabel ? (
            <div className="opacity-60">{member.environmentLabel}</div>
          ) : null}
          <div className="wrap-break-word">{member.workspaceRoot}</div>
          <button type="button" data-legacy-hover-action onClick={() => onEdit(member)}>
            Rename{" "}
            {project.memberProjects.length > 1
              ? (member.environmentLabel ?? member.title)
              : "project"}
          </button>
        </div>
      ))}
      <button
        type="button"
        data-legacy-hover-action
        aria-pressed={pinned}
        onClick={() => toggle(project.projectKey)}
      >
        {pinned ? "Unpin project" : "Pin project"}
      </button>
    </div>
  );
}
