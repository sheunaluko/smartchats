#!/usr/bin/env bash
# End-to-end install + AIO smoke test against locally-built artifacts.
#
# Validates the full release pipeline without pushing tags or releases:
#
#   1. Builds smartchats-${TARGET}.tar.gz via scripts/build-release.sh.
#   2. Starts a local HTTP server serving install.sh + the tarball.
#   3. Builds the AIO Docker image with --build-arg pointing at the local
#      server, so the same Dockerfile + same install.sh exercises the
#      locally-built artifacts. Image build = install regression test.
#   4. Runs the AIO image with the host's .env injected.
#   5. Curls localhost:3000 + /local-api/health to validate the stack
#      came up under the install.sh code path.
#   6. Tears down: stop container, kill HTTP server, cleanup.
#
# Usage:
#   scripts/test-install.sh                      # docker backend (default)
#   scripts/test-install.sh --backend docker
#   scripts/test-install.sh --target linux-x64   # any platform bun can cross-compile
#   scripts/test-install.sh --keep-running       # don't stop the container at the end
#   scripts/test-install.sh --skip-build         # reuse a prior dist-release/ tarball
#
# Multipass / Tart backends (manual for now; same shape, different driver):
#   multipass launch 22.04 --name sc-test
#   multipass mount $PWD/dist-release sc-test:/release
#   multipass exec sc-test -- bash -c '
#     SMARTCHATS_INSTALL_URL=file:///release/install.sh \
#     SMARTCHATS_TARBALL_URL=file:///release/smartchats-linux-arm64.tar.gz \
#     bash /release/install.sh --non-interactive
#   '
#   multipass exec sc-test -- smartchats setup --no-prompt --no-start
#   multipass exec sc-test -- smartchats start
#   multipass exec sc-test -- curl -fsSL http://localhost:3000/local-api/health
#   multipass delete sc-test --purge

set -euo pipefail
source "$(dirname "$0")/../bin/_lib.sh"
if [[ -d "$HOME/.bun/bin" ]]; then export PATH="$HOME/.bun/bin:$PATH"; fi

# ─── Defaults ─────────────────────────────────────────────────────────
BACKEND="docker"
TARGET=""
SKIP_BUILD=false
KEEP_RUNNING=false
SERVER_PORT=18234
IMAGE_TAG="smartchats-aio-test:local"
CONTAINER_NAME="smartchats-aio-test"
HOST_PORT=3000

while [[ $# -gt 0 ]]; do
    case "$1" in
        --backend)       BACKEND="$2"; shift 2 ;;
        --target)        TARGET="$2"; shift 2 ;;
        --skip-build)    SKIP_BUILD=true; shift ;;
        --keep-running)  KEEP_RUNNING=true; shift ;;
        --port)          HOST_PORT="$2"; shift 2 ;;
        --help|-h)
            sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *) err "Unknown option: $1"; exit 1 ;;
    esac
done

case "$BACKEND" in
    docker) ;;
    multipass|tart)
        err "$BACKEND backend not yet wired into this script — see header for manual recipe."
        exit 1
        ;;
    *) err "Unknown backend: $BACKEND"; exit 1 ;;
esac

# Detect current target if not specified. The Docker image RUNS the
# target's binaries, so it must match the docker engine's platform.
if [[ -z "$TARGET" ]]; then
    case "$(uname -s)-$(uname -m)" in
        Darwin-arm64|Darwin-aarch64) TARGET="linux-arm64" ;;  # Docker Desktop on Apple Silicon → Linux/arm64
        Darwin-x86_64)               TARGET="linux-x64" ;;
        Linux-x86_64|Linux-amd64)    TARGET="linux-x64" ;;
        Linux-aarch64|Linux-arm64)   TARGET="linux-arm64" ;;
        *) err "Could not infer target — specify --target"; exit 1 ;;
    esac
fi

case "$TARGET" in
    linux-x64|linux-arm64) ;;
    *) err "Docker backend only supports linux-x64 + linux-arm64 targets (Docker engine is Linux)."; exit 1 ;;
esac

cd "$REPO_ROOT"

# ─── Preflight ────────────────────────────────────────────────────────
header "Preflight ($BACKEND backend, target $TARGET)"
check_command docker || exit 1
check_command python3 || check_command python || { err "Need python3 or python for the local HTTP server."; exit 1; }
PYTHON="$(command -v python3 || command -v python)"

# ─── 1. Build tarball ─────────────────────────────────────────────────
if $SKIP_BUILD && [[ -f "dist-release/smartchats-${TARGET}.tar.gz" ]]; then
    info "Skipping tarball build (--skip-build), using existing artifact"
