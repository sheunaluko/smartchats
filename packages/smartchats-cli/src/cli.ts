#!/usr/bin/env node
/**
 * smartchats CLI — multi-purpose entry point.
 *
 * Subcommands:
 *   smartchats login        Sign in to the SmartChats cloud (browser OAuth).
 *   smartchats logout       Clear cached cloud credentials.
 *   smartchats whoami       Show the currently-authenticated cloud user.
 *   smartchats data import  Load a JSON bundle into a SmartChats deployment.
 *   smartchats data export  Save a SmartChats deployment's user data to JSON.
 *   smartchats launch       Interactive launcher for the local docker stack.
 *   smartchats              (no subcommand) → 'launch' for backward compat.
 *
 * Auth: cloud subcommands read/write credentials at
 * `~/.smartchats-mcp/credentials.json` (overridable via
 * `SMARTCHATS_CREDENTIALS_FILE`). Same file the MCP server uses — log in
 * once, all tools see the same account.
 */

import consola from 'consola';

import { runLaunch, parseLaunchArgs, launchHelp } from './commands/launch.js';
import { runLogin, loginHelp } from './commands/login.js';
import { runLogout, logoutHelp } from './commands/logout.js';
import { runWhoami, whoamiHelp } from './commands/whoami.js';
import { runData, parseDataArgs, dataHelp } from './commands/data.js';
import { runDoctor, parseDoctorArgs, doctorHelp } from './commands/doctor.js';

const KNOWN_COMMANDS = new Set(['launch', 'doctor', 'login', 'logout', 'whoami', 'data', 'help', '--help', '-h']);

function topHelp(): string {
    return `smartchats — CLI for SmartChats (cloud + local self-hosted)

Usage:
  smartchats <command> [options]

Commands:
  launch         Interactive launcher for the local docker stack (default if no command).
  doctor         Diagnose the local stack: docker, image, container, port 3000, LLM keys.
  login          Sign in to the SmartChats cloud (browser OAuth).
  logout         Clear cached cloud credentials.
  whoami         Show the currently-authenticated cloud user.
  data import    Load a JSON bundle into a SmartChats deployment.
  data export    Save a SmartChats deployment's user data to JSON.
  help <cmd>     Show detailed help for <cmd>.

Environment:
  SMARTCHATS_HOME   Explicit path to a smartchats repo clone. Overrides dir walk.
  XDG_CONFIG_HOME   If set, CLI config lives at $XDG_CONFIG_HOME/smartchats/config.json
                    (else ~/.smartchats/config.json).

Examples:
  smartchats login
  smartchats doctor
  smartchats data export ~/backup.json --target=cloud
  smartchats data import ~/backup.json --target=local
  smartchats launch --no-prompt -d
`;
}

async function main(): Promise<void> {
    const argv = process.argv;
    const first = argv[2];

    // No subcommand → fall through to launch (backward-compat with the
    // pre-subcommand CLI). Any flag-prefixed first arg also routes to launch.
    if (!first || (first.startsWith('-') && first !== '-h' && first !== '--help')) {
        const args = parseLaunchArgs(argv.slice(2));
        await runLaunch(args);
        return;
    }

    // Top-level help.
    if (first === 'help' || first === '--help' || first === '-h') {
        const sub = argv[3];
        if (!sub) { console.log(topHelp()); return; }
        if (sub === 'launch') console.log(launchHelp());
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
