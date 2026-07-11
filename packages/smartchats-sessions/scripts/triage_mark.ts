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
import { createClient, insertInsightEvent } from 'smartchats-database';
import {
    buildErrorStatusChangePayload,
    buildIssueStatusChangePayload,
    ERROR_STATUS_CHANGE_EVENT_TYPE,
    ISSUE_STATUS_CHANGE_EVENT_TYPE,
    type TriageStatus,
} from 'smartchats-common';
import {
    emptyHandledState,
    signatureHash,
    type HandledEntry,
    type HandledState,
} from '../src/analysis/triage_errors.js';
import { parseTimeSpec } from '../src/cli/find_cli.js';
import { parseArgs, die } from './_cli_lib.js';

const USAGE = `Usage: triage_mark <target> [options]

Two backing stores. The DB-native modes are the current path — they write
an append-only status-change event that both audit:issues and audit:errors
join on. The legacy JSON-file mode remains for the bundle-based errors
workflow (session_triage_errors + report .md files).

DB-native (current):
  --issue-kind <k>            Mark an issue kind (from audit:issues).
  --signature-hash <hex>      Mark an error signature (from audit:errors).
                              Pair with --signature-preview so audit output
                              can show a human-readable snippet.

Legacy (bundle-based errors):
  <target>: path/to/<NN>_<slug>.md, slug (searches --triage-root), or
            16-char hex (only with --unmark / --list).

Common options:
  --status fixed|wontfix|investigating
  --commit <sha>            fixed_in_commit (recommended for status=fixed)
  --notes <text>
  --fixed-at <when>         ISO datetime or shorthand (7d, 24h, …); default = now
  --signature-preview <s>   Only used with --signature-hash — the truncated
                            signature the audit output should display.

Legacy-only options:
  --triage-root <dir>       Default ./triage
  --state <path>            Legacy state file (default <repo>/data/triage/handled.json
                            or $SMARTCHATS_TRIAGE_STATE_FILE)
  --unmark                  Remove the legacy entry
  --list                    List legacy entries

DB connection (used by DB-native modes, same env-var scheme as audit:*):
  --url, --ns, --db, --user-cred, --password
  SMARTCHATS_SESSION_URL / _NS / _DB / _USER / _PASSWORD env aliases.

Examples:
  # DB-native — mark an issue kind fixed against local AIO
  npm run triage:mark -- --issue-kind todo_id_serialization_malformed \\
                         --status fixed --commit 3be82ca

  # DB-native — mark an error signature (hash from audit:errors output)
  sm triage:mark --signature-hash 1bd2a2061a87e8e6 \\
                 --signature-preview "SurrealDB: Incorrect arguments..." \\
                 --status fixed --commit 500dd5d --cloud
  -h, --help
`;