else
    info "Building tarball for $TARGET..."
    scripts/build-release.sh --target "$TARGET"
fi
TARBALL="$REPO_ROOT/dist-release/smartchats-${TARGET}.tar.gz"
[[ -f "$TARBALL" ]] || { err "Tarball missing: $TARBALL"; exit 1; }

# ─── 2. Prep server root + start HTTP server ──────────────────────────
SERVER_ROOT="$(mktemp -d)"
trap 'cleanup' EXIT INT TERM

# Mirror the GitHub Releases URL structure so install.sh's URL construction
# is exercised exactly as in production. We also expose the tarball at a
# direct path for SMARTCHATS_TARBALL_URL override.
cp scripts/install.sh "$SERVER_ROOT/install"
mkdir -p "$SERVER_ROOT/latest/download"
cp "$TARBALL" "$SERVER_ROOT/latest/download/smartchats-${TARGET}.tar.gz"

cleanup() {
    if [[ -n "${HTTP_PID:-}" ]]; then
        kill "$HTTP_PID" 2>/dev/null || true
    fi
    if ! $KEEP_RUNNING; then
        docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    fi
    rm -rf "$SERVER_ROOT"
}

info "Starting HTTP server on :$SERVER_PORT serving $SERVER_ROOT"
# `exec` replaces the subshell with python, so $! = python's PID directly
# (rather than the subshell's, which kill might not propagate through).
(cd "$SERVER_ROOT" && exec "$PYTHON" -m http.server "$SERVER_PORT" >/dev/null 2>&1) &
HTTP_PID=$!
# Wait briefly for the server to start serving.
for _ in {1..10}; do
    if curl -sf "http://127.0.0.1:${SERVER_PORT}/install" -o /dev/null; then break; fi
    sleep 0.3
done
curl -sf "http://127.0.0.1:${SERVER_PORT}/install" -o /dev/null \
    || { err "HTTP server did not come up"; exit 1; }
ok "HTTP server ready (pid $HTTP_PID)"

# ─── 3. Build AIO image with local URLs ───────────────────────────────
# Inside the Docker build, host.docker.internal points at the host. On
# Linux engines this needs --add-host=host.docker.internal:host-gateway
# (no-op on Docker Desktop for Mac, which already provides it).
INSTALL_URL="http://host.docker.internal:${SERVER_PORT}/install"
TARBALL_URL="http://host.docker.internal:${SERVER_PORT}/latest/download/smartchats-${TARGET}.tar.gz"

# Docker buildx automatically detects the local engine arch. We tag the
# image with the target so multiple builds don't collide.
TAG="${IMAGE_TAG}-${TARGET}"

header "Building AIO image $TAG"
info "  SMARTCHATS_INSTALL_URL  = $INSTALL_URL"
info "  SMARTCHATS_TARBALL_URL  = $TARBALL_URL"

# Docker caches the `RUN curl | bash` layer based on the literal text of
# the command + the build args. Build args stay the same across runs (URLs
# don't change), so we inject a combined-content hash as a cache-bust arg
# → the install layer invalidates whenever EITHER the tarball OR
# scripts/install.sh changes. (Initial version hashed only the tarball,
# which missed install.sh-only edits like banner / flag changes.)
SHA_CMD="sha256sum"
command -v sha256sum >/dev/null 2>&1 || SHA_CMD="shasum -a 256"
CONTENT_HASH="$(cat "$TARBALL" scripts/install.sh | $SHA_CMD | cut -c1-16)"
info "  SMARTCHATS_CACHE_BUST   = $CONTENT_HASH  (tarball + install.sh)"

docker build \
    --add-host=host.docker.internal:host-gateway \
    --build-arg SMARTCHATS_INSTALL_URL="$INSTALL_URL" \
    --build-arg SMARTCHATS_INSTALL_BASE="http://host.docker.internal:${SERVER_PORT}" \
    --build-arg SMARTCHATS_VERSION="latest" \
    --build-arg SMARTCHATS_CACHE_BUST="$CONTENT_HASH" \
    -f Dockerfile.aio \
    -t "$TAG" \
    .

ok "Image built: $TAG"

# ─── 4. Run AIO container ─────────────────────────────────────────────
header "Running container $CONTAINER_NAME on :$HOST_PORT"

