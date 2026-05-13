#!/usr/bin/env -S npx tsx
/**
 * CLI: cross-session error triage.
 *
 * Globs a directory of session bundles, runs error analysis on each,
 * merges errors by signature, and writes one markdown report per
 * signature plus an index README to an output directory.
 *
 * Usage:
 *   npm run triage:errors -- [options]
 *
 * Options:
 *   --bundles <dir>      Source dir of *.json bundles. Default: ~/.smartchats/session_bundles
 *   --out <dir>          Parent output dir. Run gets a timestamped subdir.
 *                        Default: ./triage
 *   --since <when>       ISO datetime OR shorthand (7d, 24h, 30m, 2w).
 *                        Filters bundles by metadata.end_time.
 *   --app <name>         Restrict to one app_name.
 *   --min-count <N>      Skip signatures with fewer than N total occurrences.
 *                        Default: 1.
 *   --dry-run            Print the index to stdout, write nothing.
 *
 * The orchestrator is fully deterministic — no network, no AI. Bundles
 * arrive via the admin UI or the CLI's `save-session` and `find-sessions`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionBundle } from '../src/types.js';
import {
    mergeErrorsAcrossSessions,
    formatTriageReport,
    formatTriageIndex,
    formatWontfixSummary,
    applyHandledState,
    emptyHandledState,
    type HandledState,
} from '../src/analysis/triage_errors.js';
import { parseTimeSpec } from '../src/cli/find_cli.js';
import { parseArgs, die } from './_cli_lib.js';

const USAGE = `Usage: session_triage_errors [options]

  --bundles <dir>      Source bundle dir (default ~/.smartchats/session_bundles)
  --out <dir>          Parent output dir (default ./triage)
  --since <when>       ISO datetime OR shorthand (7d, 24h, 30m, 2w)
  --app <name>         Restrict to one app
  --min-count <N>      Skip signatures with fewer than N occurrences (default 1)
  --state <path>       Handled-state JSON file
                       (default: env SMARTCHATS_TRIAGE_STATE_FILE
                                  || <repo>/data/triage/handled.json)
  --no-state           Skip loading handled-state for this run
  --dry-run            Print the index to stdout; write nothing
  -h, --help
`;

interface CliOptions {
    bundlesDir: string;
    outRoot: string;
    sinceMs?: number;
    appName?: string;
    minCount: number;
    statePath: string | null;
    dryRun: boolean;
}

/**
 * Resolve the default handled-state path. Lives at <repo>/data/triage/handled.json
 * — derived from this script's location so the default works regardless of CWD.
 */
function defaultStatePath(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    // scripts/ is at packages/smartchats-sessions/scripts/. Walk up to <repo>.
    return resolve(here, '..', '..', '..', 'data', 'triage', 'handled.json');
}

function parseCliOptions(): CliOptions {
    const args = parseArgs(
        process.argv,
        new Set(['--bundles', '--out', '--since', '--app', '--min-count', '--state']),
    );
    if (args.flags.has('-h') || args.flags.has('--help')) die(USAGE, 0);

    const bundlesDir = args.values['--bundles'] ?? join(homedir(), '.smartchats', 'session_bundles');
    const outRoot = args.values['--out'] ?? './triage';
    const sinceMs = args.values['--since'] ? parseTimeSpec(args.values['--since']) : undefined;
    const appName = args.values['--app'];
    const minCount = args.values['--min-count']
        ? Math.max(1, parseInt(args.values['--min-count'], 10) || 1)
        : 1;
    const statePath = args.flags.has('--no-state')
        ? null
        : (args.values['--state']
            ?? process.env.SMARTCHATS_TRIAGE_STATE_FILE
            ?? defaultStatePath());
    const dryRun = args.flags.has('--dry-run');

    return { bundlesDir, outRoot, sinceMs, appName, minCount, statePath, dryRun };
}

function loadHandledState(path: string | null): HandledState {
    if (!path) return emptyHandledState();
    if (!existsSync(path)) return emptyHandledState();
    try {
        const raw = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(raw) as HandledState;
        if (parsed && typeof parsed === 'object' && parsed.version === 1 && parsed.entries) {
            return parsed;
        }
        process.stderr.write(`[triage] ignoring malformed handled-state at ${path}\n`);
        return emptyHandledState();
    } catch (err) {
        process.stderr.write(`[triage] failed to read handled-state: ${(err as Error).message}\n`);
        return emptyHandledState();
    }
}

function loadBundles(dir: string): SessionBundle[] {
    if (!existsSync(dir)) {
        die(`Bundle dir not found: ${dir}`);
    }
    const entries = readdirSync(dir).filter((f) => extname(f) === '.json');
    const bundles: SessionBundle[] = [];
    for (const f of entries) {
        const full = join(dir, f);
        try {
            const raw = readFileSync(full, 'utf-8');
            const obj = JSON.parse(raw) as SessionBundle;
            // Cheap validation — anything missing the load-bearing fields
            // is unlikely to be a bundle. We skip silently rather than fail
            // the whole run so a stray file doesn't break triage.
            if (obj && typeof obj.session_id === 'string' && Array.isArray(obj.timeline) && obj.metadata) {
                bundles.push(obj);
            }
        } catch {
            // Not a valid bundle; skip.
        }
    }
    return bundles;
}

function tsForRunDir(d: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    );
}

const opts = parseCliOptions();
const bundles = loadBundles(opts.bundlesDir);
if (bundles.length === 0) {
    process.stderr.write(`No bundles found in ${opts.bundlesDir}\n`);
    process.exit(0);
}

const rawReports = mergeErrorsAcrossSessions(bundles, {
    minCount: opts.minCount,
    sinceMs: opts.sinceMs,
    appName: opts.appName,
});

const state = loadHandledState(opts.statePath);
const outcome = applyHandledState(rawReports, state);
const { reports, suppressed_wontfix, suppressed_resolved } = outcome;

const generatedAtMs = Date.now();
const index = formatTriageIndex(reports, {
    generatedAtMs,
    bundleCount: bundles.length,
    sinceMs: opts.sinceMs,
    appName: opts.appName,
    suppressedWontfix: suppressed_wontfix.length,
    suppressedResolved: suppressed_resolved.length,
});

if (opts.dryRun) {
    process.stdout.write(index + '\n');
    process.stderr.write(
        `(dry run: ${reports.length} signature${reports.length === 1 ? '' : 's'}, ` +
            `suppressed: ${suppressed_resolved.length} resolved + ${suppressed_wontfix.length} wontfix; ` +
            `nothing written)\n`,
    );
    process.exit(0);
}

const runDir = join(opts.outRoot, tsForRunDir());
mkdirSync(runDir, { recursive: true });
writeFileSync(join(runDir, 'README.md'), index + '\n', 'utf-8');

for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    const rank = String(i + 1).padStart(2, '0');
    const filename = `${rank}_${r.slug}.md`;
    writeFileSync(join(runDir, filename), formatTriageReport(r), 'utf-8');
}

if (suppressed_wontfix.length > 0) {
    writeFileSync(join(runDir, 'wontfix_summary.md'), formatWontfixSummary(suppressed_wontfix) + '\n', 'utf-8');
}

process.stdout.write(`${runDir}\n`);
process.stderr.write(
    `Wrote ${reports.length} signature report${reports.length === 1 ? '' : 's'} ` +
        `from ${bundles.length} bundle${bundles.length === 1 ? '' : 's'}` +
        ` (suppressed: ${suppressed_resolved.length} resolved + ${suppressed_wontfix.length} wontfix).\n`,
);
