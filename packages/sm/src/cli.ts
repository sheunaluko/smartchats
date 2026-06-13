#!/usr/bin/env node
/**
 * sm — maintainer CLI for smartchats.
 *
 * One verb grammar, shared across the open + cloud repos. `sm` walks up
 * from cwd to figure out which repo you're in, then dispatches.
 *
 * Phase 1 verbs:
 *   sm                  status + recommended next (alias for `sm status`)
 *   sm status           read-only snapshot
 *   sm verify [level]   run tests at the chosen scope
 *   sm dev              start the dev environment for this repo
 *   sm doctor           environment health check
 *   sm explain <verb>   verbose state-aware description of what a verb does
 *   sm help [verb]      help text
 *
 * Later phases:
 *   sm release vX.Y.Z   (open) bump + tag + push
 *   sm push-public      (open) push to github.com/sheunaluko/smartchats
 *   sm sync             (cloud) sync from open
 *   sm deploy <target>  (cloud) functions / frontend / schema / all
 *   sm ship             (cloud) sync + verify + deploy + push
 *   sm rollback         (cloud) firebase / vercel rollback
 *   sm triage           wrap bin/triage-local or bin/triage-cloud
 */

import consola from 'consola';

import { runStatus, statusHelp } from './commands/status.js';
import { runVerify, verifyHelp } from './commands/verify.js';
import { runDev, devHelp } from './commands/dev.js';
import { runDoctor, doctorHelp } from './commands/doctor.js';
import { runExplain, explainHelp } from './commands/explain.js';

const KNOWN = new Set([
    'status',
    'verify',
    'dev',
    'doctor',
    'explain',
    'help', '--help', '-h',
]);

function topHelp(): string {
    return `sm — maintainer CLI for smartchats (open + cloud)

Usage:
  sm [verb] [args]

Phase 1 verbs:
  status            Read-only snapshot + recommended next step
  verify [level]    Run tests (quick | unit | integration | e2e | install | stripe | all | ci)
  dev               Start the dev environment for this repo
  doctor            Environment health check
  explain <verb>    Verbose state-aware description of a verb
  help [verb]       Detailed help

Bare \`sm\` is equivalent to \`sm status\`.

Planned (later phases):
  release vX.Y.Z    (open)  bump CLI version + tag
  push-public       (open)  push to github.com/sheunaluko/smartchats
  sync              (cloud) rsync from open repo
  deploy <target>   (cloud) functions | frontend | schema | all
  ship              (cloud) sync + verify + deploy + push
  rollback <target> (cloud) firebase / vercel rollback
  triage            local / cloud session error triage

Environment:
  NO_COLOR          Suppress color codes.

Examples:
  sm
  sm status
  sm verify
  sm verify e2e
  sm verify e2e -- --headed
  sm explain dev
`;
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const first = argv[0];

    if (!first) {
        const exit = await runStatus(argv);
        process.exit(exit);
    }

    if (first === 'help' || first === '--help' || first === '-h') {
        const sub = argv[1];
        if (!sub) { console.log(topHelp()); return; }
        if (sub === 'status') console.log(statusHelp);
        else if (sub === 'verify') console.log(verifyHelp);
        else if (sub === 'dev') console.log(devHelp);
        else if (sub === 'doctor') console.log(doctorHelp);
        else if (sub === 'explain') console.log(explainHelp);
        else console.log(topHelp());
        return;
    }

    if (!KNOWN.has(first)) {
        consola.error(`Unknown verb: ${first}`);
        console.log('');
        console.log(topHelp());
        process.exit(1);
    }

    let exit = 0;
    switch (first) {
        case 'status': exit = await runStatus(argv.slice(1)); break;
        case 'verify': exit = await runVerify(argv.slice(1)); break;
        case 'dev': exit = await runDev(argv.slice(1)); break;
        case 'doctor': exit = await runDoctor(argv.slice(1)); break;
        case 'explain': exit = await runExplain(argv.slice(1)); break;
    }
    process.exit(exit);
}

main().catch(err => {
    consola.error(err);
    process.exit(1);
});
