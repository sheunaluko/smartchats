/**
 * Agent-side relay client — thin wrapper over `smartchats-relay-connect` that
 * layers the agent wire protocol on top of the generic bridge WebSocket.
 *
 * Wire protocol (Phase A):
 *
 *   Bridge → Relay:
 *     { type: 'bridge_hello', kind: 'agent', ... }  (handled by connectRelay)
 *     { type: 'agent_event', event: 'message', text, artifacts?, timestamp }
 *
 *   Relay → Bridge:
 *     { type: 'bridge_registered', session_id }     (handled by connectRelay)
 *     { type: 'agent_message', text, timestamp }
 *     { type: 'error', code }
 */

import { resolveConfig } from 'smartchats-cloud-client';
import {
  connectRelay,
  loadOrCreateBridgeId,
  type RelayController,
} from 'smartchats-relay-connect';
import type { BridgeConfig } from './config.js';
import type { MessageQueue, UserMessage } from './message_queue.js';

export interface AgentRelayClient {
  /** Session ID from `bridge_registered`, once received. */
  readonly sessionId: string | null;
  /** True if the underlying socket is open and registered. */
  readonly connected: boolean;
  /** Send a text message from the agent to the user. Returns false if not connected. */
  sendMessageToUser(text: string, artifacts?: unknown[]): boolean;
  /** Close the relay connection (stops reconnecting). */
  close(): void;
}

export interface StartAgentRelayClientOptions {
  config: BridgeConfig;
  queue: MessageQueue;
  /** Logger for the relay-connect helper. Defaults to stderr-based `[agent]` tag. */
  logger?: { info(m: string): void; error(m: string): void };
  /** Injected `connectRelay` for tests (default: real one). */
  connect?: typeof connectRelay;
  /** Injected `resolveConfig` for tests (default: real one). */
  resolveCloudConfig?: typeof resolveConfig;
  /** Injected `loadOrCreateBridgeId` for tests. */
  loadBridgeId?: typeof loadOrCreateBridgeId;
}

/**
 * Start the agent-side relay client. Non-blocking: returns immediately with a
 * handle whose `connected` flips true once `bridge_registered` arrives.
 * User messages are enqueued into `opts.queue` as they arrive.
 */
export async function startAgentRelayClient(
  opts: StartAgentRelayClientOptions,
): Promise<AgentRelayClient> {
  const {
    config,
    queue,
    logger,
    connect = connectRelay,
    resolveCloudConfig = resolveConfig,
    loadBridgeId = loadOrCreateBridgeId,
  } = opts;

  const cloudConfig = resolveCloudConfig();
  const bridgeId = await loadBridgeId(config.bridgeIdArg, config.bridgeIdFile);

  let sessionId: string | null = null;
  let registered = false;

  const controller: RelayController = connect({
    relayUrl: config.relayUrl,
    config: cloudConfig,
    bridgeId,
    tag: 'agent',
    logger,
    hello: {
      kind: 'agent',
      label: config.label,
      ...(config.model ? { model: config.model } : {}),
    },
  });

  controller.on('registered', (msg) => {
    sessionId = typeof msg.session_id === 'string' ? msg.session_id : null;
    registered = true;
  });

  controller.on('close', () => {
    registered = false;
  });

  controller.on('message', (msg) => {
    if (msg.type === 'agent_message') {
      const text = typeof msg.text === 'string' ? msg.text : '';
      const timestamp =
        typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();
      const userMsg: UserMessage = { from: 'user', text, timestamp };
      queue.enqueue(userMsg);
    }
    // Other message kinds (mode markers, subscription events) are ignored in
    // Phase A. Will land in Phase B/C alongside the smartchats UI changes.
  });

  return {
    get sessionId() { return sessionId; },
    get connected() { return registered; },
    sendMessageToUser(text: string, artifacts?: unknown[]): boolean {
      const payload: Record<string, unknown> = {
        type: 'agent_event',
        event: 'message',
        text,
        timestamp: Date.now(),
      };
      if (artifacts && artifacts.length > 0) payload.artifacts = artifacts;
      return controller.send(payload);
    },
    close() {
      controller.close();
    },
  };
}
