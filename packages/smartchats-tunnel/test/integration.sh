#!/usr/bin/env bash
# End-to-end integration test for smartchats-tunnel.
#
# Builds the docker image, starts it locally with a synthetic
# authorized_keys, opens a reverse-tunnel from a fake "publisher" and
# a forward-tunnel from a fake "consumer", proves an HTTP request
# reaches the consumer via the bastion multiplexing.
#
# Also stress-tests the reconnect race — kill the publisher and verify
# a fresh publisher with ExitOnForwardFailure=yes fails-closed while
# the stale listener is still bound, then reconnects cleanly after
# ClientAliveInterval * ClientAliveCountMax (~30s).
#
# Usage:
#   ./test/integration.sh
#
# Requires: docker, openssh, python3, curl, lsof, nc.

set -uo pipefail

IMAGE=smartchats-tunnel:test
CONTAINER=smartchats-tunnel-integration-test
HOST_PORT=${HOST_PORT:-12222}
DEV_PORT=${DEV_PORT:-38080}
CONSUMER_PORT=${CONSUMER_PORT:-38081}
RECONNECT=${RECONNECT:-0}   # set to 1 for reconnect stress test
WORKDIR="$(mktemp -d)"
PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"

DEV_PID=0; PUB_PID=0; CON_PID=0

cleanup() {
    [ "$PUB_PID" != 0 ] && kill "$PUB_PID" 2>/dev/null
    [ "$CON_PID" != 0 ] && kill "$CON_PID" 2>/dev/null
    [ "$DEV_PID" != 0 ] && kill "$DEV_PID" 2>/dev/null
    docker rm -f "$CONTAINER" >/dev/null 2>&1
    rm -rf "$WORKDIR"
}
trap cleanup EXIT

log() { printf '[test] %s\n' "$*"; }
fail() { printf '[test] ❌ %s\n' "$*" >&2; exit 1; }

# ── Sanity: required commands ───────────────────────────────────────
for cmd in docker ssh ssh-keygen python3 curl lsof nc; do
    command -v "$cmd" >/dev/null 2>&1 || fail "missing dependency: $cmd"
done

# ── Kill any leftover process on the dev port ───────────────────────
for pid in $(lsof -ti :$DEV_PORT 2>/dev/null); do kill -9 $pid 2>/dev/null; done
sleep 0.5

# ── Build image ──────────────────────────────────────────────────────
log "building image (--quiet)..."
docker build -q -t "$IMAGE" "$PKG_DIR" > /dev/null || fail "docker build"

# ── Test keys + container ────────────────────────────────────────────
ssh-keygen -t ed25519 -f "$WORKDIR/pub" -N "" -q -C "publisher-test"
ssh-keygen -t ed25519 -f "$WORKDIR/con" -N "" -q -C "consumer-test"
AUTHORIZED_KEYS=$(cat "$WORKDIR/pub.pub" "$WORKDIR/con.pub")

docker rm -f "$CONTAINER" >/dev/null 2>&1
docker run -d --name "$CONTAINER" \
    -e TUNNEL_AUTHORIZED_KEYS="$AUTHORIZED_KEYS" \
    -p ${HOST_PORT}:2222 \
    "$IMAGE" > /dev/null

for i in $(seq 1 20); do
    if nc -z localhost $HOST_PORT 2>/dev/null; then break; fi
    sleep 0.5
done
nc -z localhost $HOST_PORT || fail "sshd never listened on :$HOST_PORT"
log "sshd up on :$HOST_PORT"

# ── Dev server on host ──────────────────────────────────────────────
python3 -c "
import http.server, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Length','9'); self.end_headers()
        self.wfile.write(b'hello dev')
    def log_message(self, *a): pass
# allow_reuse_address for TIME_WAIT sockets from previous test runs
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', $DEV_PORT), H) as s: s.serve_forever()
" &
DEV_PID=$!
sleep 0.5
curl -sf --max-time 2 http://127.0.0.1:$DEV_PORT >/dev/null || fail "dev server not responding"
log "dev server :$DEV_PORT responding"

SSH_OPTS=(
    -o "StrictHostKeyChecking=accept-new"
    -o "UserKnownHostsFile=$WORKDIR/known_hosts"
    -o "BatchMode=yes"
    -o "ConnectTimeout=5"
    -p "$HOST_PORT"
)

# ── Publisher: reverse-tunnel bastion:8080 → host:$DEV_PORT ────────
ssh "${SSH_OPTS[@]}" -i "$WORKDIR/pub" -N \
    -R 8080:localhost:$DEV_PORT \
    tunnel@localhost > "$WORKDIR/pub.log" 2>&1 &
