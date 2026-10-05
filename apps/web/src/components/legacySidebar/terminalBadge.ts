export interface LegacyTerminalBadge {
  tooltip: string;
  /** Shown in place of the terminal glyph when more than one process is running. */
  count: number | null;
  colorClass: string;
  pulse: boolean;
}

export interface LegacyTerminalStatus {
  label: string;
  colorClass: string;
  pulse: boolean;
}

/**
 * Synara's provider-avatar terminal chip: a count when several terminals are
 * running, otherwise the single-process status glyph. Idle threads stay bare.
 */
export function resolveLegacyTerminalBadge(input: {
  runningCount: number;
  status: LegacyTerminalStatus | null;
}): LegacyTerminalBadge | null {
  const count = input.runningCount;
  if (count <= 1 && input.status === null) {
    return null;
  }
  if (count > 1) {
    return {
      tooltip: `${count} terminals open`,
      count,
      colorClass: input.status?.colorClass ?? "text-muted-foreground/55",
      pulse: false,
    };
  }
  return {
    tooltip: input.status?.label ?? "Terminal open",
    count: null,
    colorClass: input.status?.colorClass ?? "text-muted-foreground/55",
    pulse: input.status?.pulse ?? false,
  };
}
