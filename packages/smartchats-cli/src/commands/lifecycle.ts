/**
 * Stack-lifecycle commands: stop, restart, status, logs.
 *
 * All four read the PID file + log files written by `start` (lib/runstate.ts).
 * Single file because they share a tiny call surface; split if any of them
 * grows past ~50 lines.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import consola from 'consola';

import { runStart, parseStartArgs } from './start.js';
import {
    type PidFile,
    isProcessAlive,
    pidFilePath,
    probePort,
    readPidFile,
    removePidFile,
    serverLogPath,
    surrealLogPath,
} from '../lib/runstate.js';

// ─── stop ─────────────────────────────────────────────────────────────

export interface StopArgs {
    timeoutMs: number;
}

export function parseStopArgs(rest: string[]): StopArgs {
    const args: StopArgs = { timeoutMs: 5000 };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--timeout') args.timeoutMs = parseInt(rest[++i], 10);
        else if (a === '-h' || a === '--help') { console.log(stopHelp()); process.exit(0); }
    }
    return args;
}

export function stopHelp(): string {
    return `smartchats stop — stop the running local stack

Usage:
  smartchats stop [--timeout <ms>]

Options:
  --timeout <ms>   How long to wait after SIGTERM before SIGKILL (default 5000).
  -h, --help       Show this help.
`;
}

async function waitForProcessExit(pid: number, timeoutMs: number, intervalMs = 100): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isProcessAlive(pid)) return true;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return !isProcessAlive(pid);
}

export async function runStop(args: StopArgs): Promise<number> {
    const rec = readPidFile();
    if (!rec) {
        consola.info('Nothing to stop (no PID file).');
        return 0;
    }

    let stopped = 0;
    let killed = 0;

    for (const [name, proc] of [['server', rec.server], ['surreal', rec.surreal]] as const) {
        if (!isProcessAlive(proc.pid)) {
            consola.info(`${name} (pid ${proc.pid}): already gone`);
            continue;
        }
        consola.start(`${name} (pid ${proc.pid}): SIGTERM`);
        try { process.kill(proc.pid, 'SIGTERM'); } catch { /* race: process exited */ }
        const exited = await waitForProcessExit(proc.pid, args.timeoutMs);
        if (exited) {
            consola.success(`${name}: stopped`);
            stopped++;
        } else {
            consola.warn(`${name} (pid ${proc.pid}): did not exit in ${args.timeoutMs}ms — SIGKILL`);
            try { process.kill(proc.pid, 'SIGKILL'); } catch { /* */ }
            killed++;
        }
    }

    removePidFile();
    if (killed > 0) {
        consola.warn(`Stopped ${stopped}, force-killed ${killed}.`);
        return 0;
    }
    consola.success('Stopped.');
    return 0;
}

// ─── restart ──────────────────────────────────────────────────────────

export function restartHelp(): string {
    return `smartchats restart — stop the stack and start it again

Usage:
  smartchats restart [start-options...]

All flags forward to \`smartchats start\` (see: smartchats help start).
`;
}

export async function runRestart(rest: string[]): Promise<number> {
    const stopExit = await runStop({ timeoutMs: 5000 });
    if (stopExit !== 0) return stopExit;
    const startArgs = parseStartArgs(rest);
    return runStart(startArgs);
}

// ─── status ───────────────────────────────────────────────────────────

export interface StatusArgs {
    json: boolean;
}

export function parseStatusArgs(rest: string[]): StatusArgs {
    const args: StatusArgs = { json: false };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--json') args.json = true;
        else if (a === '-h' || a === '--help') { console.log(statusHelp()); process.exit(0); }
    }
    return args;
}

export function statusHelp(): string {
    return `smartchats status — show what's running, on what ports, with what health

Usage:
  smartchats status [--json]

Options:
  --json   Emit machine-readable JSON.
  -h, --help

Exits 0 if the stack is up and healthy, 1 otherwise.
`;
}

interface ProcStatus {
    name: 'surreal' | 'server';
    pid: number;
    port: number;
    startedAt: string;
    pidAlive: boolean;
    portHealthy: boolean;
}

async function gatherStatus(rec: PidFile): Promise<ProcStatus[]> {
    const probes: ProcStatus[] = [
        { name: 'surreal', pid: rec.surreal.pid, port: rec.surreal.port, startedAt: rec.surreal.startedAt, pidAlive: false, portHealthy: false },
        { name: 'server',  pid: rec.server.pid,  port: rec.server.port,  startedAt: rec.server.startedAt,  pidAlive: false, portHealthy: false },
    ];
    await Promise.all(probes.map(async (p) => {
        p.pidAlive = isProcessAlive(p.pid);
        p.portHealthy = await probePort(p.port, p.name === 'surreal' ? '/health' : '/local-api/health');
    }));
    return probes;
}