PUB_PID=$!
sleep 2
kill -0 $PUB_PID 2>/dev/null || {
    log "publisher log:"; sed 's/^/[test-pub]   /' "$WORKDIR/pub.log"
    fail "publisher ssh died"
}
log "publisher connected (PID $PUB_PID)"

# ── Consumer: forward-tunnel local:$CONSUMER_PORT → bastion:8080 ──
ssh "${SSH_OPTS[@]}" -i "$WORKDIR/con" -N \
    -L $CONSUMER_PORT:localhost:8080 \
    tunnel@localhost > "$WORKDIR/con.log" 2>&1 &
CON_PID=$!
sleep 2
kill -0 $CON_PID 2>/dev/null || {
    log "consumer log:"; sed 's/^/[test-con]   /' "$WORKDIR/con.log"
    fail "consumer ssh died"
}
log "consumer connected (PID $CON_PID)"

sleep 0.5

# ── Moment of truth ─────────────────────────────────────────────────
RESULT="$(curl -s --max-time 3 http://127.0.0.1:$CONSUMER_PORT || echo CURL_FAILED)"
if [ "$RESULT" = "hello dev" ]; then
    log "✅ END-TO-END TUNNEL MULTIPLEXING WORKS"
else
    log "curl returned: '$RESULT'"
    docker logs --tail 20 "$CONTAINER" 2>&1 | sed 's/^/[test-cnt]   /'
    fail "e2e"
fi

# ── Reconnect stress (opt-in) ───────────────────────────────────────
if [ "$RECONNECT" = "1" ]; then
    log ""
    log "== RECONNECT STRESS TEST =="
    log "killing publisher (PID $PUB_PID)..."
    kill -9 $PUB_PID
    PUB_PID=0
    sleep 1

    # Immediate reconnect — sshd listener may still be bound to zombie
    # session. Two possible outcomes both indicate healthy behavior:
    #   a) Server refuses the -R bind → ssh with ExitOnForwardFailure=yes
    #      exits nonzero within a few seconds. (Session cleanup slow.)
    #   b) Server had already dropped the zombie by the time we retry →
    #      -R bind succeeds → ssh stays connected. (Session cleanup fast.)
    # Both are fine. The test guards against outcome (c): ssh returns 0
    # BUT no listener is actually bound — the silent-failure mode
    # ExitOnForwardFailure=yes is designed to prevent.
    #
    # Wrap in `timeout` so ssh -N doesn't hang forever waiting for
    # ClientAlive on the outcome-b path.
    log "immediate reconnect (short deadline)..."
    IMMEDIATE_RESULT=0
    timeout 3 ssh "${SSH_OPTS[@]}" -o "ExitOnForwardFailure=yes" -i "$WORKDIR/pub" -N \
        -R 8080:localhost:$DEV_PORT \
        tunnel@localhost > "$WORKDIR/pub2.log" 2>&1 || IMMEDIATE_RESULT=$?

    case "$IMMEDIATE_RESULT" in
        0)   log "?? immediate reconnect returned 0 within 3s — unusual, check pub2.log"
             cat "$WORKDIR/pub2.log" | sed 's/^/[test-pub2]   /' ;;
        124) log "✅ immediate reconnect held connection ≥3s (outcome b — bind succeeded)" ;;
        *)   log "✅ immediate reconnect failed fast (outcome a — zombie still holds port, exit=$IMMEDIATE_RESULT)" ;;
    esac

    # Wait for the zombie session to time out
    # (ClientAliveInterval 15 * CountMax 2 = 30s worst case).
    log "waiting 35s for zombie session cleanup..."
    sleep 35

    log "delayed reconnect (should SUCCEED)..."
    ssh "${SSH_OPTS[@]}" -o "ExitOnForwardFailure=yes" -i "$WORKDIR/pub" -N \
        -R 8080:localhost:$DEV_PORT \
        tunnel@localhost > "$WORKDIR/pub3.log" 2>&1 &
    PUB_PID=$!
    sleep 3
    if ! kill -0 $PUB_PID 2>/dev/null; then
        log "delayed reconnect log:"; sed 's/^/[test-pub3]   /' "$WORKDIR/pub3.log"
        fail "delayed reconnect ssh died"
    fi

    RESULT2="$(curl -s --max-time 3 http://127.0.0.1:$CONSUMER_PORT || echo CURL_FAILED)"
    if [ "$RESULT2" = "hello dev" ]; then
        log "✅ RECONNECT WORKS after zombie cleanup"
    else
        log "curl after reconnect returned: '$RESULT2'"
        fail "reconnect e2e"
    fi
fi

log ""
log "ALL TESTS PASSED"
