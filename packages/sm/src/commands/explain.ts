/**
 * `sm explain <verb> [sub]` — verbose, state-aware rendering of what a verb
 * does, including every toggle that changes its behavior.
 *
 * This is the maintainer's external memory: cloud vs local, emulator vs
 * prod, docker vs binary, which env file is symlinked, which Stripe key is
 * active, which port topology, etc. — all the toggles that change
 * interpretation but are easy to forget.
 */

import { getExplain, listVerbs } from '../lib/descriptors.js';
import { renderExplain } from '../lib/explain.js';

export const explainHelp = `sm explain <verb> [sub]

Prints exactly what \`sm <verb>\` would do right now, given the toggles
currently active in this repo. Includes:

  - Active toggles (with alternatives and what each one means)
  - Detected context (env symlinks, running containers, ports, etc.)
  - The steps the verb will take, in order
  - Side effects produced (network, disk, processes, deploys)
  - Common gotchas that bite the maintainer

Examples:
  sm explain status
  sm explain verify
  sm explain verify e2e
  sm explain dev
`;

export async function runExplain(argv: string[]): Promise<number> {
    if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
        console.log(explainHelp);
        console.log('Available verbs:');
        for (const v of listVerbs()) {
            console.log(`  ${v.verb.padEnd(12)} ${v.summary}`);
        }
        return 0;
    }
    const [verb, sub] = argv;
    const descriptor = getExplain(verb, sub);
    if (!descriptor) {
        console.log(`No explain descriptor for verb: ${verb}`);
        console.log('Try one of:');
        for (const v of listVerbs()) console.log(`  ${v.verb}`);
        return 1;
    }
    console.log(renderExplain(descriptor));
    return 0;
}
