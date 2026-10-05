import { ChevronRightIcon, GripVerticalIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  scopeProjectRef,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { cn } from "~/lib/utils";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { readLocalApi } from "../../localApi";
import type { SidebarThreadSummary } from "../../types";
import { toastManager } from "../ui/toast";
import { useUiStateStore } from "../../uiStateStore";
import {
  resolveProjectStatusIndicator,
  resolveThreadLastVisitedAt,
  resolveThreadStatusPill,
} from "../Sidebar.logic";
import { LegacyThreadTrailing } from "./LegacyThreadTrailing";
import {
  LegacySidebarButton,
  LegacySidebarFolder,
  LegacySidebarSub,
} from "./LegacySidebarPresentation";
import { LegacySortableItem, LegacySortableList } from "./LegacySidebarSortable";
import {
  useLegacySidebarPreferences,
  moveLegacySidebarItem,
  mergeVisibleWorkspaceOrder,
} from "./preferences";
import type { LegacyWorkspaceGroup } from "./workspaceGroups";

export function LegacyWorkspaceFolders({
  projectKey,
  groups,
  allWorkspaceKeys,
  renderedThreadKeys,
  expandedByKey,
  setExpanded,
  activeThreadKey,
  forcedVisibleKeys,
  renderThread,
}: {
  projectKey: string;
  groups: readonly LegacyWorkspaceGroup<SidebarThreadSummary>[];
  allWorkspaceKeys: readonly string[];
  renderedThreadKeys: ReadonlySet<string>;
  expandedByKey: Readonly<Record<string, boolean>>;
  setExpanded: (key: string, expanded: boolean) => void;
  activeThreadKey: string | null;
  forcedVisibleKeys?: ReadonlySet<string>;
  renderThread: (thread: SidebarThreadSummary) => ReactNode;
}) {
  const setOrder = useLegacySidebarPreferences((state) => state.setWorkspaceOrder);
  const newThread = useNewThreadHandler();
  const lastVisitedByKey = useUiStateStore(
    useShallow((state) =>
      Object.fromEntries(
        groups.flatMap((group) =>
          group.threads.map((thread) => {
            const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
            return [key, state.threadLastVisitedAtById[key]];
          }),
        ),
      ),
    ),
  );
  const keys = groups.map((group) => group.key);
  const saveOrder = (order: readonly string[]) =>
    setOrder(projectKey, mergeVisibleWorkspaceOrder(allWorkspaceKeys, order));
  async function contextMenu(
    group: LegacyWorkspaceGroup<SidebarThreadSummary>,
    position: { x: number; y: number },
  ) {
    const api = readLocalApi();
    if (!api) return;
    const index = keys.indexOf(group.key);
    const menuResult = await settlePromise(() =>
      api.contextMenu.show(
        [
          { id: "new", label: `New thread in ${group.label}` },
          ...(index > 0 ? [{ id: "up", label: "Move up" }] : []),
          ...(index < keys.length - 1 ? [{ id: "down", label: "Move down" }] : []),
        ],
        position,
      ),
    );
    if (menuResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(menuResult)) {
        const error = squashAtomCommandFailure(menuResult);
        toastManager.add({
          type: "error",
          title: "Workspace action failed",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      return;
    }
    const clicked = menuResult.value;
    if (clicked === "up" || clicked === "down") {
      const target = keys[index + (clicked === "up" ? -1 : 1)];
      if (target) saveOrder(moveLegacySidebarItem(keys, group.key, target));
    } else if (clicked === "new") {
      const thread = group.threads[0];
      const result = await settlePromise(() =>
        newThread(
          scopeProjectRef(EnvironmentId.make(group.environmentId), ProjectId.make(group.projectId)),
          {
            branch: thread?.branch ?? null,
            worktreePath: group.path,
            envMode: group.path ? "worktree" : "local",
            startFromOrigin: false,
          },
        ),
      );
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not create thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    }
  }
  return (
    <LegacySortableList items={keys} onReorder={saveOrder}>
      {groups.map((group) => {
        const expanded = expandedByKey[group.key] !== false;
        const staysVisibleWhenCollapsed = (key: string) =>
          key === activeThreadKey || (forcedVisibleKeys?.has(key) ?? false);
        const threads = group.threads.filter((thread) => {
          const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
          return renderedThreadKeys.has(key) && (expanded || staysVisibleWhenCollapsed(key));
        });
        const collapsedStatus = !expanded
          ? resolveProjectStatusIndicator(
              group.threads
                .filter(
                  (thread) =>
                    !staysVisibleWhenCollapsed(
                      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
                    ),
                )
                .map((thread) =>
                  resolveThreadStatusPill({
                    thread: {
                      ...thread,
                      lastVisitedAt: resolveThreadLastVisitedAt(
                        thread.lastVisitedAt,
                        lastVisitedByKey[
                          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
                        ],
                      ),
                    },
                  }),
                ),
            )
          : null;
        return (
          <LegacySortableItem key={group.key} id={group.key}>
            {(handle) => (
              <>
                <div className="group/workspace relative" data-thread-selection-safe>
                  <LegacySidebarButton
                    data-legacy-sidebar-workspace
                    aria-expanded={expanded}
                    aria-description={group.displayPath ?? undefined}
                    title={group.displayPath ?? undefined}
                    onClick={() => setExpanded(group.key, !expanded)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      void contextMenu(group, { x: event.clientX, y: event.clientY });
                    }}
                  >
                    <LegacySidebarFolder expanded={expanded} />
                    <span className="min-w-0 flex-1 truncate">{group.label}</span>
                    {collapsedStatus ? (
                      <LegacyThreadTrailing status={collapsedStatus} />
                    ) : (
                      <ChevronRightIcon
                        aria-hidden
                        className={cn("size-3 shrink-0", expanded && "rotate-90")}
                      />
                    )}
                  </LegacySidebarButton>
                  <button
                    {...handle}
                    data-legacy-workspace-drag-handle
                    data-thread-selection-safe
                    aria-label={`Reorder ${group.label}`}
                    aria-description="Drag to reorder; press Space then arrow keys to move"
                  >
                    <GripVerticalIcon aria-hidden className="size-3" />
                  </button>
                </div>
                {threads.length > 0 ? (
                  <LegacySidebarSub data-legacy-sidebar-workspace-threads>
                    {threads.map(renderThread)}
                  </LegacySidebarSub>
                ) : null}
              </>
            )}
          </LegacySortableItem>
        );
      })}
    </LegacySortableList>
  );
}
