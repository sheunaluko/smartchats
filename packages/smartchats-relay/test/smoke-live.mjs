#!/usr/bin/env node
/**
 * Live end-to-end smoke test for the deployed smartchats-relay.
 *
 * Separate from routing.test.ts (which is a hermetic vitest suite) — this
 * hits the real Fly deploy and expects a running bridge to be registered.
 * NOT run by `npm test`; run manually:
 *
 *     cd ~/dev/smartchats
 *     sm bridge start           # once, if no bridge is running
 *     node packages/smartchats-relay/test/smoke-live.mjs
 *
 * Env overrides:
 *   RELAY        (default: wss://smartchats-relay.fly.dev)
 *   FLY_INSTANCE (if set, pinned via Fly-Force-Instance-Id header —
 *                 only useful when relay is running >1 machine; single
 *                 machine is the current default per fly.toml)
 *   BRIDGE_ID    (default: read from ~/.smartchats-mcp/bridge_id)
 *
 * Must be run from the monorepo root so `smartchats-cloud-client` and
 * `ws` resolve via workspace node_modules.
 *
 * Passes iff: WS opens, client_hello auth succeeds, session_list contains
 * our bridge, subscribe succeeds, and we observe >0 output bytes after
 * sending input.
 */

import WebSocket from 'ws';
import { resolveConfig, getIdToken } from 'smartchats-cloud-client';
import fs from 'node:fs';
import { homedir } from 'node:os';

const RELAY = process.env.RELAY ?? 'wss://smartchats-relay.fly.dev';
const FLY_INSTANCE = process.env.FLY_INSTANCE ?? '';
const BRIDGE_ID = process.env.BRIDGE_ID ?? fs.readFileSync(`${homedir()}/.smartchats-mcp/bridge_id`, 'utf8').trim();

console.log(`[smoke] target=${RELAY}/client  bridge_id=${BRIDGE_ID}${FLY_INSTANCE ? `  pinned-fly=${FLY_INSTANCE}` : ''}`);

const cfg = resolveConfig();
const token = process.env.SMARTCHATS_CLOUD_DEV_TOKEN ?? await getIdToken(cfg);
console.log(`[smoke] token acquired (${token.length} chars)`);

const headers = FLY_INSTANCE ? { 'Fly-Force-Instance-Id': FLY_INSTANCE } : {};
const ws = new WebSocket(`${RELAY}/client`, { headers });

let subscribed = false;
let outputBytes = 0;
const start = Date.now();

const send = (obj) => {
    console.log(`[smoke] >> ${obj.type}${obj.session_id ? ` sid=${obj.session_id.slice(0,8)}...` : ''}${obj.data ? ` data=${JSON.stringify(obj.data).slice(0,60)}` : ''}`);
    ws.send(JSON.stringify(obj));
};

ws.on('open', () => {
    console.log(`[smoke] ws open (${Date.now() - start}ms)`);
    send({ type: 'client_hello', token });
});

ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { console.log(`[smoke] << (non-json ${raw.length}B)`); return; }
    if (msg.type === 'output' || msg.type === 'snapshot') {
        outputBytes += (msg.data ?? '').length;
        console.log(`[smoke] << ${msg.type} (+${(msg.data ?? '').length}B, total ${outputBytes}B)`);
    } else {
        console.log(`[smoke] << ${msg.type} ${JSON.stringify(msg).slice(0, 200)}`);
    }

    if (msg.type === 'session_list') {
        const found = msg.sessions.find((s) => s.session_id === BRIDGE_ID);
        if (!found) {
            console.log(`[smoke] ERROR: bridge_id ${BRIDGE_ID} not in session_list of ${msg.sessions.length}. Wrong Fly instance? Sessions: ${JSON.stringify(msg.sessions.map(s => s.session_id))}`);
            process.exit(2);
        }
        console.log(`[smoke] found bridge in session_list — label="${found.label}" model=${found.model}`);
        send({ type: 'subscribe', session_id: BRIDGE_ID });
    }

    if (msg.type === 'subscribed') {
        subscribed = true;
        console.log(`[smoke] subscribed — sending input in 500ms`);
        setTimeout(() => {
            send({ type: 'input', data: '/status\n' });
        }, 500);
    }
});

ws.on('error', (e) => { console.log(`[smoke] ws error: ${e.message}`); });
ws.on('close', (code, reason) => { console.log(`[smoke] ws close code=${code} reason=${reason}`); });

setTimeout(() => {
    const pass = subscribed && outputBytes > 0;
    console.log(`[smoke] final: subscribed=${subscribed} outputBytes=${outputBytes}  ${pass ? 'PASS' : 'FAIL'}`);
    ws.close();
    setTimeout(() => process.exit(pass ? 0 : 1), 300);
}, 8000);
