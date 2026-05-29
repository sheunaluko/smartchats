/**
 * Shared lifecycle state for the local stack.
 *
 * `start` writes the PID file + log files; `stop` / `restart` / `status` /
 * `logs` read them. Single source of truth for paths + the on-disk format.
 *
 * Paths (XDG-ish, no real XDG support — smartchats uses ~/.smartchats):
 *   ~/.smartchats/run/pids.json     PID + port + start time per process.
 *   ~/.smartchats/logs/surreal.log  surreal stdout/stderr (appended).
 *   ~/.smartchats/logs/server.log   smartchats-local-server stdout/stderr (appended).
 *   ~/.smartchats/data              SurrealDB persistent storage.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export function smartchatsHome(): string {
    return path.join(process.env.HOME ?? '/tmp', '.smartchats');
}

export function runDir(): string { return path.join(smartchatsHome(), 'run'); }
export function logDir(): string { return path.join(smartchatsHome(), 'logs'); }
export function pidFilePath(): string { return path.join(runDir(), 'pids.json'); }
export function defaultDataDir(): string { return path.join(smartchatsHome(), 'data'); }
export function surrealLogPath(): string { return path.join(logDir(), 'surreal.log'); }
export function serverLogPath(): string { return path.join(logDir(), 'server.log'); }

export interface ProcRecord {
    pid: number;
    port: number;
    startedAt: string;
}

export interface PidFile {
    version: 1;
    surreal: ProcRecord;
    server: ProcRecord;
}

export function readPidFile(): PidFile | null {
    const file = pidFilePath();
    if (!fs.existsSync(file)) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as PidFile;
        if (raw?.version !== 1 || !raw.surreal?.pid || !raw.server?.pid) return null;
        return raw;
    } catch {
        return null;
    }
}

export function writePidFile(rec: PidFile): void {
    fs.mkdirSync(runDir(), { recursive: true });
    fs.writeFileSync(pidFilePath(), JSON.stringify(rec, null, 2) + '\n', { mode: 0o600 });
}

export function removePidFile(): void {
    try { fs.rmSync(pidFilePath()); } catch { /* */ }
}

/**
 * Probe whether a PID is alive. Signal 0 doesn't deliver — it's a presence
 * check that errors if the process doesn't exist or we lack permission.
 */
export function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Probe whether a port responds. Used to distinguish "stale PID was
 * reissued to an unrelated process" from "our stack is actually serving".
 */
export async function probePort(port: number, urlPath = '/', timeoutMs = 1000): Promise<boolean> {
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { signal: controller.signal });
        clearTimeout(t);
        return res.ok;
    } catch {
        return false;
    }
}
