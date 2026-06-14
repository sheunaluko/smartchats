/**
 * `sm status` — read-only snapshot + recommended next step.
 *
 * Phase 1: pure local reads.
 * Phase 3: diff-aware recommendations powered by lib/recommend.ts.
 * Phase 4 (future): Vercel / Firebase / npm / public-remote fetches in
 * parallel with a 60s cache.
 */

import {
    detectRepo,
    readGitState,
    readLastVerify,
    readFunctionsEnvSymlink,
    probeDockerContainer,
} from '../lib/context.js';
import { buildSnapshot, recommend, type Recommendation } from '../lib/recommend.js';
import type { CategorizedChanges, ChangeCategory } from '../lib/changes.js';

const C = {
    bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m',
    cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', green: '\x1b[32m', gray: '\x1b[90m',
};
const color = (s: string, k: keyof typeof C) =>
    (process.env.NO_COLOR || !process.stdout.isTTY) ? s : `${C[k]}${s}${C.reset}`;

function ageHuman(iso: string): string {
    try {
        const then = new Date(iso).getTime();
        const now = Date.now();
        const sec = Math.max(0, Math.floor((now - then) / 1000));
        if (sec < 60) return `${sec}s ago`;
        if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
        if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
        return `${Math.floor(sec / 86400)}d ago`;
    } catch {
        return iso;
    }
}

function severityColor(sev?: Recommendation['severity']): keyof typeof C {
    switch (sev) {
        case 'urgent': return 'red';
        case 'warn': return 'yellow';
        case 'info': return 'cyan';
        default: return 'cyan';
    }
}

const CATEGORY_LABELS: Record<ChangeCategory, string> = {
    'functions': 'functions',
    'schema': 'schema',
    'frontend': 'frontend',
    'vendored': 'vendored-from-open',
    'release-relevant': 'cli (release-relevant)',
    'release-infra': 'release infra',
    'docs': 'docs',
    'tests': 'tests',
    'sm': 'sm self',
    'other': 'other',
};

function renderChangeSummary(label: string, c: CategorizedChanges | undefined): string[] {
    if (!c || c.total === 0) return [];
    const lines: string[] = [`  ${color(label, 'dim')}: ${c.total} file${c.total === 1 ? '' : 's'}`];
    const cats = Object.entries(c.byCategory).filter(([_, files]) => files && files.length > 0);
    for (const [cat, files] of cats) {
        const catLabel = CATEGORY_LABELS[cat as ChangeCategory] ?? cat;
        lines.push(`    ${color('·', 'dim')} ${catLabel}: ${files!.length}`);
    }
    return lines;
}

export async function runStatus(argv: string[]): Promise<number> {
    const verbose = argv.includes('-v') || argv.includes('--verbose');
    const repo = detectRepo();
    if (repo.kind === 'unknown' || !repo.root) {
        console.log(color('sm', 'cyan') + ' · no smartchats repo detected from cwd');
        console.log(color('Run from inside ~/dev/smartchats or ~/dev/smartchats-cloud.', 'dim'));
        return 1;
    }

    const git = readGitState(repo.root);
    const snapshot = buildSnapshot(repo.kind, repo.root, git);
    const recs = recommend(snapshot);
    const lastVerify = readLastVerify(repo.kind);

    // --- Header ---
    const dirtyTag = git.dirty ? color(' · dirty', 'yellow') : '';
    const aheadBehind = (git.ahead || git.behind)
        ? color(` · ${git.ahead} ahead${git.behind ? `/${git.behind} behind` : ''}`, 'yellow')
        : '';
    console.log(
        color(repo.name, 'cyan')
        + color(` · ${git.branch}`, 'dim')
        + color(` (${git.headShort})`, 'dim')
        + aheadBehind
        + dirtyTag
    );
    console.log('');

    // --- Recommendations ---
    if (recs.length === 0) {
        console.log(color('✓ No action recommended.', 'green'));
    } else {
        console.log(color('Recommended next:', 'bold'));
        for (const r of recs) {
            console.log(`  ${color(r.verb.padEnd(22), severityColor(r.severity))}  ${color(r.reason, 'dim')}`);
        }
    }
    console.log('');

    // --- State ---
    console.log(color('State', 'bold'));
    if (lastVerify) {
        const tag = lastVerify.ok ? color('✓', 'green') : color('✗', 'red');
        console.log(`  ${tag} Last verify: ${lastVerify.level} on ${lastVerify.head.slice(0, 7)} (${ageHuman(lastVerify.timestamp)})`);
    } else {
        console.log(`  ${color('?', 'gray')} Last verify: never`);
    }

    if (repo.kind === 'cloud') {
        if (snapshot.syncedFrom) {
            console.log(`  ${color('·', 'dim')} Last sync from open: ${snapshot.syncedFrom.sha.slice(0, 7)} (${ageHuman(snapshot.syncedFrom.at)})`);
        } else {
            console.log(`  ${color('⚠', 'yellow')} Last sync from open: never (.synced-from missing)`);
        }
        const env = readFunctionsEnvSymlink(repo.root);
        const envGlyph = env.symlinkTarget === '.env.local-test' ? color('✓', 'green')
            : env.symlinkTarget === '.env.cloud' ? color('⚠', 'yellow')
                : color('✗', 'red');
        console.log(`  ${envGlyph} functions/.env: ${env.symlinkTarget}`);

        const ctr = probeDockerContainer('cloud_test_db');
        console.log(`  ${ctr.running ? color('✓', 'green') : color('·', 'dim')} cloud_test_db: ${ctr.running ? 'running on :8001' : 'not running'}`);

        // Per-target last deploy.
        for (const t of ['functions', 'frontend', 'schema'] as const) {
            const d = snapshot.lastDeploys[t];
            if (d) {
                console.log(`  ${color('·', 'dim')} Last ${t} deploy: ${d.head.slice(0, 7)} (${ageHuman(d.timestamp)})`);
            } else {
                console.log(`  ${color('?', 'gray')} Last ${t} deploy: never recorded`);
            }
        }
    }
    console.log('');

    // --- Changes ---
    const anyChanges =
        (snapshot.changes.sinceFunctionsDeploy?.total ?? 0) > 0 ||
        (snapshot.changes.sinceFrontendDeploy?.total ?? 0) > 0 ||
        (snapshot.changes.sinceSchemaDeploy?.total ?? 0) > 0 ||
        (snapshot.changes.sinceOrigin?.total ?? 0) > 0;
    if (anyChanges) {
        console.log(color('Changes', 'bold'));
        if (repo.kind === 'cloud') {
            for (const line of renderChangeSummary('since last functions deploy', snapshot.changes.sinceFunctionsDeploy)) console.log(line);
            for (const line of renderChangeSummary('since last frontend deploy', snapshot.changes.sinceFrontendDeploy)) console.log(line);
            for (const line of renderChangeSummary('since last schema apply', snapshot.changes.sinceSchemaDeploy)) console.log(line);
        }
        for (const line of renderChangeSummary('since origin', snapshot.changes.sinceOrigin)) console.log(line);
        console.log('');
    }

    // --- Verbose: list actual files ---
    if (verbose) {
        const dump = (label: string, c: CategorizedChanges | undefined) => {
            if (!c || c.total === 0) return;
            console.log(color(`${label} (${c.total}):`, 'bold'));
            for (const f of c.files) console.log(`  ${color(f, 'dim')}`);
            console.log('');
        };
        if (repo.kind === 'cloud') {
            dump('Files since functions deploy', snapshot.changes.sinceFunctionsDeploy);
            dump('Files since frontend deploy', snapshot.changes.sinceFrontendDeploy);
            dump('Files since schema apply', snapshot.changes.sinceSchemaDeploy);
        }
        dump('Files since origin', snapshot.changes.sinceOrigin);
    }

    console.log(color('Phase 3 — diff-aware recommendations active. Vercel / Firebase / npm reads land in Phase 4.', 'dim'));
    return 0;
}

export const statusHelp = `sm status — read-only snapshot + recommended next step

Usage:
  sm status [-v|--verbose]

Prints branch, dirty state, ahead/behind, last verify, last deploys, and a
categorized summary of what has changed since each deployment baseline.
Generates target-specific verb recommendations (e.g. "you touched functions/ —
run sm deploy functions").

-v / --verbose: list every changed file, not just counts.

See: sm explain status
`;
