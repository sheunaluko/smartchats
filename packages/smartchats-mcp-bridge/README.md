# smartchats-mcp-bridge

MCP server that turns any MCP-speaking coding agent (Claude Code, Codex, aider, Gemini CLI, Cursor, ...) into a smartchats "agent participant" — a first-class entity the user can voice-patch-through to.

**Phase A** of the [MCP Patch-Through unlock](../../../UNLOCK_MCP_PATCH_THROUGH.md). Ships the wire-level bridge; the smartchats UI + `sm agent` CLI verb land in later phases.

## Not to be confused with `smartchats-mcp`

| | `smartchats-mcp` | `smartchats-mcp-bridge` (this) |
|---|---|---|
| Purpose | Expose user **data** (logs, metrics, KG, todos) to an LLM client | Live **messaging** between a coding agent and the smartchats user |
| Auth | Firebase OAuth (READ) | Relay token via smartchats-cloud-client (WRITE) |
| Lifecycle | One per LLM client connection | One per running coding agent |
| Runs where | Alongside Claude Desktop, etc. | As stdio subprocess of the coding agent |

Both can be spawned simultaneously — they complement each other.

## Tool surface (Phase A)

Exposed to the connected coding agent over stdio MCP:

- **`send_message_to_user(text, artifacts?)`** — push a message to the user. Fire-and-forget from the agent's perspective; delivered via the relay.
- **`wait_for_message(timeout_ms?)`** — block until the user sends a message back or the timeout fires. Returns `{ from: 'user', text, timestamp }` or `{ timeout: true }`.
- **`poll_messages(since?)`** — non-blocking peek for messages arrived since a timestamp. Returns `{ messages: [...] }`.
- **`ask_user(question, timeout_ms?)`** — convenience wrapper for `send_message_to_user` + `wait_for_message`. Returns the user's reply.

Deferred to Phase E: `stream_html_to_user`, richer artifact refs.

## Wiring

```
     ┌──────────────────┐
     │  Coding agent    │  (Claude Code / Codex / aider / ...)
     │                  │
     │  MCP tool calls  ├──stdio──►  smartchats-mcp-bridge
     └──────────────────┘                     │
                                              │ WebSocket (agent bridge)
                                              ▼
                                       smartchats-relay
                                              │
                                              ▼
                                         smartchats app
                                          (browser, voice)
```

## Usage (Phase A — direct spawn; `sm agent start` comes in Phase D)

```jsonc
// In your coding agent's MCP config (e.g. .mcp.json for Claude Code)
{
  "mcpServers": {
    "smartchats-patch-through": {
      "command": "npx",
      "args": ["smartchats-mcp-bridge"],
      "env": {
        "SMARTCHATS_RELAY": "wss://smartchats-relay.fly.dev",
        "SMARTCHATS_AGENT_LABEL": "claude-code @ my-mac"
      }
    }
  }
}
```

The agent's system prompt should tell it to use the tools:
> _You have `send_message_to_user`, `wait_for_message`, and `ask_user` tools available. When the user is "patched through" you should enter a tight loop: `wait_for_message` → respond → `send_message_to_user` → repeat, until the user says "unpatch" or "end call."_

## Environment

| Var | Default | Purpose |
|---|---|---|
| `SMARTCHATS_RELAY` | `wss://smartchats-relay.fly.dev` | Relay endpoint |
| `SMARTCHATS_AGENT_LABEL` | `<node process title> @ <hostname>` | Display label |
| `SMARTCHATS_AGENT_MODEL` | (unset) | Optional model hint for the roster |
| `SMARTCHATS_BRIDGE_ID` | auto | Explicit bridge ID (default: persistent in `~/.smartchats-mcp/agent-bridge-<label>_id`) |
| `SMARTCHATS_CLOUD_DEV_TOKEN` | (unset) | Bypass Firebase auth for local relay dev |

## Testing

- `npm run test:unit` — hermetic vitest against mocked relay
- `npm run test:live` — end-to-end smoke against the deployed relay (requires an existing smartchats login on this box)