export async function runStatus(args: StatusArgs): Promise<number> {
    const rec = readPidFile();
    if (!rec) {
        if (args.json) {
            console.log(JSON.stringify({ up: false, reason: 'no-pid-file' }, null, 2));
        } else {
            consola.info('Stack is not running (no PID file).');
        }
        return 1;
    }

    const probes = await gatherStatus(rec);
    const allHealthy = probes.every((p) => p.pidAlive && p.portHealthy);

    if (args.json) {
        console.log(JSON.stringify({ up: allHealthy, procs: probes }, null, 2));
        return allHealthy ? 0 : 1;
    }

    const nameWidth = Math.max(...probes.map((p) => p.name.length));
    console.log('');
    for (const p of probes) {
        const aliveIcon = p.pidAlive ? '✓' : '✗';
        const healthIcon = p.portHealthy ? '✓' : '✗';
        const age = humanizeDuration(Date.now() - new Date(p.startedAt).getTime());
        console.log(
            `  ${p.name.padEnd(nameWidth)}  pid ${aliveIcon} ${String(p.pid).padEnd(6)} ` +
            `port ${healthIcon} ${String(p.port).padEnd(6)} up ${age}`,
        );
    }
    console.log('');
    if (allHealthy) {
        consola.success(`Stack healthy. Open: http://localhost:${rec.server.port}`);
        return 0;
    }
    consola.warn('Stack is degraded — one or more processes are unresponsive. Try `smartchats restart`.');
    return 1;
}

function humanizeDuration(ms: number): string {
    if (ms < 0) return '?';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}

// ─── logs ─────────────────────────────────────────────────────────────

export interface LogsArgs {
    follow: boolean;
    proc: 'surreal' | 'server' | 'all';
    lines: number;
}

export function parseLogsArgs(rest: string[]): LogsArgs {
    const args: LogsArgs = { follow: false, proc: 'all', lines: 50 };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '-f' || a === '--follow') args.follow = true;
        else if (a === '--proc') {
            const v = rest[++i];
            if (v !== 'surreal' && v !== 'server' && v !== 'all') {
                console.error(`--proc must be surreal|server|all (got ${v})`); process.exit(1);
            }
            args.proc = v;
        }
        else if (a === '-n' || a === '--lines') args.lines = parseInt(rest[++i], 10);
        else if (a === '-h' || a === '--help') { console.log(logsHelp()); process.exit(0); }
    }
    return args;
}

export function logsHelp(): string {
    return `smartchats logs — tail per-process logs from the running stack

Usage:
  smartchats logs [options]

Options:
  -f, --follow              Follow new output (Ctrl-C to stop).
  --proc <surreal|server|all>   Which process(es) to show (default all).
  -n, --lines <n>           Last N lines before following (default 50).
  -h, --help

Log paths:
  surreal: ${surrealLogPath()}
  server:  ${serverLogPath()}
`;
}

export async function runLogs(args: LogsArgs): Promise<number> {
    const paths: { name: string; path: string }[] = [];
    if (args.proc === 'all' || args.proc === 'surreal') paths.push({ name: 'surreal', path: surrealLogPath() });
    if (args.proc === 'all' || args.proc === 'server')  paths.push({ name: 'server', path: serverLogPath() });

    // Missing log files = stack never started here, OR logs were rotated.
    const missing = paths.filter((p) => !fs.existsSync(p.path));
    if (missing.length === paths.length) {
        consola.info('No log files yet — did you start the stack? (smartchats start)');
        return 1;
    }
    for (const m of missing) consola.warn(`No file at ${m.path} — skipping ${m.name}.`);

    // Use system `tail` because Node has no built-in stream-tail and
    // reimplementing -F with file rotation handling is silly when /usr/bin/tail
    // exists on every platform we ship to.
    const tailArgs = ['-n', String(args.lines)];
    if (args.follow) tailArgs.push('-F');
    for (const p of paths) if (fs.existsSync(p.path)) tailArgs.push(p.path);

    const child = spawn('tail', tailArgs, { stdio: 'inherit' });
    return new Promise<number>((resolve) => {
        child.on('exit', (code) => resolve(code ?? 0));
        process.on('SIGINT', () => { child.kill('SIGTERM'); resolve(0); });
    });
}
