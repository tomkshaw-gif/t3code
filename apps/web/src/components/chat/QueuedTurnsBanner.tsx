import { AlarmClockIcon, ChevronDownIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import type { MessageId, OrchestrationQueuedTurn } from "@t3tools/contracts";

import { cn } from "~/lib/utils";

/**
 * Hermes-style queue preview: a chevron-collapsible strip attached above the
 * composer listing every parked send. Each row previews the parked text and
 * can be edited back into the composer draft or dropped from the queue.
 */
export function QueuedTurnsBanner({
  entries,
  textById,
  attachmentCountById,
  onEdit,
  onCancel,
}: {
  readonly entries: readonly OrchestrationQueuedTurn[];
  readonly textById: ReadonlyMap<MessageId, string>;
  readonly attachmentCountById: ReadonlyMap<MessageId, number>;
  readonly onEdit: (entry: OrchestrationQueuedTurn) => void;
  readonly onCancel: (entry: OrchestrationQueuedTurn) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (entries.length === 0) return null;

  return (
    <div data-queued-turns-banner="true">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className="flex min-w-0 w-full cursor-pointer items-center gap-1.5 px-1 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDownIcon
          className={cn("size-3.5 shrink-0 transition-transform", !expanded && "-rotate-90")}
        />
        <AlarmClockIcon className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {entries.length === 1
            ? "1 message queued — sends when this turn ends"
            : `${entries.length} messages queued — send in order when this turn ends`}
        </span>
      </button>
      {expanded ? (
        <ul className="mt-0.5 space-y-0.5 pb-0.5 ps-6 pe-1">
          {entries.map((entry) => {
            const text = textById.get(entry.messageId)?.trim() ?? "";
            const attachments = attachmentCountById.get(entry.messageId) ?? 0;
            const preview =
              text ||
              (attachments > 0
                ? `${attachments} attachment${attachments === 1 ? "" : "s"}`
                : "Empty message");
            return (
              <li key={entry.messageId} className="group/queued flex min-w-0 items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {preview}
                </span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    aria-label="Edit queued message in composer"
                    title="Edit in composer"
                    onClick={() => onEdit(entry)}
                    className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <PencilIcon className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove from queue"
                    title="Remove from queue"
                    onClick={() => onCancel(entry)}
                    className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Trash2Icon className="size-3" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
