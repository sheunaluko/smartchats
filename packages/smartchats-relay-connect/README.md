# smartchats-relay-connect

Shared helper for outbound bridge WebSocket connections to `smartchats-relay`. Extracted from `bin/pty-bridge.mjs` so multiple bridge kinds (PTY-wrapped CLI agents, MCP-based agent participants) can reuse the same auth + reconnect + reauth logic.

**Consumers:**
- `bin/pty-bridge.mjs` — `kind: 'pty'` (legacy default; wraps claude / gemini / codex in a PTY)
- `packages/smartchats-mcp-bridge` — `kind: 'agent'` (MCP participant for voice patch-through)

## What it handles

- ID token acquisition via `smartchats-cloud-client` (or `SMARTCHATS_CLOUD_DEV_TOKEN` env override for local relay work)
- WebSocket open + `bridge_hello` handshake — caller supplies extra hello fields (`kind`, `label`, `model`, `cols`, `rows`, ...)
- Reconnect with exponential backoff (1s → 30s, cap configurable)
- Token refresh every 50 min via `bridge_reauth`
- Persistent bridge-ID load/generate — `loadOrCreateBridgeId(explicit?, filePath?)`

## What it does NOT handle

- Message content — caller subscribes to `'message'` events and calls `.send()` to reply.
- Bridge-ID persistence path is `~/.smartchats-mcp/bridge_id` by default; pass `filePath` to separate per-agent state.

## Usage

```js
import { connectRelay, loadOrCreateBridgeId } from 'smartchats-relay-connect';
import { resolveConfig } from 'smartchats-cloud-client';

const config = resolveConfig();
const bridgeId = await loadOrCreateBridgeId(process.env.BRIDGE_ID);

const relay = connectRelay({
  relayUrl: 'wss://smartchats-relay.fly.dev',
  config,
  bridgeId,
  tag: 'agent',
  hello: {
    kind: 'agent',
    label: 'claude-code @ my-mac',
    model: 'claude',
  },
});

relay.on('registered', ({ session_id }) => console.log('session', session_id));
relay.on('message',    (msg) => handle(msg));
relay.on('close',      () => {/* auto-reconnect handled */});

relay.send({ type: 'agent_event', payload: {...} });
```

## Events

| Event | Payload | Notes |
|---|---|---|
| `open` | `(ws)` | Socket opened, hello sent. Fires on each reconnect. |
| `registered` | `(msg)` | `bridge_registered` received — `msg.session_id` set. |
| `message` | `(msg)` | Any relay-side message other than `bridge_registered`. `error` messages are logged and re-emitted. |
| `close` | `(code, reason)` | Auto-reconnect scheduled after this fires. |
| `error` | `(err)` | Non-fatal socket error. |

## License

MIT.
