import { useRef } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { useThreadActions } from "../../hooks/useThreadActions";
import { readThreadShell, readEnvironmentSupportsSettlement } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useUiStateStore } from "../../uiStateStore";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { toggleLegacyThreadDone } from "./threadDone";

function reportFailure(result: AtomCommandResult<unknown, unknown>, title: string): boolean {
  if (result._tag === "Success") return true;
  if (!isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  }
  return false;
}

export function useLegacyThreadDone({
  settleThread,
  unsettleThread,
}: Pick<ReturnType<typeof useThreadActions>, "settleThread" | "unsettleThread">) {
  const visit = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const pending = useRef(new Set<string>());
  return async (ref: ScopedThreadRef) => {
    const key = scopedThreadKey(ref);
    const thread = readThreadShell(ref);
    if (
      !thread ||
      !readEnvironmentSupportsSettlement(ref.environmentId) ||
      pending.current.has(key)
    )
      return;
    pending.current.add(key);
    const visitedAt = new Date().toISOString();
    try {
      await toggleLegacyThreadDone(thread, {
        visitedAt,
        settle: async () => reportFailure(await settleThread(ref), "Failed to mark Done"),
        unsettle: async () => reportFailure(await unsettleThread(ref), "Failed to undo Done"),
        visit: async (watermark) =>
          reportFailure(
            await visit({
              environmentId: ref.environmentId,
              input: { threadId: ref.threadId, visitedAt: watermark },
            }),
            "Marked Done, but could not mark read",
          ),
        markLocal: (watermark) => useUiStateStore.getState().markThreadVisited(key, watermark),
      });
    } finally {
      pending.current.delete(key);
    }
  };
}
