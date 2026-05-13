#!/usr/bin/env -S npx tsx
/**
 * CLI: mark, unmark, or list entries in the triage handled-state file.
 *
 * Usage:
 *   npm run triage:mark -- <target> --status <fixed|wontfix|investigating> [opts]
 *   npm run triage:mark -- <target> --unmark
 *   npm run triage:mark -- --list
 *
 * Target forms (auto-detected from positional arg):
 *   • path to a report .md   — signature is extracted from the file's
 *                              ## Signature ```text``` block (canonical).
 *   • slug                    — scans the latest run dir under ./triage/
 *                              (or under --triage-root) for a file matching
 *                              <NN>_<slug>.md and reads its signature.
 *   • 16-char hex hash        — direct lookup; only valid for --unmark / --list.
 *
 * Options:
 *   --status fixed|wontfix|investigating   required unless --unmark / --list
 *   --commit <sha>     fixed_in_commit (recommended for status=fixed)
 *   --notes <text>     free-form notes
 *   --fixed-at <when>  override (ISO or shorthand); default = now for status=fixed
 *   --triage-root <d>  search root for slug lookups (default ./triage)
 *   --state <path>     handled-state JSON (default <repo>/data/triage/handled.json
 *                       or env SMARTCHATS_TRIAGE_STATE_FILE)
 *   --unmark           remove the entry instead of writing/updating
 *   --list             print all entries and exit
 *   -h, --help
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    emptyHandledState,
    signatureHash,
    type HandledEntry,
    type HandledState,
} from '../src/analysis/triage_errors.js';
import { parseTimeSpec } from '../src/cli/find_cli.js';
import { parseArgs, die } from './_cli_lib.js';

const USAGE = `Usage: triage_mark <target> [options]

Target (auto-detected):
  • path/to/<NN>_<slug>.md  — extracts signature from the file
  • slug                     — looks in --triage-root for the latest match
  • 16-char hex hash         — direct (only with --unmark / --list)

Options:
  --status fixed|wontfix|investigating
  --commit <sha>          fixed_in_commit (recommended for status=fixed)
  --notes <text>
  --fixed-at <when>       ISO datetime or shorthand (7d, 24h, …); default = now
  --triage-root <dir>     default ./triage
  --state <path>          default <repo>/data/triage/handled.json or
                                  $SMARTCHATS_TRIAGE_STATE_FILE
  --unmark                remove the entry
  --list                  list all entries
  -h, --help
`;

const VALUED = new Set([
    '--status', '--commit', '--notes', '--fixed-at', '--triage-root', '--state',
]);

function defaultStatePath(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, '..', '..', '..', 'data', 'triage', 'handled.json');
}

function loadState(path: string): HandledState {
    if (!existsSync(path)) return emptyHandledState();
    try {
        const raw = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(raw) as HandledState;
        if (parsed?.version === 1 && parsed.entries) return parsed;
    } catch {
        // fall through
    }
    process.stderr.write(`Malformed state at ${path} — treating as empty.\n`);
    return emptyHandledState();
}

function saveState(path: string, state: HandledState): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

/**
 * Extract the canonical signature from a report .md by reading the
 * `## Signature` block. Returns the string between the opening ```text
 * fence and the closing ```. Throws if the report doesn't have that block.
 */
