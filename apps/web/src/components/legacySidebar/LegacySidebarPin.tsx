import { createContext, use, useCallback, useState, type ReactNode } from "react";
import { PinIcon } from "lucide-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { SidebarThreadSummary } from "../../types";
import type { useThreadActions } from "../../hooks/useThreadActions";
import { useEnvironment } from "../../state/environments";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const PinActionsContext = createContext<((thread: SidebarThreadSummary) => Promise<void>) | null>(
  null,
);

export function LegacyPinActionsProvider({
  actions,
  children,
}: {
  actions: Pick<ReturnType<typeof useThreadActions>, "pinThread" | "confirmAndUnpinThread">;
  children: ReactNode;
}) {
  const toggle = useCallback(
    async (thread: SidebarThreadSummary) => {
      const ref = scopeThreadRef(thread.environmentId, thread.id);
      const result =
        thread.pinnedAt != null
          ? await actions.confirmAndUnpinThread(ref)
          : await actions.pinThread(ref);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: thread.pinnedAt != null ? "Could not unpin thread" : "Could not pin thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [actions],
  );
  return <PinActionsContext value={toggle}>{children}</PinActionsContext>;
}

export function useLegacyTogglePin() {
  const toggle = use(PinActionsContext);
  if (!toggle) throw new Error("Legacy pin controls require LegacyPinActionsProvider");
  return toggle;
}

export function LegacyThreadPinButton({ thread }: { thread: SidebarThreadSummary }) {
  const toggle = useLegacyTogglePin();
  const environment = useEnvironment(thread.environmentId);
  const [pending, setPending] = useState(false);
  if (environment?.serverConfig?.environment.capabilities.threadPinning !== true) return null;
  const pinned = thread.pinnedAt != null;
  const label = pinned ? "Unpin thread" : "Pin thread";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-legacy-thread-pin-button
            data-pinned={pinned}
            data-thread-selection-safe
            aria-label={`${label}: ${thread.title}`}
            disabled={pending}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={async (event) => {
              event.preventDefault();
              event.stopPropagation();
              setPending(true);
              try {
                await toggle(thread);
              } finally {
                setPending(false);
              }
            }}
          />
        }
      >
        <PinIcon aria-hidden className="size-3" />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
