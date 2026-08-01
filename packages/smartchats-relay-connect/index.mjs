/**
 * bin/relay-connect.mjs
 *
 * Shared helper for outbound WebSocket connections to smartchats-relay
 * as a "bridge" — an entity that owns a session and gets subscribed to
 * by clients.
 *
 * Consumers:
 *   - bin/pty-bridge.mjs                                (kind: 'pty', legacy default)
 *   - packages/smartchats-mcp-bridge/src/relay_client.ts (kind: 'agent')
 *
 * Handles:
 *   - ID token acquisition + refresh (smartchats-cloud-client, or
 *     SMARTCHATS_CLOUD_DEV_TOKEN env override for local relay/dev)
 *   - WebSocket open + bridge_hello handshake
 *   - Reconnect with exponential backoff (1s → 30s default)
 *   - Token refresh every 50 min via bridge_reauth
 *
 * Does NOT handle:
 *   - Message content (caller wires 'message' events + calls .send())
 *   - Bridge-ID persistence (caller calls loadOrCreateBridgeId beforehand)
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { getIdToken, reauthenticate } from 'smartchats-cloud-client';

const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_REFRESH_INTERVAL_MS = 50 * 60 * 1000;
const DEFAULT_BRIDGE_ID_FILE = path.join(os.homedir(), '.smartchats-mcp', 'bridge_id');

/**
 * Load a persistent bridge ID from disk (default ~/.smartchats-mcp/bridge_id),
 * or generate + save a new one if the file is missing.
 *
 * Pass `explicit` to bypass the file (e.g. from a --bridge-id CLI flag).
 * Pass `filePath` to persist to a different location (e.g. per-agent).
 */
export async function loadOrCreateBridgeId(explicit, filePath = DEFAULT_BRIDGE_ID_FILE) {
  if (explicit) return explicit;
  try {
    const id = (await readFile(filePath, 'utf-8')).trim();
    if (id) return id;
  } catch {}
  const id = crypto.randomUUID();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, id, { mode: 0o600 });
  return id;
}

function makeDefaultLogger(tag) {
  return {
    info:  (msg) => console.log(`\x1b[96m[${tag}]\x1b[0m ${msg}`),
    error: (msg) => console.error(`\x1b[91m[${tag}]\x1b[0m ${msg}`),
  };
}

/**
 * Establish + maintain an outbound bridge WebSocket to smartchats-relay.
 *
 * @param {Object} opts
 * @param {string} opts.relayUrl        e.g. 'wss://smartchats-relay.fly.dev'
 *                                      ('/bridge' is appended automatically)
 * @param {Object} opts.config          CloudClientConfig from resolveConfig()
 * @param {string} opts.bridgeId        stable bridge_id (from loadOrCreateBridgeId)
 * @param {Object} opts.hello           extra fields merged into bridge_hello
 *                                      (kind, label, model, cols/rows, etc.)
 * @param {string} [opts.tag='cloud']   log tag for default logger
 * @param {Object} [opts.logger]        { info, error } — overrides tag-based default
 * @param {number} [opts.maxBackoffMs]  cap for exponential reconnect (default 30s)
 * @param {number} [opts.refreshIntervalMs] token reauth interval (default 50m)
 *
 * @returns {EventEmitter & {
 *   send: (msg: object|string) => boolean,
 *   close: () => void,
 *   get ws(): WebSocket|null
 * }}
 *   Events:
 *     'open'       (ws)             — socket opened; hello sent
 *     'registered' (msg)            — bridge_registered received (msg.session_id)
 *     'message'    (msg)            — any relay-side message not handled
 *                                     internally (bridge_registered still emits
 *                                     via 'registered'; other messages emit here)
 *     'close'      (code, reason)
 *     'error'      (err)
 */
export function connectRelay(opts) {
  const {
    relayUrl,
    config,
    bridgeId,
    hello,
    tag = 'cloud',
    logger = makeDefaultLogger(tag),
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
  } = opts;

  const emitter = new EventEmitter();
  const url = relayUrl.replace(/\/$/, '') + '/bridge';

  let currentWs = null;
  let backoffMs = 1000;
  let refreshTimer = null;
  let reconnectTimer = null;
  let closed = false;

  function scheduleReauth() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      try {
        const devToken = process.env.SMARTCHATS_CLOUD_DEV_TOKEN;
        const newToken = devToken ?? await reauthenticate(config);
        if (currentWs && currentWs.readyState === 1) {
          currentWs.send(JSON.stringify({ type: 'bridge_reauth', token: newToken }));
        }
        scheduleReauth();
      } catch (e) {
        logger.error(`reauth failed: ${e.message}`);
        try { currentWs?.close(); } catch {}
      }
    }, refreshIntervalMs);
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoffMs);
    backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
  }

  async function connect() {
    if (closed) return;
    let token;
    const devToken = process.env.SMARTCHATS_CLOUD_DEV_TOKEN;
    if (devToken) {
      token = devToken;
    } else {
      try {
        token = await getIdToken(config);
      } catch (e) {
        logger.error(`auth failed: ${e.message}`);
        scheduleReconnect();
        return;
      }
    }
    const ws = new WebSocket(url);
    currentWs = ws;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'bridge_hello',
        token,
        bridge_id: bridgeId,
        ...hello,
      }));
      emitter.emit('open', ws);
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'bridge_registered') {
        backoffMs = 1000;
        logger.info(`registered as session ${msg.session_id}`);
        scheduleReauth();
        emitter.emit('registered', msg);
      } else if (msg.type === 'error') {
        logger.error(`relay error: ${msg.code}`);
        emitter.emit('message', msg);
      } else {
        emitter.emit('message', msg);
      }
    });

    ws.on('close', (code, reason) => {
      if (currentWs === ws) currentWs = null;
      if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
      logger.info(`disconnected (${code} ${reason ?? ''}); reconnecting...`);
      emitter.emit('close', code, reason);
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      logger.error(`ws error: ${err.message}`);
      emitter.emit('error', err);
    });
  }

  const controller = Object.assign(emitter, {
    send(msg) {
      if (currentWs && currentWs.readyState === 1) {
        currentWs.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
        return true;
      }
      return false;
    },
    close() {
      closed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { currentWs?.close(); } catch {}
    },
    get ws() { return currentWs; },
  });

  connect();

  return controller;
}