function readSignatureFromReport(path: string): string {
    const text = readFileSync(path, 'utf-8');
    // Anchor on "## Signature" then the first ```text ... ``` block after it.
    const m = text.match(/^## Signature\s*\n```text\s*\n([\s\S]*?)\n```/m);
    if (!m) die(`Report at ${path} has no '## Signature' code block.`);
    return m![1].trim();
}

/**
 * Resolve a slug to a report path. Scans triageRoot for run dirs (most
 * recent mtime first), returns the first file matching <NN>_<slug>.md.
 */
function findReportBySlug(triageRoot: string, slug: string): string | null {
    if (!existsSync(triageRoot)) return null;
    const runDirs = readdirSync(triageRoot)
        .map((name) => join(triageRoot, name))
        .filter((p) => {
            try { return statSync(p).isDirectory(); } catch { return false; }
        })
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    for (const dir of runDirs) {
        const files = readdirSync(dir);
        const match = files.find((f) => /^\d+_/.test(f) && f.endsWith('.md') && f.replace(/^\d+_/, '').replace(/\.md$/, '') === slug);
        if (match) return join(dir, match);
    }
    return null;
}

function gitWhoami(): string | undefined {
    try {
        const email = execSync('git config user.email', { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim();
        return email || undefined;
    } catch {
        return undefined;
    }
}

function listEntries(state: HandledState): void {
    const rows = Object.entries(state.entries);
    if (rows.length === 0) {
        process.stdout.write('(no entries)\n');
        return;
    }
    process.stdout.write(`${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}:\n\n`);
    for (const [hash, e] of rows.sort((a, b) => (b[1].marked_at ?? '').localeCompare(a[1].marked_at ?? ''))) {
        process.stdout.write(`  ${hash}  [${e.status.padEnd(13)}]  ${e.signature_preview}\n`);
        const meta: string[] = [];
        if (e.fixed_at) meta.push(`fixed_at=${e.fixed_at}`);
        if (e.fixed_in_commit) meta.push(`commit=${e.fixed_in_commit}`);
        if (e.notes) meta.push(`notes="${e.notes}"`);
        meta.push(`marked_at=${e.marked_at}`);
        if (e.marked_by) meta.push(`by=${e.marked_by}`);
        process.stdout.write(`                     ${meta.join('  ·  ')}\n`);
    }
}

// ── Main ──────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv, VALUED);
if (args.flags.has('-h') || args.flags.has('--help')) die(USAGE, 0);

const statePath = args.values['--state'] ?? process.env.SMARTCHATS_TRIAGE_STATE_FILE ?? defaultStatePath();
const state = loadState(statePath);

if (args.flags.has('--list')) {
    listEntries(state);
    process.exit(0);
}

const target = args.positional[0];
if (!target) die(USAGE);

// Resolve target → { hash, signaturePreview }.
// Path: extract sig from file. Slug: find report then extract. Hex hash:
// only valid for --unmark or --list (we don't know the signature_preview).
let hash: string;
let signature: string | null = null;

if (existsSync(target) && target.endsWith('.md')) {
    signature = readSignatureFromReport(target);
    hash = signatureHash(signature);
} else if (/^[a-f0-9]{16}$/i.test(target)) {
    hash = target.toLowerCase();
    if (!args.flags.has('--unmark')) {
        die(`Hash-only targets are valid only with --unmark. Pass a report path or slug instead.`);
    }
} else {
    const triageRoot = args.values['--triage-root'] ?? './triage';
    const reportPath = findReportBySlug(triageRoot, target);
    if (!reportPath) {
        die(`Could not resolve target '${target}'. Not a report path, hex hash, or slug found under ${triageRoot}.`);
    }
    signature = readSignatureFromReport(reportPath);
    hash = signatureHash(signature);
}

if (args.flags.has('--unmark')) {
    if (!state.entries[hash]) {
        process.stderr.write(`No entry for hash ${hash}; nothing to unmark.\n`);
        process.exit(0);
    }
    delete state.entries[hash];
    saveState(statePath, state);
    process.stderr.write(`Unmarked ${hash} in ${statePath}\n`);
    process.exit(0);
}

const status = args.values['--status'];
if (status !== 'fixed' && status !== 'wontfix' && status !== 'investigating') {
    die(`--status must be one of: fixed, wontfix, investigating`);
}

const nowIso = new Date().toISOString();
const fixedAtIso = args.values['--fixed-at']
    ? new Date(parseTimeSpec(args.values['--fixed-at'])).toISOString()
    : nowIso;

const existing = state.entries[hash];
const entry: HandledEntry = {
    signature_preview: signature ? signature.slice(0, 120) : (existing?.signature_preview ?? '(unknown)'),
    status,
    fixed_at: status === 'fixed' ? fixedAtIso : existing?.fixed_at,
    fixed_in_commit: args.values['--commit'] ?? existing?.fixed_in_commit,
    notes: args.values['--notes'] ?? existing?.notes,
    marked_at: nowIso,
    marked_by: gitWhoami(),
};
state.entries[hash] = entry;
saveState(statePath, state);

process.stderr.write(
    `${existing ? 'Updated' : 'Marked'} ${hash} as ${status}` +
        (status === 'fixed' ? ` (fixed_at=${entry.fixed_at})` : '') +
        ` in ${statePath}\n`,
);
