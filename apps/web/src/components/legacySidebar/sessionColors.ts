import type { ContextMenuItem } from "@t3tools/contracts";

// Orca-style manual tab colours. These are personal organization markers;
// live agent status continues to come from T3.
export const LEGACY_SESSION_COLORS = {
  yellow: { label: "Yellow — Needs attention", color: "#eab308" },
  blue: { label: "Blue — To do", color: "#3b82f6" },
  orange: { label: "Orange — In progress", color: "#f97316" },
  green: { label: "Green — Done", color: "#22c55e" },
  red: { label: "Red — Blocked", color: "#ef4444" },
  purple: { label: "Purple — Review", color: "#a855f7" },
  pink: { label: "Pink", color: "#ec4899" },
  teal: { label: "Teal", color: "#14b8a6" },
  gray: { label: "Gray", color: "#9ca3af" },
} as const;
export type LegacySessionColor = keyof typeof LEGACY_SESSION_COLORS;
export function isLegacySessionColor(value: unknown): value is LegacySessionColor {
  return typeof value === "string" && Object.hasOwn(LEGACY_SESSION_COLORS, value);
}
export function buildLegacySessionColorMenu(
  keys: readonly string[],
  colors: Readonly<Record<string, LegacySessionColor>>,
): ContextMenuItem<string> {
  return {
    id: "session-color",
    label: "Session colour",
    children: [
      {
        id: "session-color:none",
        label: "Clear colour",
        checked: keys.every((key) => !colors[key]),
      },
      ...Object.entries(LEGACY_SESSION_COLORS).map(([id, option]) => ({
        id: `session-color:${id}`,
        label: option.label,
        checked: keys.every((key) => colors[key] === id),
      })),
    ],
  };
}
export function applyLegacySessionColor(
  colors: Readonly<Record<string, LegacySessionColor>>,
  keys: readonly string[],
  color: LegacySessionColor | null,
): Record<string, LegacySessionColor> {
  const next = { ...colors };
  for (const key of keys) {
    if (color === null) delete next[key];
    else next[key] = color;
  }
  return next;
}
