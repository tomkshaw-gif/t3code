import {
  memo,
  useMemo,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  parseScopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { threadRuntimeCanArchive } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  settlePromise,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { useThreadActions } from "../../hooks/useThreadActions";
import type { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useClientSettings } from "../../hooks/useSettings";
import { readLocalApi } from "../../localApi";
import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { cn, isMacPlatform } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { readThreadShell, useProject } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { useUiStateStore } from "../../uiStateStore";
import { useSidebarPendingFileDropStore } from "../../sidebarPendingFileDropStore";
import { buildThreadRouteParams } from "../../threadRoutes";
import { makeWorkspaceFileDropHandlers } from "../chat/workspaceFileDrop";
import { CommandDialogTrigger } from "../ui/command";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { SidebarContent, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import {
  resolveThreadLastVisitedAt,
  canMarkThreadUnread,
  resolveThreadStatusPill,
  useSidebarRowSubscriptionLease,
  resolveSidebarRowAccessibility,
} from "../Sidebar.logic";
import {
  ChangeRequestStatusIcon,
  prStatusIndicator,
  PrStatusTooltipContent,
  useLinkedThreadPullRequest,
} from "../ThreadStatusIndicators";
import { LegacySidebarProviderIcon } from "./LegacySidebarPresentation";
import { LegacyThreadHoverDetails } from "./LegacyThreadHoverDetails";
import { useLegacyThreadDone } from "./useLegacyThreadDone";
import { LegacyThreadMetaChips } from "./LegacyThreadMetaChips";
import { LegacyThreadPinButton, useLegacyTogglePin } from "./LegacySidebarPin";
import { useLegacySidebarPreferences } from "./preferences";
import {
  buildLegacySessionColorMenu,
  isLegacySessionColor,
  LEGACY_SESSION_COLORS,
} from "./sessionColors";
import { resolveThreadStatusTrailingIndicator } from "./synaraStatusLayout";
import { SynaraIcon } from "./SynaraIcon";
import { SidebarStatusTrailingGlyph } from "./SynaraStatusTrailingGlyph";
import { resolveLegacyThreadMetaChips } from "./threadMeta";
import {
  activityRecency,
  markActivityRead,
  type ActivityEntry,
  type ActivitySection,
} from "./activity.logic";
import type { useLegacyActivity } from "./useLegacyActivity";

// SidebarActivityView.tsx / SidebarActivityBellButton, Synara 529ad049cb106c998010f5400189515008997aa4.
// Geometry, icons, section ordering and status placement follow the source;
// actions and capabilities remain native T3. See icons/Synara-LICENSE.
function reportFailure(result: AtomCommandResult<unknown, unknown>, title: string): boolean {
  if (result._tag === "Success") return true;
  if (!isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  }
  return false;
}

function ActivityIconButton({
  icon,
  label,
  ...props
}: ComponentProps<"button"> & {
  icon: ComponentProps<typeof SynaraIcon>["name"];
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" data-legacy-activity-icon-button aria-label={label} {...props} />
        }
      >
        <SynaraIcon name={icon} className="size-[15px]" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function LegacyActivityHeaderControls({
  active,
  unread,
  searchShortcutLabel,
}: {
  active: boolean;
  unread: boolean;
  searchShortcutLabel: string | null;
}) {
  const setEnabled = useLegacySidebarPreferences((state) => state.setActivityViewEnabled);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === "t3code:legacy-sidebar-layout:v1")
        void useLegacySidebarPreferences.persist.rehydrate();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={<CommandDialogTrigger aria-label="Search" data-legacy-activity-header-button />}
        >
          <SynaraIcon name="search" className="size-[15px]" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          Search{searchShortcutLabel ? ` (${searchShortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-legacy-activity-header-button
              data-active={active}
              aria-label={active ? "Switch to classic view" : "Switch to activity view"}
              aria-pressed={active}
              onClick={() => {
                useThreadSelectionStore.getState().clearSelection();
                setEnabled(!active);
              }}
            />
          }
        >
          <SynaraIcon name="activity" className="size-[15px]" />
          {unread ? <span aria-hidden data-legacy-activity-unread /> : null}
        </TooltipTrigger>
        <TooltipPopup side="bottom">Activity view</TooltipPopup>
      </Tooltip>
    </>
  );
}

type ThreadActions = ReturnType<typeof useThreadActions>;
type ActivityState = ReturnType<typeof useLegacyActivity>;

const ActivityThreadRow = memo(function ActivityThreadRow({
  entry,
  active,
  projectLabel,
  orderedKeys,
  jumpLabel,
  navigateToThread,
  actions,
  handleNewThread,
}: {
  entry: ActivityEntry;
  active: boolean;
  projectLabel: string;
  orderedKeys: readonly string[];
  jumpLabel?: string | undefined;
  navigateToThread: (ref: ScopedThreadRef) => Promise<void>;
  actions: ThreadActions;
  handleNewThread: ReturnType<typeof useNewThreadHandler>;
}) {
  const { thread, key } = entry;
  const navigate = useNavigate();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const ref = scopeThreadRef(thread.environmentId, thread.id);
  const project = useProject(scopeProjectRef(thread.environmentId, thread.projectId));
  const environment = useEnvironment(thread.environmentId);
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[key]);
  const selected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(key));
  const color = useLegacySidebarPreferences((state) => state.sessionColors[key]);
  const confirmArchive = useClientSettings((state) => state.confirmThreadArchive);
  const togglePin = useLegacyTogglePin();
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [fileDragOver, setFileDragOver] = useState(false);
  const renameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      renameInput.current?.focus();
      renameInput.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (!fileDragOver) return;
    const clear = () => setFileDragOver(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [fileDragOver]);
  const fileDropHandlers = useMemo(
    () =>
      makeWorkspaceFileDropHandlers({
        setDragActive: setFileDragOver,
        addFolders: () => {},
        addFiles: (files) => {
          const target = scopeThreadRef(thread.environmentId, thread.id);
          const drops = useSidebarPendingFileDropStore.getState();
          const dropId = drops.queuePendingFileDrop({ threadRef: target, files });
          const pathname = router.buildLocation({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(target),
          }).pathname;
          if (pathname === router.state.location.pathname) return;
          void settlePromise(() => navigateToThread(target)).then((result) => {
            if (result._tag === "Failure" || pathname !== router.state.location.pathname)
              drops.clearPendingFileDrop(dropId);
            reportFailure(result, "Could not open thread for file drop");
          });
        },
      }),
    [navigateToThread, router, thread.environmentId, thread.id],
  );
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const toggleDone = useLegacyThreadDone(actions);
  const openNativePrLink = useOpenPrLink(ref);
  const openPrLink = (event: MouseEvent<HTMLElement>, url: string) => {
    const opened = openNativePrLink(event, url, ref);
    if (opened && !active) void navigateToThread(ref);
    return opened;
  };
  const { rowRef, leaseLiveStatus } = useSidebarRowSubscriptionLease(active);
  const linkedPr = useLinkedThreadPullRequest(
    thread.environmentId,
    thread.linkedPullRequest,
    leaseLiveStatus,
    thread.pullRequests,
    thread.branchPullRequest,
  );
  const pr = linkedPr?.pr ?? null;
  const prStatus = prStatusIndicator(pr, linkedPr?.sourceControlProvider);
  const status = resolveThreadStatusPill({
    neverVisitedIsUnread: true,
    thread: {
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt),
    },
  });
  const trailingStatus = resolveThreadStatusTrailingIndicator({
    status,
    sessionColor: color,
    isActive: active,
  });
  const canSettle = environment?.serverConfig?.environment.capabilities.threadSettlement === true;
  const canPin = environment?.serverConfig?.environment.capabilities.threadPinning === true;
  const startRename = () => {
    setTitle(thread.title);
    setEditing(true);
  };
  async function rename() {
    if (pending) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    if (trimmed === thread.title) {
      setEditing(false);
      return;
    }
    setPending(true);
    try {
      if (
        reportFailure(
          await updateMetadata({
            environmentId: thread.environmentId,
            input: { threadId: thread.id, title: trimmed },
          }),
          "Failed to rename thread",
        )
      )
        setEditing(false);
    } finally {
      setPending(false);
    }
  }
  async function archive() {
    if (confirmArchive && !(await readLocalApi()?.dialogs.confirm(`Archive “${thread.title}”?`)))
      return;
    setPending(true);
    try {
      reportFailure(await actions.archiveThread(ref), "Failed to archive thread");
    } finally {
      setPending(false);
    }
  }
  async function setDone() {
    if (pending) return;
    setPending(true);
    try {
      await toggleDone(ref);
    } finally {
      setPending(false);
    }
  }
  async function contextMenu(position: { x: number; y: number }) {
    const api = readLocalApi();
    if (!api) return;
    const selection = useThreadSelectionStore.getState();
    // A right-click on a different row addresses that row, never stale selection.
    if (!selection.selectedThreadKeys.has(key)) selection.clearSelection();
    const selectedKeys = useThreadSelectionStore.getState().selectedThreadKeys;
    const targets =
      selectedKeys.size > 1
        ? orderedKeys.filter((candidate) => selectedKeys.has(candidate))
        : [key];
    const many = targets.length > 1;
    const hasWorkingTarget = targets.some((target) => {
      const targetRef = parseScopedThreadKey(target);
      return targetRef !== null && !threadRuntimeCanArchive(readThreadShell(targetRef)?.runtime);
    });
    const choice = await api.contextMenu.show(
      [
        ...(!many && thread.branch
          ? [{ id: "branch", label: `New thread on ${thread.branch}` }]
          : []),
        ...(!many && canPin
          ? [{ id: "pin", label: entry.pinned ? "Unpin thread" : "Pin thread" }]
          : []),
        ...(!many && canSettle
          ? [{ id: "done", label: entry.settled ? "Undo Done" : "Done" }]
          : []),
        buildLegacySessionColorMenu(targets, useLegacySidebarPreferences.getState().sessionColors),
        ...(!many ? [{ id: "rename", label: "Rename thread" }] : []),
        {
          id: "unread",
          label: many ? "Mark selected unread" : "Mark unread",
          disabled: !targets.every((target) => {
            const targetRef = parseScopedThreadKey(target);
            return canMarkThreadUnread(targetRef ? readThreadShell(targetRef) : null);
          }),
        },
        ...(!many
          ? [
              { id: "copy-path", label: "Copy Path" },
              { id: "copy-id", label: "Copy Thread ID" },
              { id: "project-settings", label: "Project settings" },
            ]
          : []),
        {
          id: "archive",
          label: many ? `Archive ${targets.length} threads` : "Archive",
          disabled: hasWorkingTarget,
        },
        {
          id: "delete",
          label: many ? `Delete ${targets.length} threads` : "Delete",
          destructive: true,
          icon: "trash",
        },
      ],
      position,
    );
    if (choice?.startsWith("session-color:")) {
      const value = choice.slice("session-color:".length);
      if (value === "none" || isLegacySessionColor(value))
        useLegacySidebarPreferences
          .getState()
          .setSessionColor(targets, value === "none" ? null : value);
    } else if (choice === "pin") await togglePin(thread);
    else if (choice === "done") await setDone();
    else if (choice === "rename") startRename();
    else if (choice === "copy-path" || choice === "copy-id") {
      const value =
        choice === "copy-id" ? thread.id : (thread.worktreePath ?? project?.workspaceRoot);
      if (value)
        reportFailure(
          await settlePromise(() => navigator.clipboard.writeText(value)),
          "Could not copy to clipboard",
        );
    } else if (choice === "project-settings") {
      if (isMobile) setOpenMobile(false);
      void navigate({ to: "/projects/$projectKey", params: { projectKey: entry.projectKey } });
    } else if (choice === "branch")
      reportFailure(
        await settlePromise(() =>
          handleNewThread(scopeProjectRef(thread.environmentId, thread.projectId), {
            branch: thread.branch,
            worktreePath: thread.worktreePath,
            envMode: thread.worktreePath ? "worktree" : "local",
            startFromOrigin: false,
          }),
        ),
        "Could not create thread",
      );
    else if (choice === "unread" || choice === "archive" || choice === "delete") {
      if (
        choice === "archive" &&
        confirmArchive &&
        !(await api.dialogs.confirm(`Archive ${targets.length} thread${many ? "s" : ""}?`))
      )
        return;
      if (
        choice === "delete" &&
        !(await api.dialogs.confirm(`Delete ${targets.length} thread${many ? "s" : ""}?`))
      )
        return;
      for (const target of targets) {
        const targetRef = parseScopedThreadKey(target);
        const shell = targetRef ? readThreadShell(targetRef) : null;
        if (!targetRef || !shell) continue;
        if (choice === "unread") actions.markThreadUnread(targetRef);
        else if (
          !reportFailure(
            await (choice === "archive"
              ? actions.archiveThread(targetRef)
              : actions.deleteThread(targetRef, { deletedThreadKeys: new Set(targets) })),
            `Failed to ${choice} thread`,
          )
        )
          break;
      }
      selection.clearSelection();
    }
  }
  const stopAction = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <PreviewCard>
      <PreviewCardTrigger
        render={
          <div
            ref={rowRef}
            className="group/activity-row relative"
            data-thread-item
            data-thread-selection-safe
            onDoubleClick={(event) => {
              event.preventDefault();
              startRename();
            }}
            onPointerUp={(event) => {
              if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
              const prior = lastTap.current;
              if (
                prior &&
                event.timeStamp - prior.at < 300 &&
                Math.hypot(event.clientX - prior.x, event.clientY - prior.y) < 20
              ) {
                lastTap.current = null;
                startRename();
              } else lastTap.current = { at: event.timeStamp, x: event.clientX, y: event.clientY };
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              void contextMenu({ x: event.clientX, y: event.clientY });
            }}
          />
        }
      >
        {editing ? (
          <form
            data-legacy-activity-row
            className="p-2"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
          >
            <input
              aria-label="Thread title"
              value={title}
              disabled={pending}
              ref={renameInput}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(false);
                }
              }}
              className="w-full rounded border border-input bg-background px-1 text-sm outline-ring"
            />
            <div className="mt-1 flex gap-2 text-xs">
              <button type="submit" disabled={pending || !title.trim()}>
                Save
              </button>
              <button type="button" disabled={pending} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div
            role="button"
            tabIndex={0}
            data-legacy-activity-row
            data-active={active}
            data-selected={selected}
            data-session-color={color}
            aria-description={color ? LEGACY_SESSION_COLORS[color].label : undefined}
            aria-current={active ? "page" : undefined}
            aria-label={
              resolveSidebarRowAccessibility({
                title: thread.title,
                statusLabel: status?.label ?? null,
                projectDisplayName: projectLabel,
                isActive: active,
              }).label
            }
            className={cn(
              "flex w-full min-w-0 cursor-pointer flex-col gap-1 rounded-lg px-2.5 py-2 text-left select-none",
              entry.settled && "opacity-55 transition-opacity hover:opacity-85",
              fileDragOver && "ring-1 ring-inset ring-primary/70",
            )}
            {...fileDropHandlers}
            onClick={(event) => {
              if (event.detail > 1) return;
              const selection = useThreadSelectionStore.getState();
              if ((event.target as HTMLElement).closest("a,button,input")) return;
              if (isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey) {
                event.preventDefault();
                selection.toggleThread(key);
              } else if (event.shiftKey) {
                event.preventDefault();
                selection.rangeSelectTo(key, orderedKeys);
              } else navigateToThread(ref);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                navigateToThread(ref);
              } else if (event.key === "F2") {
                event.preventDefault();
                startRename();
              } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                void contextMenu({ x: bounds.left, y: bounds.bottom });
              }
            }}
          >
            <span className="flex min-w-0 items-center gap-1.5 overflow-hidden pr-5 transition-[padding] duration-150 ease-out group-hover/activity-row:pr-17 group-focus-within/activity-row:pr-17">
              <LegacySidebarProviderIcon thread={thread} />
              <span className="min-w-0 shrink truncate  leading-5 font-normal">{thread.title}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground/80">
              <SynaraIcon name="folder" className="size-3 text-muted-foreground/70" />
              <span className="min-w-0 truncate">{projectLabel}</span>
              <LegacyThreadMetaChips chips={resolveLegacyThreadMetaChips(thread)} />
              <span className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
                {pr && prStatus ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <a
                          href={pr.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={prStatus.label}
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-1 text-3xs",
                            prStatus.colorClass,
                          )}
                          onClick={(event) => openPrLink(event, pr.url)}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onPointerUp={(event) => event.stopPropagation()}
                          onContextMenu={(event) => event.stopPropagation()}
                        />
                      }
                    >
                      <ChangeRequestStatusIcon
                        state={pr.state}
                        isDraft={pr.isDraft}
                        className="size-2.5"
                      />
                      #{pr.number}
                    </TooltipTrigger>
                    <TooltipPopup side="top">
                      <PrStatusTooltipContent status={prStatus} />
                    </TooltipPopup>
                  </Tooltip>
                ) : null}
                {thread.branch ? (
                  <span className="flex min-w-0 items-center gap-1 text-muted-foreground/70">
                    <SynaraIcon name="branch" className="size-3" />
                    <span className="max-w-36 truncate">{thread.branch}</span>
                  </span>
                ) : null}
              </span>
            </span>
          </div>
        )}
        {!editing && (trailingStatus || jumpLabel) ? (
          <span
            data-legacy-activity-status
            className="pointer-events-none absolute top-1 right-1 inline-flex size-5 items-center justify-center transition-opacity group-hover/activity-row:opacity-0 group-focus-within/activity-row:opacity-0"
          >
            {jumpLabel ? (
              <span className="text-3xs text-muted-foreground">{jumpLabel}</span>
            ) : trailingStatus ? (
              <SidebarStatusTrailingGlyph status={trailingStatus} />
            ) : null}
          </span>
        ) : null}
        {!editing ? (
          <span
            data-legacy-activity-actions
            className="absolute top-1 right-1 inline-flex items-center gap-1 opacity-0 transition-opacity group-hover/activity-row:opacity-100 group-focus-within/activity-row:opacity-100"
            onDoubleClick={stopAction}
            onPointerUp={(event) => event.stopPropagation()}
          >
            <LegacyThreadPinButton thread={thread} />
            <ActivityIconButton
              icon="archive"
              label="Archive"
              disabled={pending || !threadRuntimeCanArchive(thread.runtime)}
              onMouseDown={stopAction}
              onClick={(event) => {
                stopAction(event);
                void archive();
              }}
            />
            {canSettle ? (
              <ActivityIconButton
                icon={entry.settled ? "undo" : "done"}
                label={entry.settled ? "Undo" : "Done"}
                disabled={pending}
                onMouseDown={stopAction}
                onClick={(event) => {
                  stopAction(event);
                  void setDone();
                }}
              />
            ) : null}
          </span>
        ) : null}
      </PreviewCardTrigger>
      <PreviewCardPopup side="right">
        <LegacyThreadHoverDetails thread={thread} status={status} pr={pr} openPrLink={openPrLink} />
      </PreviewCardPopup>
    </PreviewCard>
  );
});

export function LegacyActivityView({
  activity,
  projectByKey,
  activeKey,
  jumpLabels,
  navigateToThread,
  actions,
  handleNewThread,
  openAddProject,
  notices,
}: {
  activity: ActivityState;
  projectByKey: ReadonlyMap<string, SidebarProjectSnapshot>;
  activeKey: string | null;
  jumpLabels: ReadonlyMap<string, string>;
  navigateToThread: (ref: ScopedThreadRef) => Promise<void>;
  actions: ThreadActions;
  handleNewThread: ReturnType<typeof useNewThreadHandler>;
  openAddProject: () => void;
  notices: ReactNode;
}) {
  const { feed, layout, setLayout } = activity;
  function createThread() {
    const target =
      activity.entries.find((entry) => entry.key === activeKey) ??
      activity.entries.toSorted((a, b) => activityRecency(b) - activityRecency(a))[0];
    const project = target
      ? scopeProjectRef(target.thread.environmentId, target.thread.projectId)
      : projectByKey.values().next().value?.memberProjectRefs[0];
    if (!project) {
      openAddProject();
      return;
    }
    void settlePromise(() => handleNewThread(project)).then((result) =>
      reportFailure(result, "Could not create thread"),
    );
  }
  const visit = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const [markingRead, setMarkingRead] = useState(false);
  const projectName = (key: string) => projectByKey.get(key)?.displayName ?? "Project";
  const toggleSection = (key: string) =>
    setLayout((current) => ({
      ...current,
      ...(key === "pinned"
        ? { pinnedOpen: !current.pinnedOpen }
        : key === "earlier"
          ? { earlierOpen: !current.earlierOpen }
          : { doneOpen: !current.doneOpen }),
    }));
  const page = (key: string, direction: number) =>
    setLayout((current) => ({
      ...current,
      extraPages: {
        ...current.extraPages,
        [key]: Math.max(
          0,
          (feed.sections.find((section) => section.key === key)?.extraPages ?? 0) + direction,
        ),
      },
    }));
  async function markAllRead() {
    if (markingRead) return;
    setMarkingRead(true);
    try {
      const failures = await markActivityRead(feed.unread, {
        visitedAt: new Date().toISOString(),
        visit: async (entry, visitedAt) =>
          (
            await visit({
              environmentId: entry.thread.environmentId,
              input: { threadId: entry.thread.id, visitedAt },
            })
          )._tag === "Success",
        markLocal: useUiStateStore.getState().markThreadVisited,
      });
      if (failures > 0)
        toastManager.add({
          type: "error",
          title: "Some threads could not be marked read",
          description: `${failures} thread${failures === 1 ? "" : "s"} could not be updated. Try again after reconnecting.`,
        });
    } finally {
      setMarkingRead(false);
    }
  }
  function renderSection(section: ActivitySection<ActivityEntry>) {
    const label = section.projectKey ? projectName(section.projectKey) : section.label;
    return (
      <section key={section.key}>
        {section.collapsible ? (
          <button
            type="button"
            aria-expanded={section.open}
            className="flex h-7 w-full items-center gap-1 rounded-md px-2 py-0.5 text-left text-muted-foreground/75 outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => toggleSection(section.key)}
          >
            <span>{label}</span>
            <SynaraIcon
              name="chevron-right"
              className={cn("size-3", section.open && "rotate-90")}
            />
          </button>
        ) : (
          <div className="mb-1.5 px-2  text-muted-foreground/75">{label}</div>
        )}
        {section.rows.length > 0 ? (
          <div className={cn("flex flex-col gap-0.5", section.collapsible && "pt-0.5")}>
            {section.rows.map((entry) => (
              <ActivityThreadRow
                key={entry.key}
                entry={entry}
                active={activeKey === entry.key}
                projectLabel={projectName(entry.projectKey)}
                orderedKeys={feed.visibleKeys}
                jumpLabel={jumpLabels.get(entry.key)}
                navigateToThread={navigateToThread}
                actions={actions}
                handleNewThread={handleNewThread}
              />
            ))}
            {section.canShowMore || section.canShowLess ? (
              <div className="flex gap-1  text-muted-foreground/80">
                {section.canShowMore ? (
                  <button
                    type="button"
                    className="h-7 flex-1 px-2.5 text-left hover:text-foreground"
                    onClick={() => page(section.key, 1)}
                  >
                    Show more
                  </button>
                ) : null}
                {section.canShowLess ? (
                  <button
                    type="button"
                    className="h-7 px-2.5 text-left hover:text-foreground"
                    onClick={() => page(section.key, -1)}
                  >
                    Show less
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }
  return (
    <SidebarContent>
      {notices}
      <div data-legacy-activity-feed className="flex flex-col gap-3 px-2 py-2">
        {feed.sections.filter((section) => section.key === "pinned").map(renderSection)}
        <div className="group/project-header relative flex h-7 items-center gap-1 px-2 py-0.5">
          <Menu>
            <MenuTrigger
              render={<button type="button" data-legacy-activity-scope />}
              aria-label="Activity scope"
            >
              <span className="truncate">
                {feed.scope ? projectName(feed.scope) : "All activity"}
              </span>
              <SynaraIcon name="chevron-down" className="size-3" />
            </MenuTrigger>
            <MenuPopup align="start">
              <MenuGroup>
                <div className="px-2 py-1 text-xs text-muted-foreground">Activity scope</div>
                <MenuRadioGroup
                  value={feed.scope ?? "all"}
                  onValueChange={(value) =>
                    setLayout((current) => ({ ...current, scope: value === "all" ? null : value }))
                  }
                >
                  <MenuRadioItem value="all">All activity</MenuRadioItem>
                  {feed.scopeOptions.map((option) => (
                    <MenuRadioItem key={option.projectKey} value={option.projectKey}>
                      <span className="min-w-0 flex-1 truncate">
                        {projectName(option.projectKey)}
                      </span>
                      <span className="ml-2 text-muted-foreground">{option.count}</span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuGroup>
            </MenuPopup>
          </Menu>
          <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover/project-header:opacity-100 group-focus-within/project-header:opacity-100">
            <ActivityIconButton icon="compose" label="New chat" onClick={createThread} />
            <ActivityIconButton icon="plus" label="Add project" onClick={openAddProject} />
          </span>
          <Menu>
            <MenuTrigger data-legacy-activity-icon-button aria-label="Activity options">
              <SynaraIcon name="sort" className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuGroup>
                <div className="px-2 py-1 text-xs text-muted-foreground">Group by</div>
                <MenuRadioGroup
                  value={layout.groupMode}
                  onValueChange={(value) => {
                    if (value === "time" || value === "project")
                      setLayout((current) => ({ ...current, groupMode: value }));
                  }}
                >
                  <MenuRadioItem value="time">Time</MenuRadioItem>
                  <MenuRadioItem value="project">Project</MenuRadioItem>
                </MenuRadioGroup>
              </MenuGroup>
              <MenuSeparator />
              <MenuItem
                disabled={markingRead || feed.unread.length === 0}
                onClick={() => {
                  void markAllRead();
                }}
              >
                Mark all as read
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
        {feed.sections.filter((section) => section.key !== "pinned").map(renderSection)}
        {feed.sections.length === 0 ? (
          <div className="px-2 pt-4 text-center  text-muted-foreground/60">No activity yet</div>
        ) : null}
      </div>
    </SidebarContent>
  );
}
