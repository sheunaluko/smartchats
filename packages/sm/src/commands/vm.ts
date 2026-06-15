/**
 * `sm vm <subcmd>` — local VM lifecycle.
 *
 * Two drivers, picked by VM name:
 *   lima/  — Linux VMs (Ubuntu 24.04). Fast (~30s boot), preferred.
 *   tart/  — macOS VMs (Sonoma). Apple Silicon only, slower first boot
 *            (Tart pulls a multi-GiB image once).
 *
 * Verbs (v1): up | into | down | test
 *
 * Host keys at ~/.smartchats/keys.env get injected into the VM
 * environment on every boot — never written to disk inside the VM. See
 * infra/vms/README.md for the format + why.
 *
 * `sm vm test <name>` is the smoke verb: boots, installs (via provision
 * script), runs bin/simi-smoke against the running stack, reports.
 */

import { spawn, execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import consola from 'consola';

import { detectRepo } from '../lib/context.js';

// ──────────────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────────────

type Driver = 'lima' | 'tart';

interface VMConfig {
    name: string;
    driver: Driver;
    /** Relative path under <repo>/infra/vms/, e.g. 'lima/linux.yaml'. */
    configPath: string;
    /** Provision script relative path. */
    provisionPath: string;
    description: string;
}

const VM_REGISTRY: Record<string, VMConfig> = {
    linux: {
        name: 'linux',
        driver: 'lima',
        configPath: 'infra/vms/lima/linux.yaml',
        provisionPath: 'infra/vms/lima/provision.sh',
        description: 'Ubuntu 24.04, fresh. Fast (~30s boot). Default.',
    },
    mac: {
        name: 'mac',
        driver: 'tart',
        configPath: 'infra/vms/tart/mac.yaml',
        provisionPath: 'infra/vms/tart/provision.sh',
        description: 'macOS Sonoma. Apple Silicon only. Slow first boot.',
    },
};

// ──────────────────────────────────────────────────────────────────────────
// Help
// ──────────────────────────────────────────────────────────────────────────

export const vmHelp = `sm vm <subcmd> [name] [options]

Local VM lifecycle for smoke testing fresh installs. Two drivers, picked
by name: \`linux\` → Lima (Ubuntu 24.04), \`mac\` → Tart (macOS Sonoma).

Subcommands:
  list                     Show registered VMs + their state.
  up <name>                Boot (idempotent — reuses if already up). Injects
                           keys from ~/.smartchats/keys.env unless --no-keys.
  into <name>              Shell into the VM. Repo mounted at /work
                           (Linux) or ~/work (macOS). Keys auto-loaded.
  down <name>              Stop, keep the disk for next \`up\`.
  test <name>              Compose: up + bin/simi-smoke against the stack.
                           Reports pass/fail and platform info.

Options:
  --no-keys                Skip key injection (for clean snapshots).
  --fresh                  Destroy VM before up — useful when provision
                           changed and you want it re-run.
  -h, --help

Registered VMs:
${Object.values(VM_REGISTRY).map(v => `  ${v.name.padEnd(8)} ${v.driver.padEnd(5)} — ${v.description}`).join('\n')}

Examples:
  sm vm up linux
  sm vm into linux
  sm vm test linux
  sm vm down linux

Host keys file: ~/.smartchats/keys.env (one KEY=value per line). See
infra/vms/README.md.
`;

// ──────────────────────────────────────────────────────────────────────────
// Driver capability check
// ──────────────────────────────────────────────────────────────────────────

function which(cmd: string): string | null {
    try {
        return execFileSync('which', [cmd], { encoding: 'utf8' }).trim() || null;
    } catch {
        return null;
    }
}

function checkDriver(driver: Driver): { ok: true } | { ok: false; install: string } {
    if (driver === 'lima') {
        if (which('limactl')) return { ok: true };
        return { ok: false, install: 'brew install lima' };
    }
    if (driver === 'tart') {
        if (which('tart')) return { ok: true };
        return { ok: false, install: 'brew install cirruslabs/cli/tart' };
    }
    return { ok: false, install: `unknown driver: ${driver}` };
}

// ──────────────────────────────────────────────────────────────────────────
// Host keys
// ──────────────────────────────────────────────────────────────────────────

const KEYS_FILE = path.join(os.homedir(), '.smartchats', 'keys.env');

// ──────────────────────────────────────────────────────────────────────────
// Tart SSH key bootstrap
// ──────────────────────────────────────────────────────────────────────────
//
// Tart uses ssh for both provisioning and `into`. The base image authenticates
// admin/admin by password, which means our first hop into a fresh VM needs to
// push a password. We avoid the sshpass dependency entirely:
//
//   1. On first run, generate a dedicated keypair at ~/.smartchats/vm-keys/
//   2. Bootstrap into the VM ONCE via macOS's built-in `expect` to push the
//      public key into ~admin/.ssh/authorized_keys.
//   3. Every operation after that uses `ssh -i <key>` and never sees a
//      password. The bootstrap is detected via a BatchMode probe — if the
//      key already works, we skip the expect step entirely.

const VM_KEYS_DIR = path.join(os.homedir(), '.smartchats', 'vm-keys');
const VM_PRIVATE_KEY = path.join(VM_KEYS_DIR, 'id_smartchats');
const VM_PUBLIC_KEY = path.join(VM_KEYS_DIR, 'id_smartchats.pub');

function ensureVmKeypair(): void {
    if (fs.existsSync(VM_PRIVATE_KEY) && fs.existsSync(VM_PUBLIC_KEY)) return;
    fs.mkdirSync(VM_KEYS_DIR, { recursive: true });
    fs.chmodSync(VM_KEYS_DIR, 0o700);
    consola.info(`[vm-keys] generating ed25519 keypair at ${VM_PRIVATE_KEY}`);
    execFileSync('ssh-keygen', [
        '-t', 'ed25519',
        '-f', VM_PRIVATE_KEY,
        '-N', '',                    // no passphrase
        '-C', 'sm-vm-bootstrap',
        '-q',
    ]);
    fs.chmodSync(VM_PRIVATE_KEY, 0o600);
}

function canSshWithKey(ip: string, user: string, port = 22): boolean {
    try {
        execFileSync('ssh', [
            '-i', VM_PRIVATE_KEY,
            '-p', String(port),
            '-o', 'StrictHostKeyChecking=no',
            '-o', 'UserKnownHostsFile=/dev/null',
            '-o', 'BatchMode=yes',           // no password prompts
            '-o', 'ConnectTimeout=5',
            '-o', 'LogLevel=ERROR',
            `${user}@${ip}`, 'true',
        ], { stdio: 'pipe', timeout: 10_000 });
        return true;
    } catch {
        return false;
    }
}

async function bootstrapVmKey(ip: string, user: string, password: string): Promise<number> {
    ensureVmKeypair();
    const pubkey = fs.readFileSync(VM_PUBLIC_KEY, 'utf8').trim();
    // The remote command: ensure ~/.ssh exists, append our key idempotently.
    const remoteCmd = [
        'mkdir -p ~/.ssh',
        'chmod 700 ~/.ssh',
        'touch ~/.ssh/authorized_keys',
        'chmod 600 ~/.ssh/authorized_keys',
        `grep -qxF '${pubkey}' ~/.ssh/authorized_keys || echo '${pubkey}' >> ~/.ssh/authorized_keys`,
    ].join(' && ');

    // Use expect to drive the one-time password prompt. macOS ships expect
    // at /usr/bin/expect; no install required.
    const expectScript = `
set timeout 30
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PreferredAuthentications=password -o PubkeyAuthentication=no ${user}@${ip} "${remoteCmd.replace(/"/g, '\\"').replace(/\$/g, '\\$')}"
expect {
    -re "(?i)password:" { send "${password}\\r"; exp_continue }
    eof
}
catch wait result
exit [lindex \\$result 3]
`;
    return new Promise(resolve => {
        const child = spawn('expect', ['-c', expectScript], { stdio: ['pipe', 'inherit', 'inherit'] });
        child.on('exit', code => resolve(code ?? 1));
        child.on('error', err => { consola.error(`expect failed: ${err.message}`); resolve(127); });
    });
}

/** ssh args common to all our connections (after bootstrap).
 *
 * When a command is given, wraps it in `bash -l -c '<cmd>'` — a login
 * shell. macOS reads /etc/paths.d/* via path_helper(8) on login-shell
 * startup, which is how /usr/local/bin enters PATH for non-interactive
 * ssh. Without this wrap, `ssh user@vm smartchats start` fails with
 * "command not found" even though the binary is symlinked.
 *
 * Interactive shells (no command) skip the wrap — ssh picks the user's
 * default login shell, which is already login-mode.
 */
function sshArgs(user: string, ip: string, command?: string): string[] {
    const base = [
        '-i', VM_PRIVATE_KEY,
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'LogLevel=ERROR',
        `${user}@${ip}`,
    ];
    if (!command) return base;
    // Wrap in login shell so /etc/paths.d/* and /etc/profile.d/* apply.
    return [...base, 'bash', '-l', '-c', command];
}
const ALLOWED_KEY_NAMES = new Set([
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
]);

function readHostKeys(): { keys: Record<string, string>; source: string } {
    const out: Record<string, string> = {};
    let source = 'none';

    // Canonical location first.
    if (fs.existsSync(KEYS_FILE)) {
        const raw = fs.readFileSync(KEYS_FILE, 'utf8');
        for (const line of raw.split('\n')) {
            const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
            if (!m) continue;
            const [, k, v] = m;
            if (!k || !v) continue;
            if (!ALLOWED_KEY_NAMES.has(k)) continue;
            out[k] = v.replace(/^["']|["']$/g, '');
        }
        if (Object.keys(out).length > 0) source = `~/.smartchats/keys.env`;
    }

    // Fallback: shell env. Useful before the user has bootstrapped the
    // canonical file — every key the shell has gets picked up.
    if (Object.keys(out).length === 0) {
        for (const k of ALLOWED_KEY_NAMES) {
            const v = process.env[k];
            if (v) out[k] = v;
        }
        if (Object.keys(out).length > 0) source = 'shell env';
    }

    return { keys: out, source };
}

// ──────────────────────────────────────────────────────────────────────────
// Lima driver
// ──────────────────────────────────────────────────────────────────────────

function spawnInherit(cmd: string, args: string[], extraEnv: Record<string, string> = {}): Promise<number> {
    return new Promise(resolve => {
        const child = spawn(cmd, args, {
            stdio: 'inherit',
            env: { ...process.env, ...extraEnv },
        });
        child.on('exit', code => resolve(code ?? 1));
        child.on('error', err => { consola.error(`spawn ${cmd}: ${err.message}`); resolve(127); });
        const fwd = (sig: NodeJS.Signals) => child.kill(sig);
        process.on('SIGINT', fwd);
        process.on('SIGTERM', fwd);
    });
}

/**
 * Lima's `limactl shell` auto-CDs to the host's pwd inside the guest.
 * Since the repo is mounted at /work (not the host's absolute path), every
 * shell invocation emits `cd: /Users/.../dev/smartchats: No such file`
 * noise. --workdir overrides the auto-CD with a path that exists in the
 * guest. Centralizing here so all invocations get the same treatment.
 */
const LIMA_DEFAULT_WORKDIR = '/work';

function limaShellArgs(name: string, command?: string): string[] {
    const base = ['shell', '--workdir', LIMA_DEFAULT_WORKDIR, name];
    if (!command) return base;
    return [...base, 'bash', '-c', command];
}

function limactlIsRunning(name: string): boolean {
    try {
        const out = execFileSync('limactl', ['list', '--format', '{{.Name}} {{.Status}}'], { encoding: 'utf8' });
        return out.split('\n').some(line => line.startsWith(`${name} `) && line.endsWith(' Running'));
    } catch {
        return false;
    }
}

function limactlExists(name: string): boolean {
    try {
        const out = execFileSync('limactl', ['list', '--format', '{{.Name}}'], { encoding: 'utf8' });
        return out.split('\n').includes(name);
    } catch {
        return false;
    }
}

async function limaUp(cfg: VMConfig, repoRoot: string, opts: { fresh: boolean; injectKeys: boolean }): Promise<number> {
    const ymlPath = path.join(repoRoot, cfg.configPath);
    if (!fs.existsSync(ymlPath)) {
        consola.error(`Lima config not found: ${ymlPath}`);
        return 2;
    }

    if (opts.fresh && limactlExists(cfg.name)) {
        consola.info(`[lima] destroying existing VM (--fresh): ${cfg.name}`);
        await spawnInherit('limactl', ['delete', '-f', cfg.name]);
    }

    if (limactlIsRunning(cfg.name)) {
        consola.info(`[lima] already running: ${cfg.name}`);
    } else if (limactlExists(cfg.name)) {
        consola.info(`[lima] starting existing VM: ${cfg.name}`);
        const exit = await spawnInherit('limactl', ['start', cfg.name]);
        if (exit !== 0) return exit;
    } else {
        consola.start(`[lima] creating + starting: ${cfg.name}`);
        const exit = await spawnInherit('limactl', ['start', `--name=${cfg.name}`, ymlPath]);
        if (exit !== 0) return exit;
    }

    // Run provision (idempotent). Inject keys via env passed to limactl shell.
    if (opts.injectKeys) {
        const { keys: keyMap, source } = readHostKeys();
        if (Object.keys(keyMap).length === 0) {
            consola.warn(`No keys found (checked ${KEYS_FILE} + shell env). VM will boot without API keys.`);
            consola.info(`Create ${KEYS_FILE} with KEY=value lines (OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY).`);
        } else {
            consola.info(`[${cfg.driver}] injecting ${Object.keys(keyMap).length} keys from ${source} into ${cfg.name}`);
        }
        const keys = keyMap;
        const provisionRel = cfg.provisionPath;
        const provisionGuest = `/work/${provisionRel}`;
        consola.start('[lima] running provision script');
        // limactl shell doesn't forward host env to the guest. Inline the
        // keys into the remote bash command so they reach the script as
        // actual env vars regardless of shell forwarding behaviour.
        const keyValues = keys;
        const envInline = Object.entries(keyValues)
            .map(([k, v]) => `${k}=${shellQuote(v)}`)
            .join(' ');
        const remoteCmd = envInline
            ? `${envInline} bash ${provisionGuest}`
            : `bash ${provisionGuest}`;
        const exit = await spawnInherit('limactl', limaShellArgs(cfg.name, remoteCmd));
        if (exit !== 0) { consola.fail('[lima] provision failed'); return exit; }
    }

    consola.success(`[lima] ${cfg.name} ready. Shell in: sm vm into ${cfg.name}`);
    return 0;
}

async function limaInto(cfg: VMConfig): Promise<number> {
    if (!limactlIsRunning(cfg.name)) {
        consola.error(`[lima] ${cfg.name} is not running. Start with: sm vm up ${cfg.name}`);
        return 1;
    }
    // Interactive shell; --workdir avoids the host-pwd auto-CD noise.
    return spawnInherit('limactl', limaShellArgs(cfg.name));
}

async function limaDown(cfg: VMConfig): Promise<number> {
    if (!limactlExists(cfg.name)) {
        consola.info(`[lima] ${cfg.name} doesn't exist; nothing to stop.`);
        return 0;
    }
    return spawnInherit('limactl', ['stop', cfg.name]);
}

// ──────────────────────────────────────────────────────────────────────────
// Tart driver
// ──────────────────────────────────────────────────────────────────────────

function tartExists(name: string): boolean {
    try {
        const out = execFileSync('tart', ['list', '--format', 'json'], { encoding: 'utf8' });
        const list = JSON.parse(out) as Array<{ Name: string }>;
        return list.some(v => v.Name === name);
    } catch {
        return false;
    }
}

function tartIsRunning(name: string): boolean {
    try {
        const out = execFileSync('tart', ['list', '--format', 'json'], { encoding: 'utf8' });
        const list = JSON.parse(out) as Array<{ Name: string; State: string }>;
        return list.some(v => v.Name === name && v.State === 'running');
    } catch {
        return false;
    }
}

interface TartConfig {
    driver: 'tart';
    image: string;
    cpus?: number;
    memory_gib?: number;
    disk_gib?: number;
    port_forwards?: number[];
    mounts?: Array<{ host: string; guest: string; writable?: boolean }>;
    ssh?: { user: string; password: string };
}

function readTartConfig(ymlPath: string): TartConfig {
    // Lightweight parse — Tart configs are sm's own metadata, not Lima
    // schema. For v1 just parse the fields we need from straightforward
    // YAML. If this grows we can pull in a real parser.
    const raw = fs.readFileSync(ymlPath, 'utf8');
    const out: TartConfig = { driver: 'tart', image: '' };
    out.image = raw.match(/^image:\s*(.+)$/m)?.[1]?.trim() ?? '';
    const cp = raw.match(/^cpus:\s*(\d+)/m)?.[1]; if (cp) out.cpus = Number(cp);
    const mg = raw.match(/^memory_gib:\s*(\d+)/m)?.[1]; if (mg) out.memory_gib = Number(mg);
    const dg = raw.match(/^disk_gib:\s*(\d+)/m)?.[1]; if (dg) out.disk_gib = Number(dg);
    const su = raw.match(/^\s*user:\s*(.+)$/m)?.[1]?.trim();
    const sp = raw.match(/^\s*password:\s*(.+)$/m)?.[1]?.trim();
    if (su && sp) out.ssh = { user: su, password: sp };
    // Port forwards: simple list-of-numbers block.
    const portBlock = raw.match(/^port_forwards:\s*\n([\s\S]+?)(?=^\S|\Z)/m)?.[1];
    if (portBlock) {
        out.port_forwards = [...portBlock.matchAll(/-\s*(\d+)/g)].map(m => Number(m[1]));
    }
    // Mounts: list-of-objects block. Each item has host:/path, guest:/path,
    // writable:bool. Quick line-by-line parse — good enough for the limited
    // shape we use; if this grows we should pull in a real YAML parser.
    const mountBlock = raw.match(/^mounts:\s*\n([\s\S]+?)(?=^\S|\Z)/m)?.[1];
    if (mountBlock) {
        const mounts: TartConfig['mounts'] = [];
        let current: { host?: string; guest?: string; writable?: boolean } = {};
        for (const line of mountBlock.split('\n')) {
            if (/^\s*-\s+host:\s*(.+)$/.test(line)) {
                if (current.host && current.guest) mounts.push(current as any);
                current = {};
                current.host = line.match(/^\s*-\s+host:\s*"?([^"]+?)"?\s*$/)?.[1];
            } else if (/^\s+host:/.test(line)) {
                current.host = line.match(/^\s+host:\s*"?([^"]+?)"?\s*$/)?.[1];
            } else if (/^\s+guest:/.test(line)) {
                current.guest = line.match(/^\s+guest:\s*"?([^"]+?)"?\s*$/)?.[1];
            } else if (/^\s+writable:/.test(line)) {
                current.writable = /true/.test(line);
            }
        }
        if (current.host && current.guest) mounts.push(current as any);
        if (mounts.length) out.mounts = mounts;
    }
    return out;
}

