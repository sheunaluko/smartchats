#!/usr/bin/env bash
# SmartChats installer.
#
# Usage:
#   curl -fsSL https://smartchats.ai/install | bash
#
# Flags (pass after `bash -s --` when piping; or as plain args when running locally):
#   --non-interactive   Skip the final `smartchats setup` prompt sequence.
#                       Use in Docker/CI/automation. Stack won't run until
#                       the user runs `smartchats setup` themselves.
#   --version <tag>     Pin to a specific release tag (default: latest).
#   --prefix <dir>      Install prefix (default: ~/.smartchats).
#   --no-path           Don't modify shell rc files.
#   --help              Show this help.
#
# What it does:
#   1. Detect OS + arch via `uname -sm` → maps to a release tarball name.
#   2. Download the matching tarball from GitHub Releases.
#   3. Extract to $PREFIX. Layout:
#        $PREFIX/bin/smartchats        (CLI, bun-compiled)
#        $PREFIX/bin/smartchats-server (local server, bun-compiled)
#        $PREFIX/bin/surreal           (native binary)
#        $PREFIX/app/out/              (static SPA bundle)
#   4. Symlink `$PREFIX/bin/smartchats` into the shell's PATH (or add
#      $PREFIX/bin to PATH via shell rc, depending on where /usr/local
#      is writable).
#   5. Unless --non-interactive, exec `smartchats setup`.

set -euo pipefail

# ─── Defaults ─────────────────────────────────────────────────────────
NONINTERACTIVE=false
VERSION="latest"
PREFIX="${HOME}/.smartchats"
MODIFY_PATH=true

GITHUB_REPO="${SMARTCHATS_INSTALL_REPO:-sheunaluko/smartchats}"
DOWNLOAD_BASE="${SMARTCHATS_INSTALL_BASE:-https://github.com/${GITHUB_REPO}/releases}"

# ─── Parse args ───────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --non-interactive)  NONINTERACTIVE=true; shift ;;
        --version)          VERSION="$2"; shift 2 ;;
        --prefix)           PREFIX="$2"; shift 2 ;;
        --no-path)          MODIFY_PATH=false; shift ;;
        --help|-h)
            sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# ─── Logging helpers ──────────────────────────────────────────────────
if [[ -t 2 ]] && [[ -z "${NO_COLOR:-}" ]]; then
    C_BLUE='\033[0;34m'; C_GREEN='\033[0;32m'; C_RED='\033[0;31m'
    C_YELLOW='\033[0;33m'; C_RESET='\033[0m'
else
    C_BLUE=''; C_GREEN=''; C_RED=''; C_YELLOW=''; C_RESET=''
fi
info()    { printf "${C_BLUE}info${C_RESET}  %s\n" "$*" >&2; }
ok()      { printf "${C_GREEN}ok${C_RESET}    %s\n" "$*" >&2; }
warn()    { printf "${C_YELLOW}warn${C_RESET}  %s\n" "$*" >&2; }
err()     { printf "${C_RED}err${C_RESET}   %s\n" "$*" >&2; }

# ─── Banner ───────────────────────────────────────────────────────────
cat >&2 <<'EOF'

   ___                  _    ___ _         _
  / __| _ __  __ _ _ _ | |_ / __| |_  __ _| |_ ___
  \__ \| '  \/ _` | '_||  _|(__ | ' \/ _` |  _(_-<
  |___/|_|_|_\__,_|_|   \__|\___|_||_\__,_|\__/__/

EOF

# ─── Detect platform ──────────────────────────────────────────────────
OS=""
ARCH=""
case "$(uname -s)" in
    Darwin)  OS="darwin" ;;
    Linux)   OS="linux"  ;;
    *)       err "Unsupported OS: $(uname -s). Linux + macOS only for now."; exit 1 ;;
esac
case "$(uname -m)" in
    arm64|aarch64)  ARCH="arm64" ;;
    x86_64|amd64)   ARCH="x64"   ;;
    *)              err "Unsupported arch: $(uname -m). arm64 + x64 only."; exit 1 ;;
esac
PLATFORM="${OS}-${ARCH}"
info "Platform: ${PLATFORM}"

