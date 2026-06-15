/**
 * `sm test-release` / `sm test-release-e2e` — released-binary smoke against
 * a stock VM.
 *
 * `sm test-release <linux|mac>`
 *   1. Spin up the matching VM via runVm(['up', name]) if not already up
 *      (runs the canonical `curl smartchats.ai/install | bash` flow).
 *   2. Start the stack inside the VM (`smartchats start --no-prompt`),
 *      skip if already healthy.
 *   3. For Tart (mac): set up a persistent `ssh -L 3000:localhost:3000`
 *      tunnel so the VM's stack is reachable at host's localhost:3000.
 *      PID is recorded so `sm vm down mac` can clean it up.
 *   4. Print URL + how to stop. Returns 0 with the stack still running.
 *
 * `sm test-release-e2e <linux|mac>`
 *   Same prep, then runs `bin/test-e2e --skip-deploy` so the Playwright
 *   simi suite hits the VM-served stack. Returns the test exit code.
 *   VM stays up after the run (intentional — lets you inspect failures
 *   via `sm vm into <name>`; tear down with `sm vm down <name>`).
 *
 * The skip-deploy mode in bin/test-e2e is what makes this work — it
 * bypasses the local bin/test-bun-deploy launch and assumes localhost
 * :3000 is already serving the stack under test.
 */

