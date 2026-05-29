#!/usr/bin/env pwsh
# SmartChats installer for Windows (PowerShell 5+ / PowerShell Core 7+).
#
# Usage:
#   iwr -useb https://smartchats.ai/install.ps1 | iex
#
# Or download + run manually:
#   iwr -useb https://smartchats.ai/install.ps1 -o install.ps1
#   .\install.ps1 -NonInteractive
#
# Parameters (set via -Name Value or env var SMARTCHATS_*):
#   -Version <tag>      Pin to a specific release tag (default: latest).
#   -Prefix  <dir>      Install dir (default: $HOME\.smartchats).
#   -NoPath             Skip PATH wire-up.
#   -NonInteractive     Skip the final `smartchats setup`.
#
# What it does:
#   1. Detects arch via $env:PROCESSOR_ARCHITECTURE → maps to a release SKU
#      (currently windows-x64 only — Windows-on-ARM is not yet supported by
#      SurrealDB upstream, so the win-arm64 SKU is deliberately absent).
#   2. Downloads the matching tarball from GitHub Releases.
#   3. Extracts to $Prefix. Layout (parallel to the Unix install):
#        $Prefix\bin\smartchats.exe         (CLI, bun-compiled)
#        $Prefix\bin\smartchats-server.exe  (local server, bun-compiled)
#        $Prefix\bin\surreal.exe            (native binary)
#        $Prefix\app\out\                   (static SPA bundle)
#   4. Adds $Prefix\bin to the user's persistent PATH (User scope) unless
#      -NoPath. Also updates the current session's PATH.
#   5. Unless -NonInteractive, exec `smartchats setup` to walk through keys.

[CmdletBinding()]
param(
    [string]$Version = $(if ($env:SMARTCHATS_VERSION) { $env:SMARTCHATS_VERSION } else { 'latest' }),
    [string]$Prefix  = $(if ($env:SMARTCHATS_PREFIX)  { $env:SMARTCHATS_PREFIX  } else { Join-Path $HOME '.smartchats' }),
    [switch]$NoPath,
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'

# ─── Logging helpers ──────────────────────────────────────────────────
function Write-Info { Write-Host "info  $args" -ForegroundColor Cyan }
function Write-Ok   { Write-Host "ok    $args" -ForegroundColor Green }
function Write-Warn { Write-Host "warn  $args" -ForegroundColor Yellow }
function Write-Err  { Write-Host "err   $args" -ForegroundColor Red }

# ─── Banner ───────────────────────────────────────────────────────────
# Mirrors data/ascii-art.txt + scripts/install.sh banner.
$logo = @"

   _____ __  ______    ____  ______________  _____  ___________
  / ___//  |/  /   |  / __ \/_  __/ ____/ / / /   |/_  __/ ___/
  \__ \/ /|_/ / /| | / /_/ / / / / /   / /_/ / /| | / /  \__ \
 ___/ / /  / / ___ |/ _, _/ / / / /___/ __  / ___ |/ /  ___/ /
/____/_/  /_/_/  |_/_/ |_| /_/  \____/_/ /_/_/  |_/_/  /____/

"@
Write-Host $logo -ForegroundColor Green

# ─── Detect platform ──────────────────────────────────────────────────
$arch = $env:PROCESSOR_ARCHITECTURE
switch ($arch) {
    'AMD64' { $Platform = 'windows-x64' }
    'ARM64' {
        Write-Err 'Windows on ARM64 is not yet supported (SurrealDB upstream does not ship a windows-arm64 binary).'
        Write-Err 'Use WSL2 with scripts/install.sh in the meantime.'
        exit 1
    }
    default {
        Write-Err "Unsupported arch: $arch. Only AMD64 (x64) is supported on Windows for now."
        exit 1
    }
}
Write-Info "Platform: $Platform"

# ─── Resolve release URL ──────────────────────────────────────────────
$Repo = if ($env:SMARTCHATS_INSTALL_REPO) { $env:SMARTCHATS_INSTALL_REPO } else { 'sheunaluko/smartchats' }
$Base = if ($env:SMARTCHATS_INSTALL_BASE) { $env:SMARTCHATS_INSTALL_BASE } else { "https://github.com/$Repo/releases" }
$TarballName = "smartchats-$Platform.tar.gz"

if ($env:SMARTCHATS_TARBALL_URL) {
    $DownloadUrl = $env:SMARTCHATS_TARBALL_URL
} elseif ($Version -eq 'latest') {
    $DownloadUrl = "$Base/latest/download/$TarballName"
} else {
    $DownloadUrl = "$Base/download/$Version/$TarballName"
}
Write-Info "Downloading $DownloadUrl"

# ─── Download + extract ───────────────────────────────────────────────
$TmpDir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "smartchats-install-$([guid]::NewGuid().ToString('N'))")
try {
    $TarballPath = Join-Path $TmpDir.FullName 'smartchats.tar.gz'
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TarballPath -UseBasicParsing
    $size = [math]::Round((Get-Item $TarballPath).Length / 1MB, 1)
    Write-Ok "Downloaded $size MB"

    if (-not (Test-Path $Prefix)) { New-Item -ItemType Directory -Path $Prefix | Out-Null }

    # Requires Windows 10 1803+ (October 2018) for tar.exe. All supported
    # Windows versions ship with it.
    & tar.exe -xzf $TarballPath -C $Prefix
    if ($LASTEXITCODE -ne 0) {
        Write-Err 'tar extraction failed.'
        exit 1
    }
    Write-Ok "Extracted to $Prefix"

    # Sanity-check.
    $cliPath = Join-Path $Prefix 'bin\smartchats.exe'
    if (-not (Test-Path $cliPath)) {
        Write-Err "Install incomplete: $cliPath not found."
        Write-Err "Tarball layout may have changed. Report at https://github.com/$Repo/issues"
        exit 1
    }
} finally {
    Remove-Item -Recurse -Force $TmpDir.FullName -ErrorAction SilentlyContinue
}

# ─── Wire into PATH ───────────────────────────────────────────────────
if (-not $NoPath) {
    $binDir = Join-Path $Prefix 'bin'
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath -notlike "*$binDir*") {
        $newPath = if ([string]::IsNullOrEmpty($userPath)) { $binDir } else { "$binDir;$userPath" }
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        Write-Ok "Added $binDir to user PATH (persistent)"
        Write-Warn 'Open a new PowerShell window to use `smartchats` directly.'
    } else {
        Write-Info "$binDir already on user PATH — skipping."
    }
    # Also update the current session so the user can use it without reopening.
    if ($env:Path -notlike "*$binDir*") {
        $env:Path = "$binDir;$env:Path"
    }
}

Write-Host ''
Write-Ok "smartchats installed → $Prefix"
Write-Host ''

if ($NonInteractive) {
    Write-Info 'Skipping interactive setup (-NonInteractive).'
    Write-Info 'Run `smartchats setup` to configure provider keys and start the stack.'
    exit 0
}

# Exec setup. Note: this is a child invocation — its prompts run in our
# current console, which is what we want.
& (Join-Path $Prefix 'bin\smartchats.exe') setup
exit $LASTEXITCODE
