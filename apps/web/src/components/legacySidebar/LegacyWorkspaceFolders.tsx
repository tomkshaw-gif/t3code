import { ChevronRightIcon, GripVerticalIcon } from "lucide-react";
import type { ReactNode } from "react";
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
  renderThread,
}: {
  projectKey: string;
  groups: readonly LegacyWorkspaceGroup<SidebarThreadSummary>[];
  allWorkspaceKeys: readonly string[];
  renderedThreadKeys: ReadonlySet<string>;
  expandedByKey: Readonly<Record<string, boolean>>;
  setExpanded: (key: string, expanded: boolean) => void;
  activeThreadKey: string | null;
  renderThread: (thread: SidebarThreadSummary) => ReactNode;
}) {
  const setOrder = useLegacySidebarPreferences((state) => state.setWorkspaceOrder);
  const newThread = useNewThreadHandler();
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
    const clicked = await api.contextMenu.show(
      [
        { id: "new", label: `New thread in ${group.label}` },
        ...(index > 0 ? [{ id: "up", label: "Move up" }] : []),
        ...(index < keys.length - 1 ? [{ id: "down", label: "Move down" }] : []),
      ],
      position,
    );
    if (clicked === "up" || clicked === "down") {
      const target = keys[index + (clicked === "up" ? -1 : 1)];
      if (target) saveOrder(moveLegacySidebarItem(keys, group.key, target));
    } else if (clicked === "new") {
      const thread = group.threads[0];
      if (!thread) return;
      const result = await settlePromise(() =>
        newThread(scopeProjectRef(thread.environmentId, thread.projectId), {
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          envMode: thread.worktreePath ? "worktree" : "local",
          startFromOrigin: false,
        }),
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
        const threads = group.threads.filter((thread) => {
          const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
          return renderedThreadKeys.has(key) && (expanded || key === activeThreadKey);
        });
        return (
          <LegacySortableItem key={group.key} id={group.key}>
            {(handle) => (
              <>
                <div className="group/workspace relative" data-thread-selection-safe>
                  <LegacySidebarButton
                    data-legacy-sidebar-workspace
                    aria-expanded={expanded}
                    aria-description={group.path ?? undefined}
                    onClick={() => setExpanded(group.key, !expanded)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      void contextMenu(group, { x: event.clientX, y: event.clientY });
                    }}
                  >
                    <LegacySidebarFolder expanded={expanded} />
                    <span className="min-w-0 flex-1 truncate">{group.label}</span>
                    <ChevronRightIcon
                      aria-hidden
                      className={cn("size-3 shrink-0", expanded && "rotate-90")}
                    />
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