import { spawn, execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import consola from 'consola';

import { detectRepo } from '../lib/context.js';
import { runVm } from './vm.js';

// ──────────────────────────────────────────────────────────────────────────
// Help
// ──────────────────────────────────────────────────────────────────────────

export const testReleaseHelp = `sm test-release <linux|mac> [options]

Install + run the released smartchats binary inside a fresh VM, leave the
stack up at http://localhost:3000 so you can drive a headed browser
against it.

Composition:
  1. sm vm up <name>               (idempotent; uses curl|install path)
  2. Wipe ~/.smartchats/{data,run,logs,sessions} inside the VM
                                   (default; --keep-state to preserve)
  3. ssh in, smartchats start      (skip if already healthy)
  4. Tart only: open ssh -L 3000:localhost:3000 tunnel
  5. Print URL, return 0

Options:
  --keep-state  Preserve any prior surreal data / sessions / logs in the
                VM. Default is "wipe, fresh-user feel" so re-runs mirror
                a stock first-boot experience. Use this when you want
                to test "day-N usage" behaviour.
  --fresh       Destroy AND reclone the VM image (heaviest reset; ~3-5
                min). --keep-state has no effect when --fresh is set.
  --no-keys     Skip API key injection.
  -h, --help

Stop the stack via \`sm vm down <name>\` — that also tears down the SSH
tunnel for Tart.
`;

export const testReleaseE2eHelp = `sm test-release-e2e <linux|mac> [options]

Same prep as \`sm test-release\` (boot VM, install released binary, start
stack — wiping prior state by default), then runs the full Playwright
simi e2e suite against the VM-served stack via
\`bin/test-e2e --skip-deploy\`.

VM stays up after the run so you can inspect failures with
\`sm vm into <name>\`. Tear down with \`sm vm down <name>\`.

Options:
  --keep-state  Preserve prior surreal data / sessions / logs in the VM.
                Default is "wipe, fresh-user feel."
  --fresh       Destroy AND reclone the VM image.
  --no-keys     Skip API key injection.
  --            Forward remaining args to bin/test-e2e (e.g. --headed,
                --grep <wf>).
  -h, --help
`;

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const VM_STATE_DIR = path.join(os.homedir(), '.smartchats', 'vm-state');

function tunnelPidPath(name: string): string {
    return path.join(VM_STATE_DIR, `${name}.tunnel.pid`);
}

function which(cmd: string): string | null {
    try { return execFileSync('which', [cmd], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}

function localhostHealthy(): boolean {
    try {
        execFileSync('curl', ['-sf', '--max-time', '2', 'http://localhost:3000/local-api/health'], {
            stdio: 'pipe', timeout: 4000,
        });
        return true;
    } catch { return false; }
}

async function pollHealthy(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (localhostHealthy()) return true;
        await new Promise(r => setTimeout(r, 1500));
    }
    return false;
}

function spawnInherit(cmd: string, args: string[]): Promise<number> {
    return new Promise(resolve => {
        const child = spawn(cmd, args, { stdio: 'inherit' });
        child.on('exit', code => resolve(code ?? 1));
        child.on('error', err => { consola.error(`spawn ${cmd}: ${err.message}`); resolve(127); });
    });
}

// ──────────────────────────────────────────────────────────────────────────
// VM-specific glue
// ──────────────────────────────────────────────────────────────────────────

type Platform = 'linux' | 'mac';

function parsePlatform(arg: string | undefined): Platform | null {
    if (arg === 'linux' || arg === 'mac') return arg;
    return null;
}

/**
 * The full set of paths inside ~/.smartchats that accumulate state
 * across runs — surreal data + run state + per-process logs + saved
 * sessions. Wiping all four gives a stock-fresh-boot feel.
 */
const SMARTCHATS_STATE_PATHS = '~/.smartchats/data ~/.smartchats/run ~/.smartchats/logs ~/.smartchats/sessions';

/** Lima VM has portForwards in its YAML — localhost:3000 just works after up. */
async function startLimaStack(name: string, opts: { keepState: boolean }): Promise<number> {
    // Wipe before checking health — if there's prior state, the running
    // stack is using it; we want to stop it AND wipe.
    if (!opts.keepState) {
        consola.info(`[lima] wiping prior state (--keep-state to preserve)`);
        await spawnInherit('limactl', [
            'shell', '--workdir', '/work', name, 'bash', '-lc',
            `smartchats stop 2>/dev/null || true; rm -rf ${SMARTCHATS_STATE_PATHS}`,
        ]);
    } else if (localhostHealthy()) {
        consola.info(`[lima] stack already healthy at http://localhost:3000 (--keep-state)`);
        return 0;
    }
    consola.start(`[lima] starting smartchats inside ${name}`);
    const exit = await spawnInherit('limactl', [
        'shell', '--workdir', '/work', name,
        'bash', '-lc', 'smartchats start --no-prompt',
    ]);
    if (exit !== 0) return exit;
    consola.info('[lima] polling health…');
    const healthy = await pollHealthy(30_000);
    if (!healthy) { consola.fail('[lima] stack did not become healthy within 30s'); return 1; }
    consola.success(`[lima] stack ready at http://localhost:3000`);
    return 0;
}

/**
 * Tart needs an explicit SSH tunnel to make VM:3000 reachable at host
 * localhost:3000. We detach the tunnel so it survives this command's
 * exit; PID is recorded so `sm vm down mac` can clean up.
 */
async function startTartStack(name: string, opts: { keepState: boolean }): Promise<number> {
    const vmKeysDir = path.join(os.homedir(), '.smartchats', 'vm-keys');
    const privateKey = path.join(vmKeysDir, 'id_smartchats');
    if (!fs.existsSync(privateKey)) {
        consola.error(`[tart] no host key at ${privateKey} — run \`sm vm up ${name}\` first to bootstrap.`);
        return 1;
    }
    // Resolve VM IP.
    let ip = '';
    try { ip = execFileSync('tart', ['ip', name], { encoding: 'utf8' }).trim(); } catch { /* */ }
    if (!ip) { consola.error(`[tart] could not resolve IP for ${name}; is it running?`); return 1; }

    const sshBase = [
        '-i', privateKey,
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'LogLevel=ERROR',
        `admin@${ip}`,
    ];

    if (!opts.keepState) {
        consola.info(`[tart] wiping prior state (--keep-state to preserve)`);
        await spawnInherit('ssh', [
            ...sshBase, 'bash', '-l', '-c',
            `smartchats stop 2>/dev/null || true; rm -rf ${SMARTCHATS_STATE_PATHS}`,
        ]);
    } else if (localhostHealthy()) {
        consola.info('[tart] localhost:3000 already responding — checking if tunnel still alive');
    }

    // Start the stack inside the VM via ssh (login shell for PATH).
    if (!localhostHealthy()) {
        consola.start(`[tart] starting smartchats inside ${name}`);
        const startExit = await spawnInherit('ssh', [
            ...sshBase, 'bash', '-l', '-c', 'smartchats start --no-prompt',
        ]);
        if (startExit !== 0) return startExit;
    }

    // Open the tunnel (idempotent — check the saved PID first).
    fs.mkdirSync(VM_STATE_DIR, { recursive: true });
    const existingPid = (() => {
        try { return parseInt(fs.readFileSync(tunnelPidPath(name), 'utf8'), 10); } catch { return 0; }
    })();
    if (existingPid && processAlive(existingPid)) {
        consola.info(`[tart] tunnel already running (pid ${existingPid})`);
    } else {
        consola.start(`[tart] opening ssh -L 3000:localhost:3000 → ${ip}`);
        const tunnel = spawn('ssh', [
            '-N',
            '-L', '3000:localhost:3000',
            '-i', privateKey,
            '-o', 'StrictHostKeyChecking=no',
            '-o', 'UserKnownHostsFile=/dev/null',
            '-o', 'ExitOnForwardFailure=yes',
            '-o', 'LogLevel=ERROR',
            `admin@${ip}`,
        ], { detached: true, stdio: 'ignore' });
        tunnel.unref();
        if (tunnel.pid) fs.writeFileSync(tunnelPidPath(name), String(tunnel.pid));
        consola.info(`[tart] tunnel pid ${tunnel.pid} → ${tunnelPidPath(name)}`);
    }

    // Wait for forwarded port to be healthy from host's perspective.
    consola.info('[tart] polling localhost:3000…');
    const ready = await pollHealthy(20_000);
    if (!ready) { consola.fail('[tart] tunnel not healthy after 20s'); return 1; }
    consola.success(`[tart] stack reachable at http://localhost:3000 (tunnel → ${ip})`);
    return 0;
}

function processAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

// ──────────────────────────────────────────────────────────────────────────
// Public: cleanup hook (called by vm.ts when bringing a VM down)
// ──────────────────────────────────────────────────────────────────────────

export function killVmTunnel(name: string): void {
    const p = tunnelPidPath(name);
    try {
        const pid = parseInt(fs.readFileSync(p, 'utf8'), 10);
        if (pid && processAlive(pid)) {
            consola.info(`[vm] killing tunnel pid ${pid}`);
            process.kill(pid, 'SIGTERM');
        }
        fs.unlinkSync(p);
    } catch { /* no tunnel recorded */ }
}

// ──────────────────────────────────────────────────────────────────────────
// Command runners
// ──────────────────────────────────────────────────────────────────────────

async function ensureVmAndStack(
    platform: Platform,
    opts: { fresh: boolean; noKeys: boolean; keepState: boolean },
): Promise<number> {
    // 1. VM up.
    const upArgs = ['up', platform];
    if (opts.fresh) upArgs.push('--fresh');
    if (opts.noKeys) upArgs.push('--no-keys');
    const upExit = await runVm(upArgs);
    if (upExit !== 0) return upExit;

    // 2. Stack up inside the VM (platform-specific networking).
    //    --fresh implies clean state already (whole VM reclone), so the
    //    keep-state flag is moot in that case.
    const keepState = opts.fresh ? true : opts.keepState;
    if (platform === 'linux') return startLimaStack(platform, { keepState });
    if (platform === 'mac') return startTartStack(platform, { keepState });
    return 1;
}

export async function runTestRelease(argv: string[]): Promise<number> {
    if (argv.includes('-h') || argv.includes('--help')) { console.log(testReleaseHelp); return 0; }
    const platform = parsePlatform(argv.find(a => !a.startsWith('--')));
    if (!platform) {
        consola.error('Usage: sm test-release <linux|mac>');
        return 1;
    }
    const fresh = argv.includes('--fresh');
    const noKeys = argv.includes('--no-keys');
    const keepState = argv.includes('--keep-state');

    const exit = await ensureVmAndStack(platform, { fresh, noKeys, keepState });
    if (exit !== 0) return exit;

    console.log('');
    consola.success('Released smartchats running at http://localhost:3000');
    consola.info(`  Launch a browser against it: open http://localhost:3000`);
    consola.info(`  Shell into the VM:           sm vm into ${platform}`);
    consola.info(`  Stop everything:             sm vm down ${platform}`);
    return 0;
}

export async function runTestReleaseE2e(argv: string[]): Promise<number> {
    if (argv.includes('-h') || argv.includes('--help')) { console.log(testReleaseE2eHelp); return 0; }
    const platform = parsePlatform(argv.find(a => !a.startsWith('--')));
    if (!platform) {
        consola.error('Usage: sm test-release-e2e <linux|mac>');
        return 1;
    }
    const fresh = argv.includes('--fresh');
    const noKeys = argv.includes('--no-keys');
    const keepState = argv.includes('--keep-state');

    // Forward args after `--` to bin/test-e2e. Preserve the `--`
    // separator so test-e2e's own arg parser knows where its flags end
    // and Playwright's begin (e.g. `-- --grep basic_chat_flow`).
    const dashDash = argv.indexOf('--');
    const e2ePassthrough = dashDash >= 0 ? ['--', ...argv.slice(dashDash + 1)] : [];

    // bin/test-e2e lives in the open repo. Use the same SMARTCHATS_PATH-
    // aware lookup as the vm subcommands so this works from cloud too.
    const openRoot = [
        process.env.SMARTCHATS_PATH,
        path.join(os.homedir(), 'dev', 'smartchats'),
        detectRepo().root ?? undefined,
    ]
        .filter((p): p is string => !!p)
        .find(p => fs.existsSync(path.join(p, 'bin/test-e2e')));
    if (!openRoot) {
        consola.error('bin/test-e2e not found in $SMARTCHATS_PATH, ~/dev/smartchats, or current repo.');
        return 1;
    }
    const e2eScript = path.join(openRoot, 'bin/test-e2e');
    if (!which('curl')) { consola.error('curl is required for health probes; install via brew install curl.'); return 1; }

    const prep = await ensureVmAndStack(platform, { fresh, noKeys, keepState });
    if (prep !== 0) return prep;

    consola.start(`Running bin/test-e2e --skip-deploy against ${platform} VM`);
    const exit = await spawnInherit(e2eScript, ['--skip-deploy', ...e2ePassthrough]);

    if (exit === 0) {
        consola.success(`e2e suite passed against ${platform} VM`);
    } else {
        consola.fail(`e2e suite exited ${exit}`);
        consola.info(`  Inspect via:  sm vm into ${platform}`);
        consola.info(`  Logs:         data/logs/test-e2e-deploy.log (open: localhost:3000 via VM)`);
    }
    consola.info(`VM left running. Stop with: sm vm down ${platform}`);
    return exit;
}