async function tartUp(cfg: VMConfig, repoRoot: string, opts: { fresh: boolean; injectKeys: boolean }): Promise<number> {
    const ymlPath = path.join(repoRoot, cfg.configPath);
    if (!fs.existsSync(ymlPath)) {
        consola.error(`Tart config not found: ${ymlPath}`);
        return 2;
    }
    const tcfg = readTartConfig(ymlPath);

    if (opts.fresh && tartExists(cfg.name)) {
        consola.info(`[tart] destroying existing VM (--fresh): ${cfg.name}`);
        await spawnInherit('tart', ['delete', cfg.name]);
    }

    if (!tartExists(cfg.name)) {
        consola.start(`[tart] cloning ${tcfg.image} → ${cfg.name} (slow — multi-GB pull on first run)`);
        const createExit = await spawnInherit('tart', ['clone', tcfg.image, cfg.name]);
        if (createExit !== 0) return createExit;
        if (tcfg.cpus) await spawnInherit('tart', ['set', cfg.name, '--cpu', String(tcfg.cpus)]);
        if (tcfg.memory_gib) await spawnInherit('tart', ['set', cfg.name, '--memory', String(tcfg.memory_gib * 1024)]);
        if (tcfg.disk_gib) await spawnInherit('tart', ['set', cfg.name, '--disk-size', String(tcfg.disk_gib)]);
    }

    if (tartIsRunning(cfg.name)) {
        consola.info(`[tart] already running: ${cfg.name}`);
    } else {
        consola.start(`[tart] starting: ${cfg.name}`);
        // Pass --dir flags for each mount in the config. Tart mounts shared
        // folders at /Volumes/My Shared Files/<name> inside the macOS guest;
        // the in-YAML `guest` field is documentary — the actual guest path
        // is determined by Tart.
        const dirArgs: string[] = [];
        for (const m of tcfg.mounts ?? []) {
            const hostExpanded = m.host.replace(/^~/, os.homedir());
            // Tart's --dir syntax: name:path[:ro]
            const tag = (m.guest.split('/').pop() ?? 'work').toLowerCase();
            const opt = m.writable === false ? ':ro' : '';
            dirArgs.push('--dir', `${tag}:${hostExpanded}${opt}`);
        }
        // Run as a background child so we can SSH in after it boots.
        const child = spawn('tart', ['run', '--no-graphics', ...dirArgs, cfg.name], {
            detached: true,
            stdio: 'ignore',
        });
        child.unref();
        // Poll for IP — Tart needs a few seconds after `run` before it's reachable.
        const ip = await pollTartIp(cfg.name, 60_000);
        if (!ip) {
            consola.fail(`[tart] ${cfg.name} did not become reachable within 60s`);
            return 1;
        }
        consola.info(`[tart] ${cfg.name} reachable at ${ip}`);
    }

    if (opts.injectKeys) {
        const keys = readHostKeys();
        if (Object.keys(keys).length === 0) {
            consola.warn(`No keys read from ${KEYS_FILE} — VM will boot without API keys.`);
        } else {
            consola.info(`[tart] injecting ${Object.keys(keys).length} keys into ${cfg.name}`);
        }
        const exit = await tartProvision(cfg, tcfg, repoRoot, keys.keys ?? keys);
        if (exit !== 0) { consola.fail('[tart] provision failed'); return exit; }
    }

    consola.success(`[tart] ${cfg.name} ready. Shell in: sm vm into ${cfg.name}`);
    return 0;
}

