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
#   scripts/test-install.sh                          # docker backend (default)
#   scripts/test-install.sh --backend docker         # container, fast iteration
#   scripts/test-install.sh --backend multipass      # real Linux VM
#   scripts/test-install.sh --backend tart           # macOS guest (prints manual recipe)
#   scripts/test-install.sh --target linux-x64       # cross-compile target
#   scripts/test-install.sh --keep-running           # leave the container/VM up
#   scripts/test-install.sh --skip-build             # reuse a prior dist-release/ tarball
#
# Backend-target matrix:
#   docker    → linux-x64, linux-arm64   (container, Docker Desktop)
#   multipass → linux-x64, linux-arm64   (real Linux VM via Apple Hypervisor)
#   tart      → darwin-arm64, darwin-x64 (macOS guest — manual recipe printed for now)

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
    docker|multipass|tart) ;;
    *) err "Unknown backend: $BACKEND (choose: docker, multipass, tart)"; exit 1 ;;
esac

# Detect current target if not specified. Backend-aware:
#   docker / multipass → Linux guests, so target is linux-{arch}
#   tart               → macOS guests, so target is darwin-{arch}
if [[ -z "$TARGET" ]]; then
    case "$BACKEND-$(uname -s)-$(uname -m)" in
        docker-Darwin-arm64|docker-Darwin-aarch64)       TARGET="linux-arm64" ;;
        docker-Darwin-x86_64)                            TARGET="linux-x64" ;;
        docker-Linux-x86_64|docker-Linux-amd64)          TARGET="linux-x64" ;;
        docker-Linux-aarch64|docker-Linux-arm64)         TARGET="linux-arm64" ;;
        multipass-Darwin-arm64|multipass-Darwin-aarch64) TARGET="linux-arm64" ;;
        multipass-Darwin-x86_64)                         TARGET="linux-x64" ;;
        multipass-Linux-x86_64|multipass-Linux-amd64)    TARGET="linux-x64" ;;
        multipass-Linux-aarch64|multipass-Linux-arm64)   TARGET="linux-arm64" ;;
        tart-Darwin-arm64|tart-Darwin-aarch64)           TARGET="darwin-arm64" ;;
        tart-Darwin-x86_64)                              TARGET="darwin-x64" ;;
        *) err "Could not infer target — specify --target"; exit 1 ;;
    esac
fi

# Backend-target compatibility.
case "$BACKEND-$TARGET" in
    docker-linux-*|multipass-linux-*) ;;
    tart-darwin-*)
        warn "Tart backend isn't fully wired yet — printing manual recipe and exiting."
        cat <<EOF >&2

  # ─── Manual Tart recipe (until --backend tart is automated) ───────
  brew install cirruslabs/cli/tart
  tart clone ghcr.io/cirruslabs/macos-sonoma-base:latest sc-install-test
  tart run sc-install-test --no-graphics &
  sleep 30   # wait for VM to boot
  SC_VM_IP=\$(tart ip sc-install-test)
  scp scripts/install.sh admin@\$SC_VM_IP:/tmp/install.sh
  scp dist-release/smartchats-${TARGET}.tar.gz admin@\$SC_VM_IP:/tmp/smartchats.tar.gz
  ssh admin@\$SC_VM_IP "SMARTCHATS_TARBALL_URL=file:///tmp/smartchats.tar.gz \\
    bash /tmp/install.sh --non-interactive"
  ssh admin@\$SC_VM_IP "~/.smartchats/bin/smartchats start"
  ssh admin@\$SC_VM_IP "curl -sf http://localhost:3000/local-api/health"
  # When done:
  tart stop sc-install-test && tart delete sc-install-test
EOF
        exit 1
        ;;
    docker-darwin-*|multipass-darwin-*)
        err "$BACKEND backend can only test Linux targets (the guest VM is Linux)."
        exit 1
        ;;
    *)
        err "Unsupported backend-target combo: $BACKEND on $TARGET"
        exit 1
        ;;
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

# ─── Multipass backend ────────────────────────────────────────────────
# Linux VM via Canonical's Multipass. Real kernel, not a container.
# Apple Silicon hosts → arm64 guest by default; Intel hosts → x64 guest.
if [[ "$BACKEND" == "multipass" ]]; then
    check_command multipass || { err "Install: brew install --cask multipass"; exit 1; }

    VM_NAME="sc-install-test-$$"

    mp_cleanup() {
        if ! $KEEP_RUNNING; then
            info "Deleting VM $VM_NAME..."
            multipass delete "$VM_NAME" --purge 2>/dev/null || true
        fi
    }
    trap mp_cleanup EXIT INT TERM

    header "Launching Multipass VM: $VM_NAME (Ubuntu 22.04, 2 cpus, 4G ram, 10G disk)"
    multipass launch 22.04 --name "$VM_NAME" --cpus 2 --memory 4G --disk 10G
    ok "VM launched"

    header "Transferring install.sh + tarball into VM"
    multipass transfer scripts/install.sh "${VM_NAME}:/tmp/install.sh"
    multipass transfer "$TARBALL" "${VM_NAME}:/tmp/smartchats.tar.gz"

    header "Running install.sh inside VM (file:// tarball, --non-interactive)"
    multipass exec "$VM_NAME" -- bash -c "
        export SMARTCHATS_TARBALL_URL=file:///tmp/smartchats.tar.gz
        bash /tmp/install.sh --non-interactive --no-path
    "

    header "Starting the stack inside VM"
    # Run detached: smartchats start writes its own PID file + logs.
    multipass exec "$VM_NAME" -- bash -c "
        /home/ubuntu/.smartchats/bin/smartchats start --no-prompt
    "

    header "Waiting for /local-api/health (up to 60s)"
    ready=false
    for i in {1..60}; do
        if multipass exec "$VM_NAME" -- curl -sf "http://localhost:3000/local-api/health" -o /dev/null 2>&1; then
            ready=true
            break
        fi
        sleep 1
    done

    if ! $ready; then
        err "Stack didn't respond inside VM within 60s"
        echo "  ── ~/.smartchats/logs/server.log (last 60 lines) ───"
        multipass exec "$VM_NAME" -- tail -n 60 /home/ubuntu/.smartchats/logs/server.log 2>&1 | sed 's/^/    /' || true
        echo "  ── ~/.smartchats/logs/surreal.log (last 30 lines) ───"
        multipass exec "$VM_NAME" -- tail -n 30 /home/ubuntu/.smartchats/logs/surreal.log 2>&1 | sed 's/^/    /' || true
        exit 1
    fi

    ok "Stack up inside VM"
    info "  /local-api/health → $(multipass exec "$VM_NAME" -- curl -sf "http://localhost:3000/local-api/health" 2>&1 | head -c 200)"

    echo
    header "smartchats start output (from VM)"
    multipass exec "$VM_NAME" -- tail -n 40 /home/ubuntu/.smartchats/logs/server.log 2>&1 | sed 's/^/    /' || true

    if $KEEP_RUNNING; then
        VM_IP="$(multipass info "$VM_NAME" --format json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['info']['$VM_NAME']['ipv4'][0])" 2>/dev/null || echo 'unknown')"
        echo
        ok "VM left running: $VM_NAME (IP: $VM_IP)"
        info "  Shell in:        multipass shell $VM_NAME"
        info "  From host (HTTP):curl http://${VM_IP}:3000/local-api/health"
        info "  Tear down:       multipass delete $VM_NAME --purge"
        trap - EXIT INT TERM
    fi

    echo
    ok "Install + Multipass end-to-end test passed."
    exit 0
fi

# ─── 2. Prep server root + start HTTP server (Docker only past here) ──
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
