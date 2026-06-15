#!/usr/bin/env node
/**
 * smartchats CLI — multi-purpose entry point.
 *
 * Lifecycle:
 *   smartchats setup        Guided first-run: deps + keys + .env, then start.
 *   smartchats start        Start the local stack (surreal + server).
 *   smartchats stop         Stop the running stack.
 *   smartchats restart      Stop then start.
 *   smartchats status       Show what's running + health.
 *   smartchats logs         Tail per-process logs.
 *   smartchats dev          Hot-reload dev stack (delegates to bin/devserve).
 *
 * Cloud:
 *   smartchats login / logout / whoami     Cloud auth (Firebase OAuth).
 *   smartchats data import / export        User-data bundles.
 *
 * Meta:
 *   smartchats doctor       Environment health check.
 *   smartchats home         Print resolved smartchats source root.
 *
 * Hidden (back-compat with the pre-`start` CLI):
 *   smartchats launch       Docker AIO launcher. New installs should prefer
 *                           `setup` + `start`.
 *
 * Bare `smartchats` (no subcommand, no flags):
 *   No config + no repo  → run `setup` (guided first-run).
 *   Otherwise            → run `start`.
 *   Any flag present     → route to `launch` (preserves `npx smartchats --no-prompt`
 *                          scripted callers).
 *
 * Auth: cloud subcommands read/write credentials at
 * `~/.smartchats-mcp/credentials.json` (overridable via
 * `SMARTCHATS_CREDENTIALS_FILE`). Same file the MCP server uses — log in
 * once, all tools see the same account.
 */

import * as fs from 'node:fs';

import consola from 'consola';

import { runLaunch, parseLaunchArgs, launchHelp } from './commands/launch.js';
import { runStart, parseStartArgs, startHelp } from './commands/start.js';
import { runSetup, parseSetupArgs, setupHelp } from './commands/setup.js';
import {
    runStop, parseStopArgs, stopHelp,
    runRestart, restartHelp,
    runStatus, parseStatusArgs, statusHelp,
    runLogs, parseLogsArgs, logsHelp,
} from './commands/lifecycle.js';
import { runHome, parseHomeArgs, homeHelp } from './commands/home.js';
import { runDev, parseDevArgs, devHelp } from './commands/dev.js';
import { runUpgrade, parseUpgradeArgs, upgradeHelp } from './commands/upgrade.js';
import { runEnv, parseEnvArgs, envHelp } from './commands/env.js';
import { runLogin, loginHelp } from './commands/login.js';
import { runLogout, logoutHelp } from './commands/logout.js';
import { runWhoami, whoamiHelp } from './commands/whoami.js';
import { runData, parseDataArgs, dataHelp } from './commands/data.js';
import { runDoctor, parseDoctorArgs, doctorHelp } from './commands/doctor.js';
import { detectContext } from './lib/context.js';
import { loadConfig } from './lib/config.js';

const KNOWN_COMMANDS = new Set([
    'setup', 'env', 'start', 'stop', 'restart', 'status', 'logs', 'dev', 'home',
    'upgrade',
    'launch', 'doctor', 'login', 'logout', 'whoami', 'data',
    'help', '--help', '-h',
]);

function topHelp(): string {
    return `smartchats — CLI for SmartChats (cloud + local self-hosted)

Usage:
  smartchats <command> [options]

Lifecycle:
  setup          Guided first-run: system check, API keys, .env, then start.
  env            Interactively configure provider API keys (no start).
  start          Start the local stack (surreal + server). Detached by default.
  stop           Stop the running stack.
  restart        Stop the stack and start it again.
  status         Show what's running, on what ports, with what health.
  logs           Tail per-process logs.
  dev            Hot-reload development stack (delegates to bin/devserve).
  upgrade        Upgrade to a newer release (re-runs install.sh).

Cloud:
  login          Sign in to the SmartChats cloud (browser OAuth).
  logout         Clear cached cloud credentials.
  whoami         Show the currently-authenticated cloud user.
  data import    Load a JSON bundle into a SmartChats deployment.
  data export    Save a SmartChats deployment's user data to JSON.

Meta:
  doctor         Environment health check.
  home           Print resolved smartchats source root.
  help <cmd>     Show detailed help for <cmd>.

Environment:
  SMARTCHATS_HOME   Explicit path to a smartchats repo clone (overrides dir walk).
  XDG_CONFIG_HOME   If set, CLI config lives at $XDG_CONFIG_HOME/smartchats/config.json
                    (else ~/.smartchats/config.json).

Examples:
  smartchats setup
  smartchats start
  smartchats status
  smartchats logs -f
  smartchats data export ~/backup.json --target=cloud
`;
}

/**
 * Resolve the CLI version across all three install paths:
 *
 *   1. Binary install (curl|bash → bun-compiled standalone). The package
 *      .json is NOT bundled into the binary, so we need a compile-time
 *      embed. scripts/build-release.sh passes `--define
 *      __SMARTCHATS_VERSION__='"<version>"'` to bun build; that constant
 *      gets inlined into the compiled bytecode.
 *
 *   2. npm install -g smartchats-ai. The package.json is at
 *      node_modules/smartchats-ai/package.json — same directory as
 *      dist/cli.js's parent. Read it via import.meta.url path resolution.
 *
 *   3. Source / dev. Same as (2) — the workspace package.json sits
 *      adjacent to dist/.
 *
 * Tries (1) first because it's deterministic; falls back to (2)/(3) if
 * the constant wasn't defined (i.e., we're not running a release build).
 */
declare const __SMARTCHATS_VERSION__: string | undefined;

