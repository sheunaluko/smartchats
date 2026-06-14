#!/usr/bin/env node
/**
 * sm — maintainer CLI for smartchats.
 *
 * One verb grammar, shared across the open + cloud repos. `sm` walks up
 * from cwd to figure out which repo you're in, then dispatches.
 *
 * Phase 1: status, verify, dev, doctor, explain, help
 * Phase 2: sync, deploy, ship, rollback, release, push-public, triage
 * Later:   API-driven status + diff-aware recommendations + cleanup pass
 */

import consola from 'consola';

import { runStatus, statusHelp } from './commands/status.js';
import { runVerify, verifyHelp } from './commands/verify.js';
import { runDev, devHelp } from './commands/dev.js';
import { runDoctor, doctorHelp } from './commands/doctor.js';
import { runExplain, explainHelp } from './commands/explain.js';
import { runSync, syncHelp } from './commands/sync.js';
import { runDeploy, deployHelp } from './commands/deploy.js';
import { runShip, shipHelp } from './commands/ship.js';
import { runShipFull, shipFullHelp } from './commands/ship-full.js';
import { runRollback, rollbackHelp } from './commands/rollback.js';
import { runRelease, runPushPublic, releaseHelp, pushPublicHelp } from './commands/release.js';
import { runTriage, triageHelp } from './commands/triage.js';

const KNOWN = new Set([
    // Phase 1
    'status', 'verify', 'dev', 'doctor', 'explain',
    // Phase 2
    'sync', 'deploy', 'ship', 'ship-full', 'rollback', 'release', 'push-public', 'triage',
    // help
    'help', '--help', '-h',
]);

function topHelp(): string {
    return `sm — maintainer CLI for smartchats (open + cloud)

Usage:
  sm [verb] [args]

Awareness:
  status            Read-only snapshot + recommended next step (default; bare \`sm\`)
  explain <verb>    Verbose state-aware description of a verb
  doctor            Environment health check
  help [verb]       Detailed help

Verify:
  verify [level]    quick | lint | build | unit | integration | e2e | install | stripe | all | ci

Dev:
  dev               Start the dev environment for this repo

Cloud actions:
  sync              rsync open → cloud
  deploy <target>   functions | frontend | schema | all
  ship              sync + verify ci + deploy functions + push frontend  (~5 min)
  ship-full         + verify e2e + schema (if drift) + post-deploy probes  (~25 min)
  rollback <t>      functions | frontend

Open actions:
  release vX.Y.Z    Bump CLI + tag (with --push-tags fires release.yml)
  push-public       git push origin main (open repo → public)

Both:
  triage [local|cloud]   End-to-end error session triage

Common flags on destructive verbs:
  --yes / -y     Skip preflight prompt (CI / scripting)
  --explain      Print descriptor + checks then exit (no execution)
  --dry-run      Where supported (sync, deploy schema)
  --             Forward remaining args to the wrapped script

Examples:
  sm
  sm explain ship
  sm verify e2e
  sm deploy schema             # dry-run
  sm deploy schema --apply -y  # commit, no prompt
  sm ship --quick-verify
  sm release v0.3.3 --push-tags
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
        const helps: Record<string, string> = {
            status: statusHelp, verify: verifyHelp, dev: devHelp, doctor: doctorHelp,
            explain: explainHelp, sync: syncHelp, deploy: deployHelp, ship: shipHelp,
            'ship-full': shipFullHelp, rollback: rollbackHelp, release: releaseHelp,
            'push-public': pushPublicHelp, triage: triageHelp,
        };
        const text = helps[sub];
        if (text) console.log(text); else console.log(topHelp());
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
        case 'status':      exit = await runStatus(argv.slice(1)); break;
        case 'verify':      exit = await runVerify(argv.slice(1)); break;
        case 'dev':         exit = await runDev(argv.slice(1)); break;
        case 'doctor':      exit = await runDoctor(argv.slice(1)); break;
        case 'explain':     exit = await runExplain(argv.slice(1)); break;
        case 'sync':        exit = await runSync(argv.slice(1)); break;
        case 'deploy':      exit = await runDeploy(argv.slice(1)); break;
        case 'ship':        exit = await runShip(argv.slice(1)); break;
        case 'ship-full':   exit = await runShipFull(argv.slice(1)); break;
        case 'rollback':    exit = await runRollback(argv.slice(1)); break;
        case 'release':     exit = await runRelease(argv.slice(1)); break;
        case 'push-public': exit = await runPushPublic(argv.slice(1)); break;
        case 'triage':      exit = await runTriage(argv.slice(1)); break;
    }
    process.exit(exit);
}

main().catch(err => {
    consola.error(err);
    process.exit(1);
});
