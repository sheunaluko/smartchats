#!/usr/bin/env bash
# Supervisor for the smartchats AIO container.
#
# Starts surreal → smartchats-server → smartchats-app, in dependency order,
# each waiting on the previous to be reachable. If any process exits, kills
# the rest so docker's restart policy can take over with a clean slate.

set -uo pipefail

# ── Configuration ─────────────────────────────────────────────────────
DATA_DIR=${DATA_DIR:-/data}
SURREAL_INTERNAL_PORT=${SURREAL_INTERNAL_PORT:-8000}
SERVER_INTERNAL_PORT=${SMARTCHATS_PORT:-4242}
APP_PORT=${PORT:-3000}

mkdir -p "$DATA_DIR"

# Compose-internal-only DB creds. The DB binds to container loopback;
# defense-in-depth comes from network isolation, not these credentials.
SURREAL_USER=${SURREAL_USER:-root}
SURREAL_PASSWORD=${SURREAL_PASSWORD:-root}
SURREAL_NS=${SURREAL_NS:-smartchats}
SURREAL_DB=${SURREAL_DB:-main}

# Pass-through to smartchats-server.
export SURREAL_URL="ws://127.0.0.1:${SURREAL_INTERNAL_PORT}/rpc"
export SURREAL_NS SURREAL_DB SURREAL_USER SURREAL_PASSWORD
export SMARTCHATS_HOST=127.0.0.1
export SMARTCHATS_PORT=${SERVER_INTERNAL_PORT}

# Pass-through to Next.js for the same-origin proxy.
export SMARTCHATS_INTERNAL_PROXY=1
export SMARTCHATS_INTERNAL_LOCAL_URL="http://127.0.0.1:${SERVER_INTERNAL_PORT}"

# ── Process supervision ───────────────────────────────────────────────
PIDS=()

cleanup() {
    echo "[aio] shutting down..."
    for pid in "${PIDS[@]+"${PIDS[@]}"}"; do
        kill -TERM "$pid" 2>/dev/null || true
    done
    sleep 1
    for pid in "${PIDS[@]+"${PIDS[@]}"}"; do
        kill -KILL "$pid" 2>/dev/null || true
    done
}
trap cleanup INT TERM EXIT

# ── 1. SurrealDB ──────────────────────────────────────────────────────
# Bind to 0.0.0.0 inside the container so docker port-forward (which
# `bin/aio` exposes on host loopback only via `127.0.0.1:${SURREAL_PORT}:8000`)
# can reach the socket. Without this, internal-only 127.0.0.1 binding
# blocks the docker forward — host tools (`bin/save_session_v3`, MCP
# exporters, ad-hoc CLI) couldn't talk to SurrealDB. The smartchats-server
# inside the container still talks to localhost:8000, which 0.0.0.0 also
# accepts. External exposure is gated at the docker layer, not here.
echo "[aio] starting SurrealDB on 0.0.0.0:${SURREAL_INTERNAL_PORT}"
/usr/local/bin/surreal start \
    --user "$SURREAL_USER" \
    --pass "$SURREAL_PASSWORD" \
    --bind "0.0.0.0:${SURREAL_INTERNAL_PORT}" \
    "rocksdb:${DATA_DIR}/surreal.db" &
PIDS+=($!)

# Wait for surreal to be ready (max 30s).
for _ in {1..30}; do
    if /usr/local/bin/surreal is-ready \
        --endpoint "http://127.0.0.1:${SURREAL_INTERNAL_PORT}" 2>/dev/null; then
        echo "[aio] SurrealDB ready"
        break
    fi
    sleep 1
done

# ── 2. smartchats-server (Express) ────────────────────────────────────
echo "[aio] starting smartchats-server on 127.0.0.1:${SERVER_INTERNAL_PORT}"
cd /app/packages/smartchats-local-server
node dist/cli.js &
PIDS+=($!)

for _ in {1..30}; do
    if curl -sf "http://127.0.0.1:${SERVER_INTERNAL_PORT}/health" >/dev/null 2>&1; then
        echo "[aio] smartchats-server ready"
        break
    fi
    sleep 1
done

# ── 3. smartchats-app (Next.js) ───────────────────────────────────────
echo "[aio] starting smartchats-app on 0.0.0.0:${APP_PORT}"
cd /app/apps/smartchats
HOSTNAME=0.0.0.0 PORT=${APP_PORT} npx next start &
PIDS+=($!)

echo "[aio] open http://localhost:${APP_PORT}"

# Wait for any process to exit. The trap fires on EXIT and tears down the rest.
wait -n
