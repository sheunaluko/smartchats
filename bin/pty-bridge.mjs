#!/usr/bin/env node
/**
 * PTY + WebSocket bridge — wraps a CLI agent (claude/gemini/codex) in a PTY
 * with local terminal passthrough AND exposes a WebSocket server so the
 * smartchats `cli_agent` module can drive it remotely.
 *
 * Pairs with: apps/smartchats/app/modules/cli_agent.ts
 *
 * Usage:
 *   bin/pty-bridge.mjs                         # claude on ws://localhost:9100
 *   bin/pty-bridge.mjs --model gemini
 *   bin/pty-bridge.mjs --port 8080
 *   bin/pty-bridge.mjs -- --resume abc         # passthrough flags to the CLI
 *
 * WebSocket protocol (JSON messages):
 *
 *   Client → Server:
 *     { "type": "input", "data": "hello world\n" }   Send keystrokes/commands to PTY
 *     { "type": "read", "lines": 50 }                Request last N lines of output
 *     { "type": "resize", "cols": 120, "rows": 40 }  Resize the PTY
 *
 *   Server → Client:
 *     { "type": "output", "data": "..." }             Real-time terminal output chunk
 *     { "type": "lines", "data": ["line1", ...] }     Response to "read" request
 *     { "type": "idle", "seconds": 5 }                No output for N seconds
 *     { "type": "active" }                            Output resumed after idle
 *     { "type": "exit", "code": 0 }                   Session ended
 */

import pty from 'node-pty';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolveConfig, getIdToken, reauthenticate } from 'smartchats-cloud-client';

const MODELS = {
  claude: { cmd: 'claude', displayName: 'Claude Code' },
  gemini: { cmd: 'gemini', displayName: 'Gemini CLI' },
  codex:  { cmd: 'codex',  displayName: 'Codex CLI' },
};

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
const rawArgs = process.argv.slice(2);
let modelKey = 'claude';
let wsPort = 9100;
let idleThreshold = 5; // seconds before broadcasting idle
let cloudMode = false;
let relayUrl = 'wss://smartchats-relay.fly.dev';
let bridgeIdArg = null;
let labelArg = null;
const passthroughArgs = [];

for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--model' || rawArgs[i] === '-M') {
    modelKey = rawArgs[++i];
  } else if (rawArgs[i] === '--port' || rawArgs[i] === '-p') {
    wsPort = parseInt(rawArgs[++i], 10);
  } else if (rawArgs[i] === '--idle') {
    idleThreshold = parseFloat(rawArgs[++i]);
  } else if (rawArgs[i] === '--cloud') {
    cloudMode = true;
  } else if (rawArgs[i] === '--relay') {
    relayUrl = rawArgs[++i];
  } else if (rawArgs[i] === '--bridge-id') {
    bridgeIdArg = rawArgs[++i];
  } else if (rawArgs[i] === '--label') {
    labelArg = rawArgs[++i];
  } else if (rawArgs[i] === '--') {
    passthroughArgs.push(...rawArgs.slice(i + 1));
    break;
  } else {
    passthroughArgs.push(rawArgs[i]);
  }
}

