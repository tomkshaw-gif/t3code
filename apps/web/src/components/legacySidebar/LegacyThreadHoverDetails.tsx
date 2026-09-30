import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useProject } from "../../state/entities";
import type { SidebarThreadSummary } from "../../types";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { LegacySidebarProviderIcon } from "./LegacySidebarPresentation";
import type { ThreadStatusPill } from "../Sidebar.logic";

import type { MouseEvent } from "react";
import { useLegacySidebarPreferences } from "./preferences";
import { LEGACY_SESSION_COLORS } from "./sessionColors";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";

export function LegacyThreadHoverDetails({
  thread,
  status,
  pr,
  openPrLink,
}: {
  thread: SidebarThreadSummary;
  status: ThreadStatusPill | null;
  pr: { url: string; number: number; title?: string | undefined } | null;
  openPrLink: (event: MouseEvent<HTMLElement>, url: string) => boolean;
}) {
  const project = useProject(scopeProjectRef(thread.environmentId, thread.projectId));
  const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
  const color = useLegacySidebarPreferences((state) => state.sessionColors[key]);
  const effort = thread.modelSelection.options?.find(
    (option) => option.id === "reasoningEffort" || option.id === "effort",
  );
  const fast =
    thread.modelSelection.options?.find((option) => option.id === "fastMode")?.value === true;
  return (
    <div
      data-thread-selection-safe
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      className="flex w-64 flex-col gap-2 p-3 text-left text-xs"
    >
      <div className="font-medium whitespace-normal">{thread.title}</div>
      {color ? <div>{LEGACY_SESSION_COLORS[color].label}</div> : null}
      {status ? <div className={status.colorClass}>{status.label}</div> : null}
      {project ? (
        <>
          <div className="truncate opacity-75">{project.title}</div>
          <div className="wrap-break-word opacity-60">{project.workspaceRoot}</div>
        </>
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <LegacySidebarProviderIcon thread={thread} />
        <span className="truncate">{thread.modelSelection.model}</span>
      </div>
      {effort ? <div className="opacity-75">Reasoning: {String(effort.value)}</div> : null}
      {fast ? <div className="opacity-75">Fast mode</div> : null}
      {thread.branch ? <div className="truncate opacity-75">Branch: {thread.branch}</div> : null}
      {thread.worktreePath ? (
        <div className="wrap-break-word opacity-75">Worktree: {thread.worktreePath}</div>
      ) : null}
      {pr ? (
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          data-legacy-hover-action
          onClick={(event) => {
            event.stopPropagation();
            openPrLink(event, pr.url);
          }}
        >
          PR #{pr.number}
          {pr.title ? `: ${pr.title}` : ""}
        </a>
      ) : null}
      <div className="opacity-60">
        Last activity{" "}
        {formatRelativeTimeLabel(
          thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
        )}
      </div>
    </div>
  );
}
