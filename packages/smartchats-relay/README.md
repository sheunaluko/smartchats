# smartchats-relay

WebSocket relay between cloud-mode `bin/pty-bridge.mjs` instances (running on user machines) and smartchats browser clients (running anywhere).

Single Node process, in-memory routing table, Firebase Auth for identity. Deployable to Fly.io / Render / any platform that supports long-lived WebSockets.

## Endpoints

| Endpoint | Who connects | Purpose |
|---|---|---|
| `GET /healthz` | Load balancer probe | `{ ok, bridges, clients, uptime_s }` |
| `WS /bridge` | `pty-bridge.mjs --cloud` | Outbound from user machine; forwards PTY output, receives input |
| `WS /client` | Browser CLI Terminal widget | Lists sessions for the logged-in user, subscribes to one, exchanges input/output |

## Protocol

Both endpoints expect a `*_hello` message containing a Firebase ID token as the first WS frame. Connection is killed after `HELLO_TIMEOUT_MS` if no valid hello arrives.

See `src/ws/bridge.ts` and `src/ws/client.ts` for the full message catalog.

## Environment

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP/WS bind port |
| `NODE_ENV` | `development` | `production` enables strict checks |
| `LOG_LEVEL` | `info` | pino level |
| `FIREBASE_PROJECT_ID` | — | Required in production |
| `FIREBASE_CREDENTIALS` | — | Base64-encoded service account JSON (optional; uses ADC if absent) |
| `DEV_TOKEN_BYPASS` | `false` | Accept any token in dev — refuses to set in `production` |
| `MAX_BRIDGES_PER_USER` | `10` | Soft cap |
| `MAX_CLIENTS_PER_USER` | `20` | Soft cap |
| `PING_INTERVAL_MS` | `30000` | WS ping cadence |
| `PING_TIMEOUT_MS` | `60000` | Drop socket if no pong within window |
| `HELLO_TIMEOUT_MS` | `5000` | Time allowed for `*_hello` after WS open |

## Dev

```bash
DEV_TOKEN_BYPASS=true npm run dev
```

In another terminal, run the test suite against an isolated server:

```bash
npm test
```

## Deploy

```bash
fly launch       # first time only
fly secrets set FIREBASE_PROJECT_ID=... FIREBASE_CREDENTIALS=$(base64 -i path/to/sa.json)
fly deploy
```

`fly.toml` provisions a `shared-cpu-1x` 256MB machine with a `/healthz` check. Adjust `min_machines_running` if you want zero-scale-to-cold-start behavior.

## What's not here (yet)

- Persistent storage. The relay is intentionally amnesiac — bridges re-register on reconnect.
- Multi-PTY bridges. One bridge process owns one session in v1; run more processes for more sessions.
- E2E encryption. Bytes are plaintext at the relay. TLS in transit only.
- Recording / playback.
- Multi-region failover.

Each is a real feature; none block shipping v1.
