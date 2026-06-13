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
import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

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
const passthroughArgs = [];

for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--model' || rawArgs[i] === '-M') {
    modelKey = rawArgs[++i];
  } else if (rawArgs[i] === '--port' || rawArgs[i] === '-p') {
    wsPort = parseInt(rawArgs[++i], 10);
  } else if (rawArgs[i] === '--idle') {
    idleThreshold = parseFloat(rawArgs[++i]);
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

wss.on('connection', (ws) => {
  clients.add(ws);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

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
    }
  });

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

/** Broadcast a message to all connected WebSocket clients */
function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
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
  resetIdleTimer();
  broadcast({ type: 'output', data });
});

// Local stdin → PTY
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (data) => {
  ptyProcess.write(data.toString());
});

// Forward local terminal resize
process.stdout.on('resize', () => {
  ptyProcess.resize(process.stdout.columns, process.stdout.rows);
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
ptyProcess.onExit(({ exitCode }) => {
  if (idleTimer) clearTimeout(idleTimer);
  process.stdin.setRawMode(false);
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