# Preflight: if anything is already bound to HOST_PORT, docker's port
# mapping fails silently on macOS (vpnkit can't bind, container starts
# anyway, our curl hits the squatter instead of the container). Better
# to bail clearly here than discover it via a 60-second timeout below.
if PORT_HOLDER="$(lsof -nP -iTCP:"${HOST_PORT}" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 { print $1 " (pid " $2 ")" }')"; then
    if [[ -n "$PORT_HOLDER" ]]; then
        err "Port ${HOST_PORT} is already in use by: ${PORT_HOLDER}"
        err "Free it (e.g. \`kill <pid>\`), or re-run with: --port <other>"
        exit 1
    fi
fi

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

# Pass provider keys through if a host .env exists. Otherwise the stack
# starts but the agent can't answer.
ENV_FILE_ARGS=()
if [[ -f "$REPO_ROOT/.env" ]]; then
    ENV_FILE_ARGS=(--env-file "$REPO_ROOT/.env")
    info "Mounting host .env"
else
    warn "No $REPO_ROOT/.env found — stack will start but the agent has no keys."
fi

docker run -d \
    --name "$CONTAINER_NAME" \
    -p "${HOST_PORT}:3000" \
    -v "${HOME}/.smartchats/aio-test-data:/data" \
    --add-host=host.docker.internal:host-gateway \
    "${ENV_FILE_ARGS[@]}" \
    "$TAG" >/dev/null

ok "Container started"

# ─── 5. Validate ──────────────────────────────────────────────────────
header "Waiting for stack to come up on :$HOST_PORT (up to 60s)..."
ready=false
for i in {1..60}; do
    if curl -sf "http://localhost:${HOST_PORT}/local-api/health" -o /dev/null; then
        ready=true
        break
    fi
    sleep 1
done

if ! $ready; then
    err "Stack did not respond on :$HOST_PORT within 60s."
    echo
    echo "  ── docker logs --tail 80 $CONTAINER_NAME ─────────────────────────"
    docker logs --tail 80 "$CONTAINER_NAME" 2>&1 | sed 's/^/    /'
    # smartchats start redirects child stdio to log files inside the container.
    # Grab them before cleanup. `docker cp` works on stopped containers (which
    # is what we have here — the entrypoint died when the server failed).
    TMP_LOGS="$(mktemp -d)"
    for proc in server surreal; do
        echo
        echo "  ── /root/.smartchats/logs/${proc}.log (last 60 lines) ─────────────"
        if docker cp "$CONTAINER_NAME:/root/.smartchats/logs/${proc}.log" "$TMP_LOGS/${proc}.log" 2>/dev/null; then
            tail -n 60 "$TMP_LOGS/${proc}.log" 2>&1 | sed 's/^/    /'
        else
            echo "    (log file not present — process never started or container layout differs)"
        fi
    done
    rm -rf "$TMP_LOGS"
    # Also leave the container alive for inspection if --keep-running was set.
    if $KEEP_RUNNING; then
        echo
        warn "Container left running for inspection (--keep-running). Stop with:"
        warn "  docker rm -f $CONTAINER_NAME"
        trap - EXIT INT TERM
        if [[ -n "${HTTP_PID:-}" ]]; then kill "$HTTP_PID" 2>/dev/null || true; fi
        rm -rf "$SERVER_ROOT"
    fi
    exit 1
fi

ok "Stack is up: http://localhost:${HOST_PORT}"
info "  /local-api/health → $(curl -sf "http://localhost:${HOST_PORT}/local-api/health" | head -c 200)"
info "  /                  → HTTP $(curl -sf -o /dev/null -w '%{http_code}' "http://localhost:${HOST_PORT}/")"

echo
header "Container startup output (docker logs)"
# Brief wait for smartchats start to finish its post-ready output —
# /local-api/health responds 200 the instant the server binds, but the
# CLI then probes /health, conditionally prints the NO-KEYS warning box,
# writes the PID file, and only then prints the final 'Stack up' line.
# Without this sleep, docker logs catches the stream mid-way and misses
# the box.
sleep 1.5
docker logs "$CONTAINER_NAME" 2>&1 | sed 's/^/    /'

if $KEEP_RUNNING; then
    echo
    ok "Container left running. Open: http://localhost:${HOST_PORT}"
    info "Stop with: docker rm -f $CONTAINER_NAME"
    # Don't clean up.
    trap - EXIT INT TERM
    if [[ -n "${HTTP_PID:-}" ]]; then kill "$HTTP_PID" 2>/dev/null || true; fi
    rm -rf "$SERVER_ROOT"
fi

echo
ok "Install + AIO end-to-end test passed."
