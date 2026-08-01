import type { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';

/**
 * Load a persistent bridge ID from disk (default ~/.smartchats-mcp/bridge_id),
 * or generate + save a new one if the file is missing.
 *
 * Pass `explicit` to bypass the file (e.g. from a --bridge-id CLI flag).
 * Pass `filePath` to persist to a different location (e.g. per-agent).
 */
export function loadOrCreateBridgeId(
  explicit?: string | null,
  filePath?: string,
): Promise<string>;

export interface RelayLogger {
  info(msg: string): void;
  error(msg: string): void;
}

export interface ConnectRelayOptions {
  /** e.g. 'wss://smartchats-relay.fly.dev' — '/bridge' is appended automatically. */
  relayUrl: string;
  /** CloudClientConfig from smartchats-cloud-client `resolveConfig()`. */
  config: unknown;
  /** Stable bridge ID (from `loadOrCreateBridgeId`). */
  bridgeId: string;
  /** Extra fields merged into the `bridge_hello` payload (kind, label, model, cols/rows, ...). */
  hello: Record<string, unknown>;
  /** Log tag for the default logger (e.g. 'cloud', 'agent'). Default: 'cloud'. */
  tag?: string;
  /** Overrides the tag-based default logger. */
  logger?: RelayLogger;
  /** Reconnect backoff cap in ms. Default: 30_000. */
  maxBackoffMs?: number;
  /** Token reauth interval in ms. Default: 50 * 60 * 1000. */
  refreshIntervalMs?: number;
}

export interface RelayController extends EventEmitter {
  /** Send a JSON message on the current socket. Returns false if closed. */
  send(msg: object | string): boolean;
  /** Cancel reconnection and close the current socket. */
  close(): void;
  /** The current WebSocket, or null if reconnecting/closed. */
  readonly ws: WebSocket | null;

  on(event: 'open', listener: (ws: WebSocket) => void): this;
  on(event: 'registered', listener: (msg: { session_id: string; [k: string]: unknown }) => void): this;
  on(event: 'message', listener: (msg: Record<string, unknown>) => void): this;
  on(event: 'close', listener: (code: number, reason: Buffer | string) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
}

/**
 * Establish + maintain an outbound bridge WebSocket to smartchats-relay.
 *
 * Handles: ID token acquisition + refresh, WS open + `bridge_hello` handshake,
 * reconnect with exponential backoff, token refresh via `bridge_reauth`.
 *
 * Does NOT handle: message content routing — caller wires 'message' events and
 * calls `.send()` to reply.
 */
export function connectRelay(opts: ConnectRelayOptions): RelayController;