# ─── Find a downloader ────────────────────────────────────────────────
if command -v curl >/dev/null 2>&1; then
    DOWNLOAD_CMD="curl -fsSL"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOAD_CMD="wget -qO -"
else
    err "Neither curl nor wget found. Install one and re-run."
    exit 1
fi

# ─── Resolve release URL ──────────────────────────────────────────────
TARBALL_NAME="smartchats-${PLATFORM}.tar.gz"
if [[ "$VERSION" == "latest" ]]; then
    DOWNLOAD_URL="${DOWNLOAD_BASE}/latest/download/${TARBALL_NAME}"
else
    DOWNLOAD_URL="${DOWNLOAD_BASE}/download/${VERSION}/${TARBALL_NAME}"
fi
info "Downloading ${DOWNLOAD_URL}"

# ─── Extract ──────────────────────────────────────────────────────────
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if ! $DOWNLOAD_CMD "$DOWNLOAD_URL" -o "$TMP_DIR/smartchats.tar.gz" 2>/dev/null; then
    # `curl -o` form; for wget the redirect happens at command construction
    if ! $DOWNLOAD_CMD "$DOWNLOAD_URL" > "$TMP_DIR/smartchats.tar.gz"; then
        err "Failed to download release. Check connectivity, version, and:"
        err "    ${DOWNLOAD_URL}"
        exit 1
    fi
fi
ok "Downloaded $(du -h "$TMP_DIR/smartchats.tar.gz" | cut -f1)"

mkdir -p "$PREFIX"
tar -xzf "$TMP_DIR/smartchats.tar.gz" -C "$PREFIX"
ok "Extracted to ${PREFIX}"

# Sanity check.
if [[ ! -x "$PREFIX/bin/smartchats" ]]; then
    err "Install incomplete: $PREFIX/bin/smartchats not executable."
    err "Tarball layout may have changed. Report at https://github.com/${GITHUB_REPO}/issues"
    exit 1
fi

# ─── Wire into PATH ───────────────────────────────────────────────────
if $MODIFY_PATH; then
    # Try /usr/local/bin if writable (no sudo prompt for that decision).
    if [[ -w /usr/local/bin ]]; then
        ln -sf "$PREFIX/bin/smartchats" /usr/local/bin/smartchats
        ok "Symlinked $PREFIX/bin/smartchats → /usr/local/bin/smartchats"
    else
        # Otherwise add to the user's shell rc.
        SHELL_RC=""
        case "${SHELL:-}" in
            */zsh)  SHELL_RC="$HOME/.zshrc"  ;;
            */bash) SHELL_RC="$HOME/.bashrc" ;;
            */fish) SHELL_RC="$HOME/.config/fish/config.fish" ;;
        esac
        if [[ -n "$SHELL_RC" ]]; then
            PATH_LINE='export PATH="$HOME/.smartchats/bin:$PATH"'
            if [[ "$SHELL_RC" == *fish* ]]; then
                PATH_LINE='fish_add_path $HOME/.smartchats/bin'
            fi
            if ! grep -Fq "$PREFIX/bin" "$SHELL_RC" 2>/dev/null; then
                {
                    echo ''
                    echo '# Added by SmartChats installer'
                    echo "$PATH_LINE"
                } >> "$SHELL_RC"
                ok "Added $PREFIX/bin to PATH in $SHELL_RC"
                warn "Open a new terminal (or run: source $SHELL_RC) to use 'smartchats'."
            else
                info "$SHELL_RC already references $PREFIX/bin — skipping."
            fi
        else
            warn "Could not detect shell rc file. Add to your PATH manually:"
            warn "    export PATH=\"$PREFIX/bin:\$PATH\""
        fi
    fi
fi

# ─── Run setup unless told otherwise ──────────────────────────────────
echo '' >&2
ok "smartchats installed → $PREFIX"
echo '' >&2

if $NONINTERACTIVE; then
    info "Skipping interactive setup (--non-interactive)."
    info "Run \`smartchats setup\` to configure provider keys and start the stack."
    exit 0
fi

# `exec` so signals (Ctrl-C) flow naturally.
exec "$PREFIX/bin/smartchats" setup