const VALUED = new Set([
    '--status', '--commit', '--notes', '--fixed-at', '--triage-root', '--state',
    '--issue-kind', '--signature-hash', '--signature-preview',
    '--url', '--ns', '--namespace', '--db', '--database', '--user-cred', '--password',
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

// ── DB-native path (issues + errors, current mechanism) ──────────────────

function validateStatus(v: string | undefined): TriageStatus {
    if (v !== 'fixed' && v !== 'wontfix' && v !== 'investigating') {
        die(`--status must be one of: fixed, wontfix, investigating`);
    }
    return v;
}

/** RFC-3339-ish random id, mirrors InsightsClient's shape. */
function makeEventId(): string {
    return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function markInDatabase(
    kind: { type: 'issue'; issueKind: string } | {
        type: 'error';
        signatureHash: string;
        signaturePreview: string;
    },
    status: TriageStatus,
    values: Record<string, string>,
    urlLabel: string,
): Promise<void> {
    const nowIso = new Date().toISOString();
    const fixedAtIso = values['--fixed-at']
        ? new Date(parseTimeSpec(values['--fixed-at'])).toISOString()
        : (status === 'fixed' ? nowIso : undefined);
    const notes = values['--notes'];
    const commit = values['--commit'];
    const markedBy = gitWhoami();

    let event_type: string;
    let payload: Record<string, unknown>;
    let targetLabel: string;
    if (kind.type === 'issue') {
        event_type = ISSUE_STATUS_CHANGE_EVENT_TYPE;
        payload = buildIssueStatusChangePayload({
            issue_kind: kind.issueKind,
            status,
            fixed_at: fixedAtIso,
            fixed_in_commit: commit,
            notes,
            marked_by: markedBy,
        }) as unknown as Record<string, unknown>;
        targetLabel = `issue kind '${kind.issueKind}'`;
    } else {
        event_type = ERROR_STATUS_CHANGE_EVENT_TYPE;
        payload = buildErrorStatusChangePayload({
            signature_hash: kind.signatureHash,
            signature_preview: kind.signaturePreview,
            status,
            fixed_at: fixedAtIso,
            fixed_in_commit: commit,
            notes,
            marked_by: markedBy,
        }) as unknown as Record<string, unknown>;
        targetLabel = `error signature ${kind.signatureHash}`;
    }

    const client = createClient({
        url: values['--url'] ?? process.env.SMARTCHATS_SESSION_URL ?? 'ws://localhost:8000/rpc',
        namespace: values['--ns'] ?? values['--namespace'] ?? process.env.SMARTCHATS_SESSION_NS ?? 'production',
        database: values['--db'] ?? values['--database'] ?? process.env.SMARTCHATS_SESSION_DB ?? 'main',
        auth: {
            username: values['--user-cred'] ?? process.env.SMARTCHATS_SESSION_USER ?? 'root',
            password: values['--password'] ?? process.env.SMARTCHATS_SESSION_PASSWORD ?? 'root',
        },
    });
    try {
        await client.connect();
    } catch (err) {
        die(`connect failed (${urlLabel}): ${(err as Error).message}`);
    }
    try {
        const spec = insertInsightEvent({
            event_type,
            event_id: makeEventId(),
            payload,
            timestamp: nowIso,
        });
        await client.runQuery(spec);
        process.stderr.write(
            `Marked ${targetLabel} as ${status}` +
                (status === 'fixed' && fixedAtIso ? ` (fixed_at=${fixedAtIso})` : '') +
                (commit ? `, commit=${commit}` : '') +
                ` → ${urlLabel}\n`,
        );
    } finally {
        await client.close?.();
    }
}

// ── Main ──────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv, VALUED);
if (args.flags.has('-h') || args.flags.has('--help')) die(USAGE, 0);

// DB-native mode is opt-in via --issue-kind or --signature-hash. The
// legacy JSON path only kicks in when neither is present, so existing
// bundle-based triage:mark <report.md> invocations still work.
const issueKind = args.values['--issue-kind'];
const signatureHashArg = args.values['--signature-hash'];
if (issueKind || signatureHashArg) {
    const status = validateStatus(args.values['--status']);
    const urlLabel = args.values['--url'] ?? process.env.SMARTCHATS_SESSION_URL ?? 'ws://localhost:8000/rpc';
    if (issueKind && signatureHashArg) {
        die(`Pass only one of --issue-kind or --signature-hash, not both.`);
    }
    if (issueKind) {
        await markInDatabase({ type: 'issue', issueKind }, status, args.values, urlLabel);
    } else {
        const signaturePreview = args.values['--signature-preview'] ?? '';
        if (!signaturePreview) {
            process.stderr.write(
                `Warning: --signature-preview omitted. Audit output will show an empty preview column.\n`,
            );
        }
        if (!/^[a-f0-9]{16}$/i.test(signatureHashArg!)) {
            die(`--signature-hash must be a 16-char hex string, got: ${signatureHashArg}`);
        }
        await markInDatabase(
            { type: 'error', signatureHash: signatureHashArg!.toLowerCase(), signaturePreview },
            status,
            args.values,
            urlLabel,
        );
    }
    process.exit(0);
}

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
