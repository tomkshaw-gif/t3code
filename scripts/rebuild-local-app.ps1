<#
.SYNOPSIS
  Rebuilds the Windows installer from this worktree, silently installs it over
  the running "T3 Code (Tom)" app, and relaunches it.

.DESCRIPTION
  The first invocation re-launches itself detached in a new console window, so
  the installer closing the app cannot kill the build — even if this script was
  started from a terminal inside T3 Code itself. Watch the new window for
  progress; the app closes during the silent install and reopens after.

  Requirements: Node 24 on PATH, Rust toolchain, MSVC Build Tools, Python 3 —
  the same prerequisites as `npm run dist:desktop:win` (docs/operations/development.md).

.PARAMETER Version
  Optional build version (x.y.z). Defaults to apps/server/package.json version.
  Pass a newer version than the installed build for the auto-update feed to
  consider it an upgrade later.

.EXAMPLE
  .\scripts\rebuild-local-app.ps1 -Version 0.0.41
#>
[CmdletBinding()]
param(
  [string]$Version,
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\t3code-tom'
$appExe = Join-Path $installDir 'T3 Code (Tom).exe'
$releaseDir = Join-Path $repoRoot 'release'

# Re-spawn detached: the install kills the app, and anything spawned from the
# app's own terminal tree dies with it. The child gets a persistent console
# window (-NoExit) so the result stays visible after the app is gone.
if ($env:T3_REBUILD_DETACHED -ne '1') {
  $childArgs = @(
    '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', "`"$PSCommandPath`""
  )
  if ($Version) { $childArgs += @('-Version', "`"$Version`"") }
  if ($NoLaunch) { $childArgs += '-NoLaunch' }
  $env:T3_REBUILD_DETACHED = '1'
  Start-Process powershell -ArgumentList $childArgs -WorkingDirectory $repoRoot
  Write-Host "[t3-rebuild] Relaunched detached in a new window — follow progress there."
  return
}

try {
  $nodeVersion = (node -v) 2>$null
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') {
    throw "Need Node 24 on PATH (engines: ^24.13.1); found '$nodeVersion'."
  }

  $buildArgs = @('scripts/build-desktop-artifact.ts', '--platform', 'win', '--target', 'nsis', '--verbose')
  if ($Version) { $buildArgs += @('--build-version', $Version) }

  Write-Host "[t3-rebuild] Building installer (this takes a while)..." -ForegroundColor Cyan
  Push-Location $repoRoot
  try {
    & node @buildArgs
    if ($LASTEXITCODE -ne 0) { throw "desktop artifact build failed (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }

  $installer = Get-ChildItem $releaseDir -Filter 'T3-Code-*.exe' -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $installer) { throw "No installer produced under $releaseDir" }

  Write-Host "[t3-rebuild] Installing $($installer.Name) — T3 Code will close now." -ForegroundColor Yellow
  # NSIS one-click installer: /S is silent and terminates the running app itself.
  Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait

  if (-not $NoLaunch -and -not (Get-Process -Name 'T3 Code (Tom)' -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path $appExe)) { throw "Installed app not found at $appExe" }
    Write-Host "[t3-rebuild] Relaunching T3 Code (Tom)..." -ForegroundColor Cyan
    Start-Process -FilePath $appExe
  }

  Write-Host "[t3-rebuild] Done — $((Get-Item $installer.FullName).BaseName) installed." -ForegroundColor Green
} catch {
  Write-Host "[t3-rebuild] FAILED: $_" -ForegroundColor Red
  exit 1
}
