import { BotIcon, ChevronDownIcon, CornerUpLeftIcon, SquareIcon } from "lucide-react";
import { useState } from "react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import { cn } from "~/lib/utils";
import {
  sortWorkerRows,
  workerRowInFlight,
  workerRowStatus,
  type WorkerRowStatus,
} from "./ComposerWorkersStrip.logic";

export interface WorkersStripRow {
  readonly thread: EnvironmentThreadShell;
  readonly providerLabel: string;
  readonly modelLabel: string;
}

const STATUS_PRESENTATION: Record<
  WorkerRowStatus,
  { label: string; dotClassName: string; labelClassName: string }
> = {
  // Same hues the sidebar uses so a worker reads identically in both places.
  approval: {
    label: "Needs approval",
    dotClassName: "bg-amber-500",
    labelClassName: "text-amber-700 dark:text-amber-300",
  },
  input: {
    label: "Needs input",
    dotClassName: "bg-indigo-500",
    labelClassName: "text-indigo-600 dark:text-indigo-300",
  },
  failed: {
    label: "Failed",
    dotClassName: "bg-red-500",
    labelClassName: "text-red-700 dark:text-red-300",
  },
  working: {
    label: "Working",
    dotClassName: "bg-sky-500",
    labelClassName: "text-sky-600 dark:text-sky-400",
  },
  queued: {
    label: "Queued",
    dotClassName: "bg-muted-foreground/60",
    labelClassName: "text-muted-foreground",
  },
  monitoring: {
    label: "Monitoring",
    dotClassName: "bg-sky-500",
    labelClassName: "text-sky-600 dark:text-sky-400",
  },
  ready: {
    label: "Idle",
    dotClassName: "bg-muted-foreground/40",
    labelClassName: "text-muted-foreground",
  },
};

/**
 * Synara-style worker panel: the threads this thread spawned (or its siblings
 * plus a back-to-orchestrator row when viewing a worker) fused to the composer.
 * Rows show live status and open the worker on click; a running worker can be
 * interrupted in place. Settles collapsed when nothing is in flight.
 */
export function ComposerWorkersStrip({
  workers,
  orchestrator,
  onOpen,
  onInterrupt,
}: {
  readonly workers: readonly WorkersStripRow[];
  /** Non-null when the open thread is itself a worker — adds the back row. */
  readonly orchestrator: EnvironmentThreadShell | null;
  readonly onOpen: (thread: EnvironmentThreadShell) => void;
  readonly onInterrupt: (thread: EnvironmentThreadShell) => void;
}) {
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const expanded = expandedOverride ?? workers.some(({ thread }) => workerRowInFlight(thread));
  if (workers.length === 0 && orchestrator === null) return null;

  const running = workers.filter(({ thread }) => workerRowStatus(thread) === "working").length;
  const attention = workers.filter(({ thread }) => {
    const status = workerRowStatus(thread);
    return status === "approval" || status === "input" || status === "failed";
  }).length;
  const headerText =
    attention > 0
      ? `${workers.length} worker${workers.length === 1 ? "" : "s"} · ${attention} need${attention === 1 ? "s" : ""} attention`
      : running > 0
        ? `${running} of ${workers.length} worker${workers.length === 1 ? "" : "s"} running`
        : `${workers.length} worker${workers.length === 1 ? "" : "s"} idle`;

  return (
    <div data-workers-strip="true">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpandedOverride(!expanded)}
        className="flex min-w-0 w-full cursor-pointer items-center gap-1.5 px-1 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDownIcon
          className={cn("size-3.5 shrink-0 transition-transform", !expanded && "-rotate-90")}
        />
        <BotIcon className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{headerText}</span>
      </button>
      {expanded ? (
        <ul className="mt-0.5 space-y-0.5 pb-0.5 ps-6 pe-1">
          {orchestrator !== null ? (
            <li>
              <button
                type="button"
                onClick={() => onOpen(orchestrator)}
                className="flex min-w-0 w-full cursor-pointer items-center gap-1.5 rounded py-0.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <CornerUpLeftIcon className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{orchestrator.title} — orchestrator</span>
              </button>
            </li>
          ) : null}
          {sortWorkerRows(workers).map(({ thread, providerLabel, modelLabel }) => {
            const status = workerRowStatus(thread);
            const presentation = STATUS_PRESENTATION[status];
            const stoppable = status === "working" || status === "monitoring";
            return (
              <li key={thread.id} className="group/worker flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onOpen(thread)}
                  title={`Open ${thread.title}`}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded py-0.5 text-left"
                >
                  <span
                    className={cn("size-1.5 shrink-0 rounded-full", presentation.dotClassName)}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground/80 group-hover/worker:text-foreground">
                    {thread.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground/80">
                    {providerLabel} · {modelLabel}
                  </span>
                  <span className={cn("shrink-0 text-[11px]", presentation.labelClassName)}>
                    {presentation.label}
                  </span>
                </button>
                {stoppable ? (
                  <button
                    type="button"
                    aria-label={`Stop ${thread.title}`}
                    title="Stop this worker's current turn"
                    onClick={() => onInterrupt(thread)}
                    className="cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/worker:opacity-100"
                  >
                    <SquareIcon className="size-3" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
