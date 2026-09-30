import {
  applyLegacySessionColor,
  isLegacySessionColor,
  type LegacySessionColor,
} from "./sessionColors";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type StateStorage, createMemoryStorage } from "../../lib/storage";

export function sanitizeWorkspaceOrders(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || !("workspaceOrderByProject" in value)) return {};
  const orders = value.workspaceOrderByProject;
  if (!orders || typeof orders !== "object") return {};
  return Object.fromEntries(
    Object.entries(orders).flatMap(([project, order]) =>
      Array.isArray(order)
        ? [[project, [...new Set(order.filter((key): key is string => typeof key === "string"))]]]
        : [],
    ),
  );
}

function sanitizeProjectPins(value: unknown): string[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("pinnedProjectKeys" in value) ||
    !Array.isArray(value.pinnedProjectKeys)
  )
    return [];
  return [
    ...new Set(value.pinnedProjectKeys.filter((key): key is string => typeof key === "string")),
  ];
}
function sanitizeSessionColors(value: unknown): Record<string, LegacySessionColor> {
  if (
    !value ||
    typeof value !== "object" ||
    !("sessionColors" in value) ||
    !value.sessionColors ||
    typeof value.sessionColors !== "object"
  )
    return {};
  return Object.fromEntries(
    Object.entries(value.sessionColors).filter((entry): entry is [string, LegacySessionColor] =>
      isLegacySessionColor(entry[1]),
    ),
  );
}
export function orderLegacyPinnedProjects<T extends { projectKey: string }>(
  projects: readonly T[],
  pins: readonly string[],
): T[] {
  const pinned = new Set(pins);
  return [
    ...projects.filter((project) => pinned.has(project.projectKey)),
    ...projects.filter((project) => !pinned.has(project.projectKey)),
  ];
}

interface LegacySidebarPreferences {
  activityViewEnabled: boolean;
  setActivityViewEnabled: (enabled: boolean) => void;
  workspaceOrderByProject: Record<string, string[]>;
  pinnedProjectKeys: string[];
  sessionColors: Record<string, LegacySessionColor>;
  toggleProjectPin: (projectKey: string) => void;
  setSessionColor: (threadKeys: readonly string[], color: LegacySessionColor | null) => void;
  setWorkspaceOrder: (projectKey: string, order: readonly string[]) => void;
}

export function createLegacySidebarPreferences(storage: StateStorage) {
  return create<LegacySidebarPreferences>()(
    persist(
      (set) => ({
        activityViewEnabled: false,
        setActivityViewEnabled: (activityViewEnabled) => set({ activityViewEnabled }),
        workspaceOrderByProject: {},
        pinnedProjectKeys: [],
        sessionColors: {},
        toggleProjectPin: (projectKey) =>
          set((state) => ({
            pinnedProjectKeys: state.pinnedProjectKeys.includes(projectKey)
              ? state.pinnedProjectKeys.filter((key) => key !== projectKey)
              : [...state.pinnedProjectKeys, projectKey],
          })),
        setSessionColor: (keys, color) =>
          set((state) => ({
            sessionColors: applyLegacySessionColor(state.sessionColors, keys, color),
          })),
        setWorkspaceOrder: (projectKey, order) =>
          set((state) => ({
            workspaceOrderByProject: {
              ...state.workspaceOrderByProject,
              [projectKey]: [...new Set(order)],
            },
          })),
      }),
      {
        name: "t3code:legacy-sidebar-layout:v1",
        storage: createJSONStorage(() => storage),
        partialize: (state) => ({
          activityViewEnabled: state.activityViewEnabled,
          workspaceOrderByProject: state.workspaceOrderByProject,
          pinnedProjectKeys: state.pinnedProjectKeys,
          sessionColors: state.sessionColors,
        }),
        merge: (stored, current) => ({
          ...current,
          activityViewEnabled: Boolean(
            stored &&
            typeof stored === "object" &&
            "activityViewEnabled" in stored &&
            stored.activityViewEnabled === true,
          ),
          workspaceOrderByProject: sanitizeWorkspaceOrders(stored),
          pinnedProjectKeys: sanitizeProjectPins(stored),
          sessionColors: sanitizeSessionColors(stored),
        }),
      },
    ),
  );
}

function defaultStorage(): StateStorage {
  try {
    return window.localStorage;
  } catch {
    return createMemoryStorage();
  }
}

export const useLegacySidebarPreferences = createLegacySidebarPreferences(defaultStorage());

export function moveLegacySidebarItem(keys: readonly string[], from: string, to: string): string[] {
  const source = keys.indexOf(from);
  const target = keys.indexOf(to);
  if (source < 0 || target < 0 || source === target) return [...keys];
  const next = [...keys];
  next.splice(source, 1);
  next.splice(target, 0, from);
  return next;
}

export function mergeVisibleWorkspaceOrder(
  allKeys: readonly string[],
  visibleOrder: readonly string[],
): string[] {
  const known = new Set(allKeys);
  const order = [...new Set(visibleOrder)].filter((key) => known.has(key));
  const visible = new Set(order);
  let index = 0;
  return allKeys.map((key) => (visible.has(key) ? order[index++]! : key));
}
