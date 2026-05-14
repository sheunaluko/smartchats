#!/usr/bin/env node
/**
 * smartchats-test CLI entry.
 *
 * Usage:
 *   smartchats-test                           run default levels (L0-L1, skip infra)
 *   smartchats-test all                       run every level (including infra)
 *   smartchats-test quick                     L0-L1 only
 *   smartchats-test <level>[,<level>,...]     specific levels: e.g. build,unit
 *   smartchats-test --list                    list available levels
 *   smartchats-test --include-infra           also run integration + e2e
 *   smartchats-test --continue-on-failure     don't bail on first FAIL
 *   smartchats-test --help
 *
 * Exit code: 0 if all executed levels PASS or SKIP. 1 if any FAIL.
 */

import { ALL_LEVELS, findLevel } from './levels/index.js';
import { runLevels } from './runner.js';
import { printSummary } from './reporters/console.js';
import { findRepoRoot } from './workspace.js';

interface ParsedArgs {
    /** Specific level names, or 'all' / 'quick' presets, or empty for default. */
    selector: string[];
    includeInfra: boolean;
    continueOnFailure: boolean;
    list: boolean;
    help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
    const out: ParsedArgs = {
        selector: [],
        includeInfra: false,
        continueOnFailure: false,
        list: false,
        help: false,
    };
    for (const a of argv) {
        if (a === '--help' || a === '-h') out.help = true;
        else if (a === '--list') out.list = true;
        else if (a === '--include-infra') out.includeInfra = true;
        else if (a === '--continue-on-failure') out.continueOnFailure = true;
        else if (a.startsWith('--')) {
            process.stderr.write(`Unknown option: ${a}\n`);
            process.exit(2);
        } else {
            // Positional — comma-split for `smartchats-test build,unit`
            for (const part of a.split(',')) {
                if (part) out.selector.push(part.trim());
            }
        }
    }
    return out;
}

const HELP = `Usage: smartchats-test [SELECTOR] [OPTIONS]

Selector:
  (none)        Default — runs lint + build, skips infra-dependent levels
  all           Every level (lint, build, unit, integration, e2e)
  quick         lint + build only
  <name>,<name> Specific levels (e.g. \`build\`, \`build,unit\`)

Options:
  --include-infra         Also run levels marked requiresInfra=true (caller
                          ensures cloud_test_db / AIO is up first)
  --continue-on-failure   Don't bail on first FAIL — run every selected level
  --list                  List available levels and exit
  -h, --help              Show this help

Exit code: 0 on PASS, 1 on FAIL (no levels failed = pass).
`;

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        process.stdout.write(HELP);
        return;
    }

    if (args.list) {
        process.stdout.write('Available levels:\n');
        for (const l of ALL_LEVELS) {
            const tag = l.requiresInfra ? '  (requires infra)' : '';
            process.stdout.write(`  L${l.id}  ${l.name.padEnd(14)}  ${l.description}${tag}\n`);
        }
        return;
    }

    // Resolve selector → list of Level objects
    let selected;
    if (args.selector.length === 0) {
        // Default: skip infra, run the rest
        selected = ALL_LEVELS.filter((l) => !l.requiresInfra);
    } else if (args.selector.length === 1 && args.selector[0] === 'all') {
        selected = [...ALL_LEVELS];
    } else if (args.selector.length === 1 && args.selector[0] === 'quick') {
        selected = ALL_LEVELS.filter((l) => l.name === 'lint' || l.name === 'build');
    } else {
        selected = [];
        for (const name of args.selector) {
            const level = findLevel(name);
            if (!level) {
                process.stderr.write(`Unknown level: ${name}. Use --list to see options.\n`);
                process.exit(2);
            }
            selected.push(level);
        }
    }

    // --include-infra flips the skipInfra default off (when using the
    // default-empty selector).
    const skipInfra = args.selector.length === 0 && !args.includeInfra;

    const repoRoot = findRepoRoot();
    const outcome = await runLevels({
        repoRoot,
        levels: selected,
        continueOnFailure: args.continueOnFailure,
        skipInfra,
    });

    printSummary(outcome);
    process.exit(outcome.passed ? 0 : 1);
}

main().catch((err) => {
    process.stderr.write(`smartchats-test crashed: ${err?.stack ?? err}\n`);
    process.exit(2);
});