function resolveVersion(): string {
    try {
        // The `typeof` check guards against the constant being
        // undefined when running uncompiled (tsx, node dist/cli.js, etc.).
        if (typeof __SMARTCHATS_VERSION__ !== 'undefined' && __SMARTCHATS_VERSION__) {
            return __SMARTCHATS_VERSION__;
        }
    } catch { /* fall through to package.json */ }
    try {
        const pkgUrl = new URL('../package.json', import.meta.url);
        return (JSON.parse(fs.readFileSync(pkgUrl, 'utf8')) as { version: string }).version;
    } catch {
        return 'dev';
    }
}

async function main(): Promise<void> {
    const argv = process.argv;
    const first = argv[2];

    // Short-circuit on --version BEFORE the bare-invocation or any-flag
    // routing — otherwise it falls through to launch and prompts for
    // Docker, which is a long-standing CLI bug.
    if (first === '--version' || first === '-v' || first === '-V') {
        console.log(resolveVersion());
        process.exit(0);
    }

    // Bare invocation routing:
    //   - Any flag (e.g. `npx smartchats --no-prompt -d`) → `launch`. Preserves
    //     all pre-subcommand scripted callers that rely on the old behavior.
    //   - No flag, no subcommand → smart: first-timer (no config + no source
    //     reachable) → `setup`; everyone else → `start`. This is the friend-
    //     onboarding fix — the right thing happens by default.
    if (!first) {
        const ctx = detectContext();
        const cfg = loadConfig();
        const firstTime = !ctx.root && !cfg.smartchatsHome;
        if (firstTime) {
            const exit = await runSetup({ noPrompt: false, noStart: false });
            process.exit(exit);
        }
        const exit = await runStart({
            appPort: cfg.lastUsedPort ?? 3000,
            surrealPort: 8000,
            dataDir: `${process.env.HOME ?? '/tmp'}/.smartchats/data`,
            rebuild: false,
            foreground: false,
            noPrompt: false,
        });
        process.exit(exit);
    }
    if (first.startsWith('-') && first !== '-h' && first !== '--help') {
        const args = parseLaunchArgs(argv.slice(2));
        await runLaunch(args);
        return;
    }

    // Top-level help.
    if (first === 'help' || first === '--help' || first === '-h') {
        const sub = argv[3];
        if (!sub) { console.log(topHelp()); return; }
        if (sub === 'setup') console.log(setupHelp());
        else if (sub === 'env') console.log(envHelp());
        else if (sub === 'start') console.log(startHelp());
        else if (sub === 'stop') console.log(stopHelp());
        else if (sub === 'restart') console.log(restartHelp());
        else if (sub === 'status') console.log(statusHelp());
        else if (sub === 'logs') console.log(logsHelp());
        else if (sub === 'dev') console.log(devHelp());
        else if (sub === 'home') console.log(homeHelp());
        else if (sub === 'upgrade') console.log(upgradeHelp());
        else if (sub === 'launch') console.log(launchHelp());
        else if (sub === 'doctor') console.log(doctorHelp());
        else if (sub === 'login') console.log(loginHelp);
        else if (sub === 'logout') console.log(logoutHelp);
        else if (sub === 'whoami') console.log(whoamiHelp);
        else if (sub === 'data') console.log(dataHelp());
        else { console.log(topHelp()); process.exit(1); }
        return;
    }

    if (!KNOWN_COMMANDS.has(first)) {
        consola.error(`Unknown command: ${first}`);
        console.log('');
        console.log(topHelp());
        process.exit(1);
    }

    switch (first) {
        case 'setup': {
            const args = parseSetupArgs(argv.slice(3));
            const exit = await runSetup(args);
            process.exit(exit);
        }
        case 'env': {
            const args = parseEnvArgs(argv.slice(3));
            const exit = await runEnv(args);
            process.exit(exit);
        }
        case 'start': {
            const args = parseStartArgs(argv.slice(3));
            const exit = await runStart(args);
            process.exit(exit);
        }
        case 'stop': {
            const args = parseStopArgs(argv.slice(3));
            const exit = await runStop(args);
            process.exit(exit);
        }
        case 'restart': {
            const exit = await runRestart(argv.slice(3));
            process.exit(exit);
        }
        case 'status': {
            const args = parseStatusArgs(argv.slice(3));
            const exit = await runStatus(args);
            process.exit(exit);
        }
        case 'logs': {
            const args = parseLogsArgs(argv.slice(3));
            const exit = await runLogs(args);
            process.exit(exit);
        }
        case 'dev': {
            const args = parseDevArgs(argv.slice(3));
            const exit = await runDev(args);
            process.exit(exit);
        }
        case 'home': {
            const args = parseHomeArgs(argv.slice(3));
            const exit = await runHome(args);
            process.exit(exit);
        }
        case 'upgrade': {
            const args = parseUpgradeArgs(argv.slice(3));
            const exit = await runUpgrade(args);
            process.exit(exit);
        }
        case 'launch': {
            const args = parseLaunchArgs(argv.slice(3));
            await runLaunch(args);
            return;
        }
        case 'doctor': {
            const args = parseDoctorArgs(argv.slice(3));
            const exit = await runDoctor(args);
            process.exit(exit);
        }
        case 'login':
            await runLogin();
            return;
        case 'logout':
            await runLogout();
            return;
        case 'whoami':
            await runWhoami();
            return;
        case 'data': {
            const args = parseDataArgs(argv.slice(3));
            await runData(args);
            return;
        }
    }
}

main().catch((err) => {
    if (err && err.name === 'ExitPromptError') {
        consola.info('Cancelled.');
        process.exit(130);
    }
    consola.error(err.message ?? err);
    if (err.stack && process.env.DEBUG) consola.error(err.stack);
    process.exit(1);
});
