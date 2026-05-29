#!/usr/bin/env bash
# Build a per-platform smartchats release tarball.
#
# Usage:
#   scripts/build-release.sh                        # current platform
#   scripts/build-release.sh --target darwin-arm64  # cross-build
#   scripts/build-release.sh --target linux-x64
#
# Output: dist-release/smartchats-${TARGET}.tar.gz
#
# Tarball layout (matches what install.sh expects):
#   bin/smartchats         bun-compiled CLI (smartchats-cli)
#   bin/smartchats-server  bun-compiled Express server (smartchats-local-server)
#   bin/surreal            native SurrealDB binary for $TARGET
#   app/out/               static SPA bundle (Next.js export)
#   install-manifest.json  version + checksums + platform tag

set -euo pipefail
source "$(dirname "$0")/../bin/_lib.sh"

# ─── Args ─────────────────────────────────────────────────────────────
TARGET=""
SURREAL_VERSION="v3.1.2"
SKIP_BUILD=false
KEEP_DIST=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)         TARGET="$2"; shift 2 ;;
        --surreal)        SURREAL_VERSION="$2"; shift 2 ;;
        --skip-build)     SKIP_BUILD=true; shift ;;
        --keep-dist)      KEEP_DIST=true; shift ;;
        --help|-h)
            sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *) err "Unknown option: $1"; exit 1 ;;
    esac
done

# Default target = current platform.
if [[ -z "$TARGET" ]]; then
    case "$(uname -s)" in
        Darwin)  HOST_OS="darwin" ;;
        Linux)   HOST_OS="linux"  ;;
        *) err "Unsupported host OS: $(uname -s)"; exit 1 ;;
    esac
    case "$(uname -m)" in
        arm64|aarch64) HOST_ARCH="arm64" ;;
        x86_64|amd64)  HOST_ARCH="x64"   ;;
        *) err "Unsupported host arch: $(uname -m)"; exit 1 ;;
    esac
    TARGET="${HOST_OS}-${HOST_ARCH}"
fi

# Validate target.
case "$TARGET" in
    darwin-arm64|darwin-x64|linux-x64|linux-arm64) ;;
    *) err "Unsupported target: $TARGET. Choose: darwin-arm64 darwin-x64 linux-x64 linux-arm64"; exit 1 ;;
esac

# Map to bun's --target naming.
BUN_TARGET="bun-${TARGET}"

# Map to SurrealDB's release filename + URL.
case "$TARGET" in
    darwin-arm64) SURREAL_ASSET="surreal-${SURREAL_VERSION}.darwin-arm64.tgz" ;;
    darwin-x64)   SURREAL_ASSET="surreal-${SURREAL_VERSION}.darwin-amd64.tgz" ;;
    linux-x64)    SURREAL_ASSET="surreal-${SURREAL_VERSION}.linux-amd64.tgz" ;;
    linux-arm64)  SURREAL_ASSET="surreal-${SURREAL_VERSION}.linux-arm64.tgz" ;;
esac
SURREAL_URL="https://github.com/surrealdb/surrealdb/releases/download/${SURREAL_VERSION}/${SURREAL_ASSET}"

cd "$REPO_ROOT"
header "Building release: ${TARGET}"

# ─── Preflight ────────────────────────────────────────────────────────
check_command bun || exit 1
check_command tar || exit 1
check_command curl || exit 1

DIST="$REPO_ROOT/dist-release/$TARGET"
rm -rf "$DIST"
mkdir -p "$DIST/bin" "$DIST/app"

# ─── 1. Workspace build (turbo) ───────────────────────────────────────
if ! $SKIP_BUILD; then
    info "Running turbo build (workspace deps + static SPA)..."
    PATH="$HOME/.bun/bin:$PATH" bun run build
    ok "Workspace built"
else
    info "Skipping turbo build (--skip-build)"
fi

# ─── 2. Compile CLI + server (bun build --compile) ────────────────────
info "Compiling smartchats (CLI) for ${BUN_TARGET}..."
bun build --compile \
    --target="$BUN_TARGET" \
    packages/smartchats-cli/src/cli.ts \
    --outfile "$DIST/bin/smartchats"
ok "CLI: $(du -h "$DIST/bin/smartchats" | cut -f1)"

info "Compiling smartchats-server for ${BUN_TARGET}..."
bun build --compile \
    --target="$BUN_TARGET" \
    packages/smartchats-local-server/src/cli.ts \
    --outfile "$DIST/bin/smartchats-server"
ok "Server: $(du -h "$DIST/bin/smartchats-server" | cut -f1)"

# ─── 3. SurrealDB binary ──────────────────────────────────────────────
info "Fetching SurrealDB ${SURREAL_VERSION} for ${TARGET}..."
TMP_SURREAL="$(mktemp -d)"
trap 'rm -rf "$TMP_SURREAL"' EXIT
curl -fsSL "$SURREAL_URL" -o "$TMP_SURREAL/surreal.tgz"
tar -xzf "$TMP_SURREAL/surreal.tgz" -C "$TMP_SURREAL"
cp "$TMP_SURREAL/surreal" "$DIST/bin/surreal"
chmod +x "$DIST/bin/surreal"
ok "SurrealDB: $(du -h "$DIST/bin/surreal" | cut -f1)"

# ─── 4. Static SPA ────────────────────────────────────────────────────
if [[ ! -d "apps/smartchats/out" ]]; then
    err "apps/smartchats/out is missing — run turbo build first (or drop --skip-build)."
    exit 1
fi
info "Copying static SPA bundle..."
cp -R apps/smartchats/out "$DIST/app/out"
ok "SPA: $(du -sh "$DIST/app/out" | cut -f1)"

# ─── 5. Manifest ──────────────────────────────────────────────────────
# Pull version from the CLI package.json — that's the user-facing release tag.
CLI_VERSION="$(node -p "require('./packages/smartchats-cli/package.json').version" 2>/dev/null || echo "0.0.0")"
cat > "$DIST/install-manifest.json" <<EOF
{
  "version": "$CLI_VERSION",
  "target": "$TARGET",
  "surreal_version": "$SURREAL_VERSION",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# ─── 6. Tar it up ─────────────────────────────────────────────────────
TARBALL="$REPO_ROOT/dist-release/smartchats-${TARGET}.tar.gz"
info "Creating tarball ${TARBALL}..."
(cd "$DIST" && tar -czf "$TARBALL" .)
ok "Tarball: $(du -h "$TARBALL" | cut -f1)"

if ! $KEEP_DIST; then
    rm -rf "$DIST"
fi

echo
ok "Release ready: $TARBALL"
echo "  → Test locally: tar -xzf $TARBALL -C /tmp/sc-test && /tmp/sc-test/bin/smartchats --version"
echo "  → Upload to GitHub Releases as the smartchats-${TARGET}.tar.gz asset"
