#!/usr/bin/env node
/**
 * Live end-to-end smoke for smartchats-mcp-bridge.
 *
 * Spawns the bridge as a stdio MCP subprocess, attaches an MCP client to it,
 * and independently connects a WebSocket client to the relay. Rides both
 * sides of the wire to verify:
 *
 *   1. The bridge authenticates + registers with kind='agent'.
 *   2. session_list on the /client side surfaces the bridge with kind='agent'.
 *   3. Sending `agent_message` from the client → tool queue → visible to
 *      `poll_messages` MCP tool call.
 *   4. Calling `send_message_to_user` MCP tool → `agent_event` arriving at
 *      the subscribed client.
 *
 * NOT run by `npm test`. Manual invocation:
 *
 *     cd ~/dev/smartchats/packages/smartchats-mcp-bridge
 *     npm run build && npm run test:live
 *
 * Requires an existing smartchats login on this box (see smartchats-cloud-client)
 * and network access to the relay. Set SMARTCHATS_CLOUD_DEV_TOKEN if bypassing
 * Firebase auth against a local relay.
 *
 * Env overrides:
 *   RELAY       (default: wss://smartchats-relay.fly.dev)
 *   AGENT_LABEL (default: "smoke @ <hostname>")
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveConfig, getIdToken } from 'smartchats-cloud-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELAY = process.env.RELAY ?? 'wss://smartchats-relay.fly.dev';
const LABEL = process.env.AGENT_LABEL ?? `smoke @ ${os.hostname()}`;
const BRIDGE_ENTRY = path.resolve(__dirname, '..', 'dist', 'index.js');

const log = (s) => console.log(`[smoke] ${s}`);
const fail = (msg) => { console.error(`[smoke] FAIL: ${msg}`); process.exit(1); };

// -- 1. Spawn the mcp-bridge subprocess + attach MCP client ----------------
log(`spawning bridge: node ${BRIDGE_ENTRY}`);
const transport = new StdioClientTransport({
  command: 'node',
  args: [BRIDGE_ENTRY],
  env: {
    ...process.env,
    SMARTCHATS_RELAY: RELAY,
    SMARTCHATS_AGENT_LABEL: LABEL,
    SMARTCHATS_AGENT_MODEL: 'claude',
  },
});
const mcp = new Client({ name: 'smoke', version: '0.1.0' });
await mcp.connect(transport);
log('mcp connected to bridge');

const tools = await mcp.listTools();
const toolNames = tools.tools.map((t) => t.name).sort();
log(`tools: ${toolNames.join(', ')}`);
const expected = ['ask_user', 'poll_messages', 'send_message_to_user', 'wait_for_message'];
for (const t of expected) {
  if (!toolNames.includes(t)) fail(`missing tool: ${t}`);
}

// -- 2. Connect independent client WS to relay -----------------------------
const cfg = resolveConfig();
const token = process.env.SMARTCHATS_CLOUD_DEV_TOKEN ?? await getIdToken(cfg);
log(`client token acquired (${token.length} chars)`);
const client = new WebSocket(`${RELAY.replace(/\/$/, '')}/client`);
await new Promise((res, rej) => { client.once('open', res); client.once('error', rej); });
log('client ws open');

const clientQueue = [];
const clientWaiters = [];
client.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  log(`<< client: ${msg.type}${msg.session_id ? ` sid=${msg.session_id.slice(0,8)}...` : ''}`);
  clientQueue.push(msg);
  while (clientWaiters.length && clientQueue.length) {
    const w = clientWaiters.shift();
    const m = clientQueue.shift();
    w.match(m) ? w.resolve(m) : (clientQueue.unshift(m), clientWaiters.unshift(w));
    break;
  }
});
const waitForClient = (match, timeoutMs = 10_000) => new Promise((resolve, reject) => {
  const idx = clientQueue.findIndex(match);
  if (idx >= 0) { resolve(clientQueue.splice(idx, 1)[0]); return; }
  const waiter = { match, resolve, reject };
  clientWaiters.push(waiter);
  setTimeout(() => {
    const i = clientWaiters.indexOf(waiter);
    if (i >= 0) clientWaiters.splice(i, 1);
    reject(new Error(`timeout waiting for client message`));
  }, timeoutMs);
});

client.send(JSON.stringify({ type: 'client_hello', token }));

// -- 3. Find our bridge in session_list ------------------------------------
let sessionId = null;
for (let attempt = 0; attempt < 10 && !sessionId; attempt++) {
  const list = await waitForClient((m) => m.type === 'session_list');
  const agentSessions = (list.sessions ?? []).filter((s) => s.kind === 'agent' && s.label === LABEL);
  if (agentSessions.length > 0) {
    sessionId = agentSessions[0].session_id;
    log(`found bridge: session_id=${sessionId.slice(0,8)}... kind=agent label="${LABEL}"`);
    break;
  }
  log(`bridge not yet in session_list (attempt ${attempt+1}/10), waiting…`);
  await new Promise((r) => setTimeout(r, 1000));
  client.send(JSON.stringify({ type: 'client_hello', token }));
}
if (!sessionId) fail('bridge never appeared in session_list with matching label');

// -- 4. Subscribe to the bridge --------------------------------------------
client.send(JSON.stringify({ type: 'subscribe', session_id: sessionId }));
const sub = await waitForClient((m) => m.type === 'subscribed');
if (sub.session_id !== sessionId) fail(`subscribed to wrong session_id: ${sub.session_id}`);
log('subscribed');

// -- 5. Client → bridge queue → poll_messages MCP call ---------------------
const marker = `smoke-marker-${Date.now()}`;
const markerTs = Date.now();
client.send(JSON.stringify({ type: 'agent_message', text: marker, timestamp: markerTs }));
log(`>> agent_message "${marker}"`);
await new Promise((r) => setTimeout(r, 300));

const pollRes = await mcp.callTool({ name: 'poll_messages', arguments: { since: markerTs - 1 } });
const pollPayload = JSON.parse(pollRes.content[0].text);
log(`mcp poll_messages returned ${pollPayload.messages.length} message(s)`);
const found = pollPayload.messages.find((m) => m.text === marker);
if (!found) fail(`marker "${marker}" not in poll_messages result: ${JSON.stringify(pollPayload)}`);
log(`marker round-tripped client→bridge queue OK`);

// -- 6. send_message_to_user MCP call → agent_event at client --------------
const sendText = `smoke-reply-${Date.now()}`;
const sendRes = await mcp.callTool({
  name: 'send_message_to_user',
  arguments: { text: sendText },
});
const sendPayload = JSON.parse(sendRes.content[0].text);
if (!sendPayload.sent) fail(`send_message_to_user did not confirm sent: ${JSON.stringify(sendPayload)}`);
log(`mcp send_message_to_user returned { sent: true }`);

const evt = await waitForClient((m) => m.type === 'agent_event' && m.text === sendText, 5_000);
log(`agent_event received at client with matching text OK`);

// -- Cleanup ---------------------------------------------------------------
log('PASS — closing down');
client.close();
await mcp.close();
process.exit(0);