async function pollTartIp(name: string, timeoutMs: number): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const ip = execFileSync('tart', ['ip', name], { encoding: 'utf8' }).trim();
            if (ip && /\d+\.\d+\.\d+\.\d+/.test(ip)) return ip;
        } catch { /* not yet */ }
        await new Promise(r => setTimeout(r, 2000));
    }
    return null;
}

async function tartProvision(
    cfg: VMConfig,
    tcfg: TartConfig,
    repoRoot: string,
    keys: Record<string, string>,
): Promise<number> {
    if (!tcfg.ssh) {
        consola.error('[tart] config missing ssh.user/ssh.password — cannot provision');
        return 1;
    }
    const ip = await pollTartIp(cfg.name, 30_000);
    if (!ip) return 1;

    // Make sure key auth is set up — bootstrap if first time on this VM.
    ensureVmKeypair();
    if (!canSshWithKey(ip, tcfg.ssh.user)) {
        consola.info(`[tart] bootstrapping ssh key on ${cfg.name} (one-time)`);
        const bootstrap = await bootstrapVmKey(ip, tcfg.ssh.user, tcfg.ssh.password);
        if (bootstrap !== 0) { consola.fail('[tart] key bootstrap failed'); return bootstrap; }
        // Verify the bootstrap took.
        if (!canSshWithKey(ip, tcfg.ssh.user)) {
            consola.fail('[tart] key bootstrap completed but probe still failed; investigate manually.');
            return 1;
        }
        consola.success('[tart] ssh key installed; password auth no longer needed');
    }

    // Tart mounts at /Volumes/My Shared Files/<tag>. The tag matches what
    // we set in dirArgs above. Resolve which tag holds the repo by
    // taking the last segment of the config's guest path.
    const mount = tcfg.mounts?.[0];
    const mountTag = mount ? (mount.guest.split('/').pop() ?? 'work').toLowerCase() : 'work';
    const mountedRoot = `/Volumes/My\\ Shared\\ Files/${mountTag}`;
    const provisionGuest = `${mountedRoot}/${cfg.provisionPath}`;
    const envPrefix = Object.entries(keys).map(([k, v]) => `${k}=${shellQuote(v)}`).join(' ');
    const remoteCmd = `${envPrefix} bash ${provisionGuest}`;
    consola.start('[tart] running provision script over ssh');
    return spawnInherit('ssh', sshArgs(tcfg.ssh.user, ip, remoteCmd));
}

function shellQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function tartInto(cfg: VMConfig): Promise<number> {
    if (!tartIsRunning(cfg.name)) {
        consola.error(`[tart] ${cfg.name} is not running. Start with: sm vm up ${cfg.name}`);
        return 1;
    }
    const ymlPath = path.join(detectRepoRoot(), cfg.configPath);
    const tcfg = readTartConfig(ymlPath);
    if (!tcfg.ssh) { consola.error('[tart] no ssh creds in config'); return 1; }
    const ip = await pollTartIp(cfg.name, 5_000);
    if (!ip) { consola.error('[tart] could not resolve IP'); return 1; }
    if (!canSshWithKey(ip, tcfg.ssh.user)) {
        consola.warn(`[tart] no key auth — run \`sm vm up ${cfg.name}\` once to bootstrap.`);
        return 1;
    }
    return spawnInherit('ssh', sshArgs(tcfg.ssh.user, ip));
}

async function tartDown(cfg: VMConfig): Promise<number> {
    if (!tartExists(cfg.name)) {
        consola.info(`[tart] ${cfg.name} doesn't exist; nothing to stop.`);
        return 0;
    }
    return spawnInherit('tart', ['stop', cfg.name]);
}

function detectRepoRoot(): string {
    const repo = detectRepo();
    if (!repo.root) throw new Error('not in a smartchats repo');
    return repo.root;
}

