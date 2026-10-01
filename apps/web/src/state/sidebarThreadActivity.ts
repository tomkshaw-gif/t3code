import { useAtomValue } from "@effect/atom-react";
import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";
import {
  deriveWorkingSubagentThreadKeys,
  withWorkingSubagentActivity,
} from "../lib/sidebarSubagentActivity";
import { useThreadShell, useThreadShells, useThreadShellsForProjectRefs } from "./entities";
import { environmentThreadShells } from "./threads";

// One shared traversal across all environments; stable membership avoids waking
// every project subscription for unrelated shell updates or child transcript work.
const workingSubagentParentsAtom = Atom.make((get) =>
  deriveWorkingSubagentThreadKeys(get(environmentThreadShells.threadShellsAtom)),
).pipe(
  Atom.withEquality<ReadonlySet<string>>(
    (left, right) => left.size === right.size && [...left].every((key) => right.has(key)),
  ),
);

export function useSidebarThreadShells() {
  const threads = useThreadShells();
  const workingParents = useAtomValue(workingSubagentParentsAtom);
  return useMemo(
    () => threads.map((thread) => withWorkingSubagentActivity(thread, workingParents)),
    [threads, workingParents],
  );
}

export function useSidebarThreadShellsForProjectRefs(refs: ReadonlyArray<ScopedProjectRef>) {
  const threads = useThreadShellsForProjectRefs(refs);
  const workingParents = useAtomValue(workingSubagentParentsAtom);
  return useMemo(
    () => threads.map((thread) => withWorkingSubagentActivity(thread, workingParents)),
    [threads, workingParents],
  );
}

export function useSidebarThreadShell(ref: ScopedThreadRef | null) {
  const thread = useThreadShell(ref);
  const workingParents = useAtomValue(workingSubagentParentsAtom);
  return useMemo(
    () => (thread === null ? null : withWorkingSubagentActivity(thread, workingParents)),
    [thread, workingParents],
  );
}