const model = MODELS[modelKey];
if (!model) {
  console.error(`Unknown model: ${modelKey}. Options: ${Object.keys(MODELS).join(', ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Rolling line buffer — stores terminal output for "read" requests
// ---------------------------------------------------------------------------
const MAX_BUFFER_LINES = 5000;
const lineBuffer = [];
let partialLine = '';

// Rolling raw-byte buffer — replayed to new WS clients so xterm widgets
// can render the existing screen state instead of starting blank.
const MAX_RAW_BUFFER = 65536;
let rawBuffer = '';

function appendRaw(data) {
  rawBuffer += data;
  if (rawBuffer.length > MAX_RAW_BUFFER) {
    rawBuffer = rawBuffer.slice(rawBuffer.length - MAX_RAW_BUFFER);
  }
}

/** Strip ANSI escape sequences for clean line storage */
function stripAnsi(str) {
  return str.replace(
    /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=><%]/g,
    ''
  );
}

/** Append raw terminal data to the rolling line buffer */
function bufferOutput(data) {
  const text = partialLine + data;
  const lines = text.split('\n');

  // Last element is either empty (if data ended with \n) or a partial line
  partialLine = lines.pop() ?? '';

  for (const line of lines) {
    const clean = stripAnsi(line).replace(/\r/g, '');
    lineBuffer.push(clean);
    if (lineBuffer.length > MAX_BUFFER_LINES) {
      lineBuffer.shift();
    }
  }
}

/** Get last N lines from the buffer */
function getLines(n) {
  const count = Math.min(n, lineBuffer.length);
  return lineBuffer.slice(-count);
}

// ---------------------------------------------------------------------------
// Idle detection — broadcasts when output goes quiet for N seconds
// ---------------------------------------------------------------------------
let idleTimer = null;
let isIdle = false;
let lastOutputTime = Date.now();
function resetIdleTimer() {
  lastOutputTime = Date.now();

  if (isIdle) {
    isIdle = false;
    broadcast({ type: 'active' });
  }

  if (idleTimer) clearTimeout(idleTimer);

  idleTimer = setTimeout(function checkIdle() {
    const elapsed = (Date.now() - lastOutputTime) / 1000;
    if (elapsed >= idleThreshold) {
      isIdle = true;
      broadcast({ type: 'idle', seconds: Math.round(elapsed) });
    }
  }, idleThreshold * 1000);
}

// ---------------------------------------------------------------------------
// Spawn PTY
// ---------------------------------------------------------------------------
const cmd = [model.cmd, ...passthroughArgs];
const { columns, rows } = process.stdout;

const ptyProcess = pty.spawn(cmd[0], cmd.slice(1), {
  name: 'xterm-256color',
  cols: columns || 80,
  rows: rows || 24,
  cwd: process.cwd(),
  env: process.env,
});

// Capture log
const tmpDir = fs.mkdtempSync(path.join('/tmp', 'pty-poc-'));
const logFile = path.join(tmpDir, 'capture.log');
const logStream = fs.createWriteStream(logFile);

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------
const server = http.createServer();
const wss = new WebSocketServer({ server });
const clients = new Set();

function handlePtyClientMessage(ws, msg) {
  if (msg.type === 'input' && typeof msg.data === 'string') {
    // Write text body, then send Enter (\r) separately after a short
    // delay so TUI frameworks (ink, blessed) register it as a keypress.
    const text = msg.data.replace(/[\r\n]+$/, '');
    const hasEnter = text.length < msg.data.length;
    if (text.length > 0) ptyProcess.write(text);
    if (hasEnter) {
      setTimeout(() => ptyProcess.write('\r'), 50);
    }
  } else if (msg.type === 'read') {
    const n = typeof msg.lines === 'number' ? msg.lines : 50;
    ws.send(JSON.stringify({ type: 'lines', data: getLines(n) }));
  } else if (msg.type === 'resize' && msg.cols && msg.rows) {
    ptyProcess.resize(msg.cols, msg.rows);
  } else if (msg.type === 'request_snapshot') {
    ws.send(JSON.stringify({ type: 'snapshot', data: rawBuffer }));
  }
}

wss.on('connection', (ws) => {
  clients.add(ws);

  if (rawBuffer.length > 0) {
    ws.send(JSON.stringify({ type: 'snapshot', data: rawBuffer }));
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    handlePtyClientMessage(ws, msg);
  });

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

/** Broadcast a message to all connected WebSocket clients (local + cloud) */
function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
  if (cloudWs && cloudWs.readyState === 1) {
    cloudWs.send(payload);
  }
}

server.listen(wsPort, () => {
  console.log(`\x1b[96m[pty-poc]\x1b[0m Starting ${model.displayName}...`);
  console.log(`\x1b[96m[pty-poc]\x1b[0m Command: ${cmd.join(' ')}`);
  console.log(`\x1b[96m[pty-poc]\x1b[0m WebSocket: ws://localhost:${wsPort}`);
  console.log(`\x1b[96m[pty-poc]\x1b[0m Capture log: ${logFile}`);
  console.log('');
});

// ---------------------------------------------------------------------------
// I/O wiring
// ---------------------------------------------------------------------------

// PTY output → local stdout + log + line buffer + idle reset + WebSocket broadcast
ptyProcess.onData((data) => {
  process.stdout.write(data);
  logStream.write(data);
  bufferOutput(data);
  appendRaw(data);
  resetIdleTimer();
  broadcast({ type: 'output', data });
});

// Local stdin → PTY (only when run in a TTY — skipped under --cloud / headless)
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (data) => {
    ptyProcess.write(data.toString());
  });
}

// Forward local terminal resize
process.stdout.on('resize', () => {
  ptyProcess.resize(process.stdout.columns, process.stdout.rows);
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
ptyProcess.onExit(({ exitCode }) => {
  if (idleTimer) clearTimeout(idleTimer);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  logStream.end();
  broadcast({ type: 'exit', code: exitCode });

  console.log('');
  console.log(`\x1b[96m[pty-poc]\x1b[0m Session ended (exit code: ${exitCode})`);

  try {
    const stats = fs.statSync(logFile);
    console.log(`\x1b[96m[pty-poc]\x1b[0m Captured ${(stats.size / 1024).toFixed(1)} KB`);
    console.log(`\x1b[96m[pty-poc]\x1b[0m Log: ${logFile}`);
  } catch {}

  server.close();
  process.exit(exitCode);
});

process.on('SIGINT', () => ptyProcess.kill('SIGINT'));
process.on('SIGTERM', () => ptyProcess.kill('SIGTERM'));

// ---------------------------------------------------------------------------
// Cloud mode — outbound WS to the smartchats-relay
// ---------------------------------------------------------------------------

let cloudWs = null;
let cloudReconnectBackoffMs = 1000;
const CLOUD_MAX_BACKOFF_MS = 30_000;
const CLOUD_REFRESH_INTERVAL_MS = 50 * 60 * 1000;
let cloudRefreshTimer = null;
let cloudConfig = null;
let cloudBridgeId = null;

async function loadOrCreateBridgeId() {
  if (bridgeIdArg) return bridgeIdArg;
  const file = path.join(os.homedir(), '.smartchats-mcp', 'bridge_id');
  try {
    const id = (await readFile(file, 'utf-8')).trim();
    if (id) return id;
  } catch {}
  const id = crypto.randomUUID();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, id, { mode: 0o600 });
  return id;
}

function scheduleCloudRefresh() {
  if (cloudRefreshTimer) clearTimeout(cloudRefreshTimer);
  cloudRefreshTimer = setTimeout(async () => {
    try {
      const devToken = process.env.SMARTCHATS_CLOUD_DEV_TOKEN;
      const newToken = devToken ?? await reauthenticate(cloudConfig);
      if (cloudWs && cloudWs.readyState === 1) {
        cloudWs.send(JSON.stringify({ type: 'bridge_reauth', token: newToken }));
      }
      scheduleCloudRefresh();
    } catch (e) {
      console.error(`\x1b[91m[cloud]\x1b[0m reauth failed: ${e.message}`);
      try { cloudWs?.close(); } catch {}
    }
  }, CLOUD_REFRESH_INTERVAL_MS);
}

function scheduleCloudReconnect() {
  setTimeout(connectCloud, cloudReconnectBackoffMs);
  cloudReconnectBackoffMs = Math.min(cloudReconnectBackoffMs * 2, CLOUD_MAX_BACKOFF_MS);
}

async function connectCloud() {
  let token;
  const devToken = process.env.SMARTCHATS_CLOUD_DEV_TOKEN;
  if (devToken) {
    token = devToken;
  } else {
    try {
      token = await getIdToken(cloudConfig);
    } catch (e) {
      console.error(`\x1b[91m[cloud]\x1b[0m auth failed: ${e.message}`);
      scheduleCloudReconnect();
      return;
    }
  }
  const url = relayUrl.replace(/\/$/, '') + '/bridge';
  const ws = new WebSocket(url);
  cloudWs = ws;

  ws.on('open', () => {
    const label = labelArg ?? `${model.displayName} @ ${os.hostname()}`;
    ws.send(JSON.stringify({
      type: 'bridge_hello',
      token,
      bridge_id: cloudBridgeId,
      label,
      model: modelKey,
      cols: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
    }));
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'bridge_registered') {
      cloudReconnectBackoffMs = 1000;
      console.log(`\x1b[96m[cloud]\x1b[0m registered as session ${msg.session_id}`);
      scheduleCloudRefresh();
    } else if (msg.type === 'error') {
      console.error(`\x1b[91m[cloud]\x1b[0m relay error: ${msg.code}`);
    } else {
      handlePtyClientMessage(ws, msg);
    }
  });

  ws.on('close', (code, reason) => {
    if (cloudWs === ws) cloudWs = null;
    if (cloudRefreshTimer) { clearTimeout(cloudRefreshTimer); cloudRefreshTimer = null; }
    console.log(`\x1b[96m[cloud]\x1b[0m disconnected (${code} ${reason ?? ''}); reconnecting...`);
    scheduleCloudReconnect();
  });

  ws.on('error', (err) => {
    console.error(`\x1b[91m[cloud]\x1b[0m ws error: ${err.message}`);
  });
}

if (cloudMode) {
  cloudConfig = resolveConfig();
  cloudBridgeId = await loadOrCreateBridgeId();
  console.log(`\x1b[96m[cloud]\x1b[0m bridge_id: ${cloudBridgeId}`);
  console.log(`\x1b[96m[cloud]\x1b[0m relay: ${relayUrl}`);
  connectCloud();
}
