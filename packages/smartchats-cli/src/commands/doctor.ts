/**
 * `smartchats doctor` — diagnostic health check.
 *
 * Runs a series of checks and prints a status table. Exits 0 if every
 * critical check passes, 1 otherwise. Soft warnings (e.g. "no LLM key
 * configured") don't fail the exit code.
 *
 * Checks (in order):
 *   1. Context detection             — where is the repo?
 *   2. Docker installed              — critical
 *   3. AIO image present             — informational (rebuild required if missing)
 *   4. Container `smartchats` running — informational
 *   5. localhost:<port> responds 2xx — critical when container is supposed to be up
 *   6. Response body contains "smartchats" marker — sanity (catches wrong-port collisions)
 *   7. At least one LLM provider key reachable — soft warning
 *
 * The set of "expected to be up" checks adjusts based on whether a
 * container is running: if no container, we don't complain that port 3000
 * is silent.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import consola from 'consola';

import { detectContext, describeContext, type SmartChatsContext } from '../lib/context.js';
import { loadConfig } from '../lib/config.js';

type Severity = 'critical' | 'warn' | 'info';
type Status = 'pass' | 'fail' | 'skip' | 'warn';

interface CheckResult {
    name: string;
    status: Status;
    severity: Severity;
    note?: string;
}

interface DoctorOptions {
    port: number;
    json: boolean;
}

const PROVIDER_KEYS = [
    ['OpenAI', 'OPENAI_API_KEY', 'SMARTCHATS_OPENAI_API_KEY'],
    ['Anthropic', 'ANTHROPIC_API_KEY', 'SMARTCHATS_ANTHROPIC_API_KEY'],
    ['Google', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'SMARTCHATS_GOOGLE_API_KEY'],
] as const;

export function parseDoctorArgs(rest: string[]): DoctorOptions {
    const opts: DoctorOptions = { port: 3000, json: false };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--port') opts.port = parseInt(rest[++i], 10);
        else if (a === '--json') opts.json = true;
        else if (a === '-h' || a === '--help') {
            console.log(doctorHelp());
            process.exit(0);
        }
    }
    return opts;
}

export function doctorHelp(): string {
    return `smartchats doctor — diagnostic health check

Usage:
  smartchats doctor [options]

Options:
  --port <n>   Port to probe for the running stack (default 3000).
  --json       Emit machine-readable JSON instead of the pretty table.
  -h, --help   Show this help.

Exits 0 if every critical check passes, 1 otherwise. Warnings don't fail.
`;
}

function checkDockerInstalled(): CheckResult {
    const r = spawnSync('docker', ['version'], { stdio: 'ignore' });
    if (r.status === 0) return { name: 'Docker installed', status: 'pass', severity: 'critical' };
    return {
        name: 'Docker installed',
        status: 'fail',
        severity: 'critical',
        note: 'install Docker Desktop or `docker` CLI',
    };
}

function checkImagePresent(tag = 'smartchats-aio:latest'): CheckResult {
    const r = spawnSync('docker', ['image', 'inspect', tag], { stdio: 'ignore' });
    if (r.status === 0) return { name: `Image ${tag}`, status: 'pass', severity: 'info' };
    return {
        name: `Image ${tag}`,
        status: 'fail',
        severity: 'info',
        note: 'run `smartchats launch` to build it',
    };
}

function checkContainerRunning(name = 'smartchats'): CheckResult {
    const r = spawnSync(
        'docker',
        ['ps', '--filter', `name=^${name}$`, '--filter', 'status=running', '--format', '{{.ID}}'],
        { encoding: 'utf8' },
    );
    const id = (r.stdout ?? '').trim();
    if (id) {
        return { name: `Container '${name}' running`, status: 'pass', severity: 'info', note: id.slice(0, 12) };
    }
    return { name: `Container '${name}' running`, status: 'fail', severity: 'info', note: 'not running' };
}

async function probeHttp(port: number, timeoutMs = 2000): Promise<{ ok: boolean; status?: number; body?: string; err?: string }> {
    const url = `http://localhost:${port}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        const body = await res.text().catch(() => '');
        return { ok: res.ok, status: res.status, body };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, err: msg };
    } finally {
        clearTimeout(t);
    }
}

async function checkPortResponds(port: number, gateOnContainer: boolean): Promise<CheckResult[]> {
    const probe = await probeHttp(port);
    const portCheck: CheckResult = probe.ok
        ? {
            name: `http://localhost:${port} responds`,
            status: 'pass',
            severity: gateOnContainer ? 'info' : 'critical',
            note: `HTTP ${probe.status}`,
        }
        : {
            name: `http://localhost:${port} responds`,
            status: 'fail',
            severity: gateOnContainer ? 'info' : 'critical',
            note: probe.err ?? `HTTP ${probe.status ?? '?'}`,
        };

    // Marker check only runs if HTTP came back.
    let markerCheck: CheckResult;
    if (probe.ok && probe.body) {
        const hasMarker = /smartchats/i.test(probe.body);
        markerCheck = hasMarker
            ? { name: 'Response is SmartChats', status: 'pass', severity: 'critical' }
            : {
                name: 'Response is SmartChats',
                status: 'fail',
                severity: 'critical',
                note: 'page does not mention "smartchats" — wrong server on this port?',
            };
    } else {
        markerCheck = { name: 'Response is SmartChats', status: 'skip', severity: 'critical', note: 'no response to inspect' };
    }

    return [portCheck, markerCheck];
}

function readDotenvAtRoot(root: string): Record<string, string> {
    const file = path.join(root, '.env');
    if (!fs.existsSync(file)) return {};
    const out: Record<string, string> = {};
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        out[key] = val;
    }
    return out;
}

function checkProviderKeys(ctx: SmartChatsContext): CheckResult {
    const dotenv = ctx.root ? readDotenvAtRoot(ctx.root) : {};
    const found: string[] = [];
    for (const [label, ...names] of PROVIDER_KEYS) {
        for (const n of names) {
            if (process.env[n] || dotenv[n]) { found.push(label); break; }
        }
    }
    if (found.length > 0) {
        return { name: 'LLM provider keys', status: 'pass', severity: 'warn', note: `found: ${found.join(', ')}` };
    }
    return {
        name: 'LLM provider keys',
        status: 'warn',
        severity: 'warn',
        note: 'no keys found — agents will not be able to call an LLM',
    };
}

function checkContextDetected(ctx: SmartChatsContext): CheckResult {
    return {
        name: 'SmartChats context',
        status: 'pass',
        severity: 'info',
        note: describeContext(ctx),
    };
}

export async function runDoctor(opts: DoctorOptions): Promise<number> {
    const ctx = detectContext(process.cwd());
    const cfg = loadConfig();
    const port = opts.port ?? cfg.lastUsedPort ?? 3000;

    const results: CheckResult[] = [];
    results.push(checkContextDetected(ctx));

    const docker = checkDockerInstalled();
    results.push(docker);

    let containerUp = false;
    if (docker.status === 'pass') {
        results.push(checkImagePresent());
        const cstate = checkContainerRunning();
        results.push(cstate);
        containerUp = cstate.status === 'pass';
    } else {
        results.push({ name: 'Image smartchats-aio:latest', status: 'skip', severity: 'info', note: 'docker not available' });
        results.push({ name: "Container 'smartchats' running", status: 'skip', severity: 'info', note: 'docker not available' });
    }

    // Port checks: severity depends on whether a container is up. If no
    // container is running, silence on port 3000 is normal — soft signal.
    const portResults = await checkPortResponds(port, /* gateOnContainer = */ !containerUp);
    results.push(...portResults);

    results.push(checkProviderKeys(ctx));

    if (opts.json) {
        const exit = results.some(r => r.status === 'fail' && r.severity === 'critical') ? 1 : 0;
        console.log(JSON.stringify({ exit, results, contextMode: ctx.mode, port }, null, 2));
        return exit;
    }

    printTable(results);
    const failures = results.filter(r => r.status === 'fail' && r.severity === 'critical');
    if (failures.length > 0) {
        consola.fail(`${failures.length} critical check(s) failed.`);
        return 1;
    }
    consola.success('All critical checks passed.');
    return 0;
}

function statusIcon(s: Status): string {
    switch (s) {
        case 'pass': return '✓';
        case 'fail': return '✗';
        case 'skip': return '–';
        case 'warn': return '!';
    }
}

function printTable(results: CheckResult[]): void {
    const nameWidth = Math.max(...results.map(r => r.name.length), 10);
    console.log('');
    for (const r of results) {
        const icon = statusIcon(r.status);
        const note = r.note ? `  ${r.note}` : '';
        console.log(`  ${icon}  ${r.name.padEnd(nameWidth)}${note}`);
    }
    console.log('');
}