// ──────────────────────────────────────────────────────────────────────────
// Dispatch
// ──────────────────────────────────────────────────────────────────────────

async function runList(): Promise<number> {
    consola.info('Registered VMs:');
    for (const cfg of Object.values(VM_REGISTRY)) {
        const cap = checkDriver(cfg.driver);
        const driverOk = cap.ok ? '' : ` (driver missing: ${cap.install})`;
        let state = 'not started';
        if (cap.ok) {
            if (cfg.driver === 'lima') state = limactlIsRunning(cfg.name) ? 'running' : (limactlExists(cfg.name) ? 'stopped' : 'not created');
            if (cfg.driver === 'tart') state = tartIsRunning(cfg.name) ? 'running' : (tartExists(cfg.name) ? 'stopped' : 'not created');
        }
        console.log(`  ${cfg.name.padEnd(8)} ${cfg.driver.padEnd(5)} ${state.padEnd(15)} ${cfg.description}${driverOk}`);
    }
    return 0;
}

export async function runVm(argv: string[]): Promise<number> {
    if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
        console.log(vmHelp);
        return argv.length === 0 ? 1 : 0;
    }

    const sub = argv[0]!;
    const name = argv[1] ?? '';
    const noKeys = argv.includes('--no-keys');
    const fresh = argv.includes('--fresh');

    if (sub === 'list') return runList();

    if (!name && sub !== 'list') {
        consola.error(`sm vm ${sub} requires a VM name. Try: sm vm list`);
        return 1;
    }

    const cfg = VM_REGISTRY[name];
    if (!cfg) {
        consola.error(`unknown VM: ${name}. See: sm vm list`);
        return 1;
    }

    const cap = checkDriver(cfg.driver);
    if (!cap.ok) {
        consola.error(`${cfg.driver} driver not installed. Install: ${cap.install}`);
        return 1;
    }

    const repoRoot = detectRepoRoot();

    switch (sub) {
        case 'up':
            if (cfg.driver === 'lima') return limaUp(cfg, repoRoot, { fresh, injectKeys: !noKeys });
            if (cfg.driver === 'tart') return tartUp(cfg, repoRoot, { fresh, injectKeys: !noKeys });
            return 1;
        case 'into':
            if (cfg.driver === 'lima') return limaInto(cfg);
            if (cfg.driver === 'tart') return tartInto(cfg);
            return 1;
        case 'down':
            if (cfg.driver === 'lima') return limaDown(cfg);
            if (cfg.driver === 'tart') return tartDown(cfg);
            return 1;
        case 'test': {
            // up + bin/simi-smoke
            const upFn = cfg.driver === 'lima' ? limaUp : tartUp;
            const upExit = await upFn(cfg, repoRoot, { fresh, injectKeys: !noKeys });
            if (upExit !== 0) return upExit;
            const smokePath = path.join(repoRoot, 'bin/simi-smoke');
            if (!fs.existsSync(smokePath)) {
                consola.error(`bin/simi-smoke not found at ${smokePath}`);
                return 1;
            }
            consola.start(`[smoke] running bin/simi-smoke against ${cfg.name}`);
            return spawnInherit(smokePath, ['--vm', cfg.name]);
        }
        default:
            consola.error(`unknown subcommand: ${sub}`);
            console.log(vmHelp);
            return 1;
    }
}
