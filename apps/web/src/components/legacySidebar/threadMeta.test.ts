import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { resolveLegacyThreadMetaChips } from "./threadMeta";

function thread(
  relationship: "fork" | "subagent" | null = null,
  worktreePath: string | null = null,
) {
  return {
    lineage: {
      rootThreadId: ThreadId.make("root"),
      parentThreadId: relationship ? ThreadId.make("parent") : null,
      relationshipToParent: relationship,
    },
    worktreePath,
    branch: null as string | null,
  };
}

describe("legacy fork and worktree identity", () => {
  it.each([
    { fork: false, worktree: false, badges: [] },
    { fork: true, worktree: false, badges: ["fork"] },
    { fork: false, worktree: true, badges: ["worktree"] },
    { fork: true, worktree: true, badges: ["fork", "worktree"] },
  ])(
    "distinguishes conversation forks from worktrees: $fork / $worktree",
    ({ fork, worktree, badges }) => {
      const source = thread(fork ? "fork" : null, worktree ? "/work/feature" : null);
      expect(resolveLegacyThreadMetaChips(source).map((chip) => chip.id)).toEqual(badges);
      // Leaving a worktree does not remove a conversation's fork identity.
      expect(
        resolveLegacyThreadMetaChips({ ...source, worktreePath: null }).map((chip) => chip.id),
      ).toEqual(fork ? ["fork"] : []);
    },
  );

  it("does not describe subagents or root sessions as user-created forks", () => {
    expect(resolveLegacyThreadMetaChips(thread("subagent"))).toEqual([]);
    const orphan = thread("fork");
    expect(
      resolveLegacyThreadMetaChips({
        ...orphan,
        lineage: { ...orphan.lineage, parentThreadId: null },
      }),
    ).toEqual([]);
  });

  it("shows the physical worktree name and branch for Windows and remote paths", () => {
    const windows = resolveLegacyThreadMetaChips({
      ...thread("fork", "C:\\work\\fix-stops\\"),
      branch: "fix/stops",
    });
    expect(windows.map((chip) => chip.tooltip)).toEqual([
      "Forked thread",
      "Worktree: fix-stops (fix/stops)",
    ]);
    expect(
      resolveLegacyThreadMetaChips(thread(null, "/srv/project/remote-worktree/"))[0]!.tooltip,
    ).toBe("Worktree: remote-worktree");
    expect(resolveLegacyThreadMetaChips(thread(null, "   "))).toEqual([]);
  });
});
