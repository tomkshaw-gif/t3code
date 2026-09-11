---
name: sync-upstream
description: Merge official T3 Code updates from pingdotgg/t3code into this fork without losing fork changes. Use when an upstream sync PR exists (branch chore/upstream-sync, possibly with committed conflict markers), when the fork has fallen behind upstream, or when the user asks to pull in official updates.
---

# Sync upstream

This fork (`tomkshaw-gif/t3code`) tracks `upstream` = `https://github.com/pingdotgg/t3code.git`. Upstream changes always land on `main` **through a PR** — never push merges to `main` directly.

## Starting a sync

The `Sync upstream` workflow (`.github/workflows/sync-upstream.yml`) does this weekly and on manual dispatch. It resets `chore/upstream-sync` to `origin/main` and merges `upstream/main`, opening a normal PR on a clean merge or a **draft** PR when conflicts exist — in that case the conflicted files are committed with `<<<<<<<` / `=======` / `>>>>>>>` markers in place.

To do it by hand instead:

```bash
git fetch upstream main
git checkout -B chore/upstream-sync origin/main
git merge upstream/main          # resolve conflicts if any
git push -f origin chore/upstream-sync
gh pr create --base main --head chore/upstream-sync   # --draft if conflicts remain
```

## Resolving a conflicted sync PR

1. `git fetch origin && git checkout chore/upstream-sync && git pull`
2. Find conflict markers: `rg -l '<<<<<<<'` — resolve each file by keeping both sides' intent, not by picking "ours" wholesale.
3. Verify: targeted `vp test run`/`tsc --noEmit` for touched packages, plus `vp check --fix` for formatting.
4. Commit, push, then `gh pr ready <number>` to un-draft.

## Fork invariants — never let upstream overwrite these

When resolving, these are fork-owned and must survive the merge:

- **Devin provider** — everything under `apps/server/src/provider/{Layers,Drivers,acp}/Devin*` plus its entries in `builtInDrivers.ts`, `packages/contracts` (settings/model/orchestration), `apps/web` provider metadata, and `DevinSkills`.
- **Branding/identity** — `apps/desktop/package.json` `productName: "T3 Code (Tom)"`; `scripts/build-desktop-artifact.ts` `DESKTOP_APP_ID: "com.tomkshaw.t3code"` and the fork default in `resolveGitHubPublishConfig`.
- **Fork-only workflows** — `.github/workflows/desktop-release.yml`, `sync-upstream.yml`. Upstream's `release.yml` needs upstream's runners/secrets and cannot run here.
- **`.agents/skills/`** — fork skill files, including this one.

If upstream rewrote a shared file heavily (e.g. `AcpSessionRuntime.ts`), prefer re-applying the fork's behavior on upstream's new shape over reverting upstream.

## Publishing a release

`Desktop release (fork)` (`.github/workflows/desktop-release.yml`) builds the Windows NSIS installer and attaches it plus `latest.yml` to a GitHub release marked `latest` — that feed is what the installed app's auto-updater checks. Two ways to trigger: push a `v<x.y.z>` tag (`git tag v0.0.42 && git push origin v0.0.42`), or manual dispatch with a `version` input. Versions must be plain `x.y.z` and higher than the installed build; nightly/prerelease versions are not served to stable installs.
