# Maintaining Tom's Windows nightly fork

This guide applies to [`tomkshaw-gif/t3code`](https://github.com/tomkshaw-gif/t3code).
Its default and release branch is `nightly-plus-threads`. That branch combines
upstream [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) with the
[Threads PR #2829](https://github.com/pingdotgg/t3code/pull/2829). The fork's
older `main` branch has separate history; do not reset, delete, or merge it
without reviewing those changes with Tom.

## What makes the installed app update

`.github/workflows/fork-desktop-release.yml` runs on a push to
`nightly-plus-threads`. It builds a **Windows x64** nightly installer and
publishes a GitHub prerelease with the `.exe`, `.blockmap`, and `nightly.yml`.
Every push to that branch, including a documentation-only push, starts this
release workflow.
The release tag must point to the exact commit that built the installer.
The build sets `T3CODE_DESKTOP_UPDATE_REPOSITORY` to this fork, so the packaged
`resources/app-update.yml` uses `tomkshaw-gif/t3code`, `releaseType: prerelease`,
and `channel: nightly`. The app checks at startup and periodically, downloads a
newer release in the background, and installs it when the app next exits. The
update button can install it sooner.

Only the **first** fork build needs a manual installer run. Later successful
releases update an installed fork build. Installing an official T3 Code build
again would replace this fork's update feed. The fork workflow does **not**
publish a matching `t3` npm package, macOS app, Linux app, or mobile app;
remote command-line servers need their own release plan.

## Bring in upstream and Threads changes

1. Check the checkout's branch, HEAD, and dirty state. Preserve local work.
   Confirm `origin` is `tomkshaw-gif/t3code` and `upstream` is
   `pingdotgg/t3code`; add the latter remote if missing. Check the current
   upstream default branch and PR #2829 state and head on GitHub. If the PR has
   been merged or superseded, use its actual successor rather than replaying
   stale commits. Check which commit produced the latest official nightly;
   do not assume a release tag is a source branch.
2. Fetch `origin/nightly-plus-threads`, upstream `main`, and the current PR
   head. Start a feature branch from the current `origin/nightly-plus-threads`.
   For example, while PR #2829 is still open:

   ```sh
   git fetch origin nightly-plus-threads
   git fetch upstream main
   git fetch upstream refs/pull/2829/head:refs/remotes/upstream/threads-pr
   git switch -c update/nightly-threads origin/nightly-plus-threads
   git merge --no-ff upstream/main
   git merge --no-ff upstream/threads-pr
   ```

   Resolve conflicts by checking both sides' behavior. Do not use a blanket
   “ours” or “theirs” resolution, force push, or reset the fork branch. If the
   PR head is already an ancestor after the upstream merge, skip its merge.

3. Run `git diff --check`, relevant focused tests and typechecks, and confirm
   the fetched upstream and PR heads are ancestors of the result. Follow
   `AGENTS.md` for test scope; do not run repo-wide checks locally. Review
   `.github/workflows/fork-desktop-release.yml` and keep the fork update
   repository, nightly channel, prerelease assets, and tag target intact.
4. Once Tom has authorized publishing this update, fast-forward
   `nightly-plus-threads` to the verified feature branch and push that branch
   to `origin`. If someone pushed meanwhile, fetch and integrate their work,
   then recheck; do not overwrite it. Pushing `main` or only the feature branch
   does not trigger the installed app's update path.

## Verify each published update

1. Watch the fork's **Fork desktop release** Actions run for the pushed commit
   until it succeeds. A successful push alone does not mean an update exists.
2. Check the new GitHub prerelease: its tag targets the pushed commit, and the
   `.exe`, `.blockmap`, and `nightly.yml` are present. Confirm `nightly.yml`
   names that installer and version. The installed app reads this fork's
   nightly prereleases, not the upstream Releases page.
3. On Windows, leave the fork app open long enough to check, then exit it after
   the download completes to install. Reopen it and confirm its version. If
   checking a fresh installation, inspect `resources/app-update.yml` for the
   fork owner, repo, prerelease type, and nightly channel. If Actions fails or
   the update is not offered, diagnose the run, release metadata, and app
   update state before publishing another build.

The fork's separate `.github/workflows/release.yml` is the upstream release
train; do not dispatch it as a substitute for **Fork desktop release**.

## Prompt for a future coding session

> Update my `tomkshaw-gif/t3code` fork's `nightly-plus-threads` branch with the
> latest upstream T3 Code source and current work from Threads PR #2829 (or its
> successor). Follow `docs/operations/fork-nightly-updates.md` and `AGENTS.md`.
> Preserve existing fork work, resolve conflicts, run focused checks, publish
> the verified combined branch, and monitor its Windows release. Verify the
> release tag, installer, and `nightly.yml` so my installed fork app can update
> on its next exit. Tell me if the PR or release process has changed.
