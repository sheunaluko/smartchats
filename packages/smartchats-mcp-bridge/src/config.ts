/**
 * Config resolution — reads env vars + CLI args, produces the settings
 * consumed by the relay client and MCP server entry.
 *
 * Precedence: CLI arg > env var > default.
 */

import os from 'node:os';
import path from 'node:path';

export interface BridgeConfig {
  /** Relay endpoint (wss://...). '/bridge' is appended by relay-connect. */
  relayUrl: string;
  /** Roster-visible label for this agent participant. */
  label: string;
  /** Optional model hint for the roster ('claude' | 'codex' | 'gemini' | ...). */
  model: string | undefined;
  /** Explicit bridge ID, or null to load/generate via loadOrCreateBridgeId. */
  bridgeIdArg: string | null;
  /** File path for persistent bridge ID (per-label so agents don't collide). */
  bridgeIdFile: string;
  /** Long-poll interval used by wait_for_message when no timeout is given. */
  defaultWaitTimeoutMs: number;
}

const DEFAULT_RELAY = 'wss://smartchats-relay.fly.dev';
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'agent';
}

export function resolveBridgeConfig(argv: readonly string[] = process.argv.slice(2)): BridgeConfig {
  const env = process.env;
  let relayUrl = env.SMARTCHATS_RELAY ?? DEFAULT_RELAY;
  let label = env.SMARTCHATS_AGENT_LABEL ?? `${process.title || 'agent'} @ ${os.hostname()}`;
  let model: string | undefined = env.SMARTCHATS_AGENT_MODEL || undefined;
  let bridgeIdArg: string | null = env.SMARTCHATS_BRIDGE_ID ?? null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--relay') relayUrl = argv[++i];
    else if (a === '--label') label = argv[++i];
    else if (a === '--model') model = argv[++i];
    else if (a === '--bridge-id') bridgeIdArg = argv[++i];
  }

  const bridgeIdFile = path.join(
    os.homedir(),
    '.smartchats-mcp',
    `agent-bridge-${slug(label)}_id`,
  );

  return {
    relayUrl,
    label,
    model,
    bridgeIdArg,
    bridgeIdFile,
    defaultWaitTimeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
  };
}
