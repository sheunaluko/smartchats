/**
 * `sm status` — read-only snapshot + recommended next step.
 *
 * Phase 1: pure local reads.
 * Phase 3: diff-aware recommendations.
 * Phase 4: live remote state — cloud origin SHA, Vercel deployment, Firebase
 *          functions list, npm version, open public remote SHA. Fired in
 *          parallel with 60s on-disk cache. Bypass with --refresh.
 *
 * The "Live state" block answers the questions you actually care about:
 *   - Did my push reach cloud origin?         (local cloud HEAD vs cloud origin/main)
 *   - Did Vercel pick it up?                  (cloud origin/main vs Vercel deployment SHA)
 *   - Are functions live + matching the rest? (Vercel SHA vs functions deploy SHA)
 *   - Is the public CLI in sync?              (open origin SHA vs npm version)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

import {
    detectRepo,
    readGitState,
    readLastVerify,
    // open-verify gate imported below — used for cloud "Last verify" replacement
    readFunctionsEnvSymlink,
    probeDockerContainer,
} from '../lib/context.js';
import { buildSnapshot, recommend, type Recommendation } from '../lib/recommend.js';
import { computeOpenVerifyGate } from '../lib/open_verify_gate.js';
import type { CategorizedChanges, ChangeCategory } from '../lib/changes.js';
import { fetchAllRemotes, type RemoteBundle, type FetchResult } from '../lib/remote.js';
import { readRemoteCache, writeRemoteCache, cacheAgeSeconds } from '../lib/remote-cache.js';

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

// ---------------------------------------------------------------------------
// Live state renderer
// ---------------------------------------------------------------------------

function fmtResult<T>(r: FetchResult<T>): string {
    if (r.ok) return '';
    return color(`⊘ ${r.error ?? 'fetch failed'}`, 'gray');
}

function shaShort(s: string | null | undefined): string {
    return s ? s.slice(0, 7) : '?';
}

function findOpenRoot(): string | null {
    const home = process.env.SMARTCHATS_PATH ?? `${process.env.HOME}/dev/smartchats`;
    return fs.existsSync(path.join(home, 'package.json')) ? home : null;
}

function findCloudRoot(repoKind: string, currentRoot: string): string | null {
    if (repoKind === 'cloud') return currentRoot;
    const home = `${process.env.HOME}/dev/smartchats-cloud`;
    return fs.existsSync(path.join(home, 'package.json')) ? home : null;
}

function readPackageJsonVersion(repoRoot: string, pkgRelative: string): string | null {
    try {
        const raw = fs.readFileSync(path.join(repoRoot, pkgRelative, 'package.json'), 'utf8');
        const j = JSON.parse(raw);
        return j.version ?? null;
    } catch { return null; }
}

function renderLiveState(
    bundle: RemoteBundle,
    cachedAt: string,
    cloudRoot: string | null,
    openRoot: string | null,
    localCloudHead: string | null,
): void {
    const ageSec = Math.max(0, Math.floor((Date.now() - new Date(cachedAt).getTime()) / 1000));
    console.log(color(`Live state ${color(`(cached ${ageSec}s ago — sm status --refresh)`, 'dim')}`, 'bold'));

    // --- Cloud chain: local cloud HEAD → cloud origin/main → Vercel deployment
    if (cloudRoot) {
        const co = bundle.cloudOrigin;
        if (co.ok && co.value) {
            const remote = co.value;
            const localMatchesRemote = localCloudHead && remote === localCloudHead;
            const tag = localMatchesRemote
                ? color('✓', 'green') + ' local ≡ origin/main'
                : color('⚠', 'yellow') + ` origin/main behind local (${shaShort(remote)} vs ${shaShort(localCloudHead)})`;
            console.log(`  ${color('Cloud origin', 'bold').padEnd(36)} ${shaShort(remote)}  ${tag}`);
        } else {
            console.log(`  ${color('Cloud origin', 'bold').padEnd(28)} ${fmtResult(co)}`);
        }

        const v = bundle.vercel;
        if (v.ok && v.value) {
            const d = v.value;
            const stateGlyph = d.state === 'READY' ? color('✓', 'green')
                : d.state === 'ERROR' ? color('✗', 'red')
                : color('⏳', 'yellow');
            const matchesOrigin = bundle.cloudOrigin.value && d.sha === bundle.cloudOrigin.value
                ? color('matches origin/main', 'green')
                : bundle.cloudOrigin.value
                    ? color(`⚠ ahead/behind origin (vercel: ${shaShort(d.sha)} vs origin: ${shaShort(bundle.cloudOrigin.value)})`, 'yellow')
                    : color('(no origin SHA to compare)', 'dim');
            console.log(
                `  ${color('Vercel', 'bold').padEnd(28)} ${stateGlyph} ${d.state} · ${shaShort(d.sha)} · ${ageHuman(d.createdAt)} · ${color(d.url, 'dim')}`
            );
            console.log(`  ${' '.repeat(28)} ${matchesOrigin}`);
        } else {
            console.log(`  ${color('Vercel', 'bold').padEnd(28)} ${fmtResult(v)}`);
        }

        const f = bundle.firebase;
        if (f.ok && f.value) {
            const fs = f.value;
            const tag = fs.unhealthy.length === 0 ? color('all ACTIVE', 'green') : color(`${fs.unhealthy.length} unhealthy`, 'red');
            const last = fs.lastDeploy ? `last deploy ${ageHuman(fs.lastDeploy)}` : 'no deploy time';
            console.log(`  ${color('Functions', 'bold').padEnd(28)} ${fs.count} live · ${last} · ${tag}`);
            for (const u of fs.unhealthy) {
                console.log(`  ${' '.repeat(28)} ${color('✗', 'red')} ${u.name}: ${u.status}`);
            }
        } else {
            console.log(`  ${color('Functions', 'bold').padEnd(28)} ${fmtResult(f)}`);
        }
    }

    // --- Open public + npm
    const o = bundle.openOrigin;
    if (openRoot) {
        if (o.ok && o.value) {
            const remote = o.value;
            // Compare with local open HEAD (if findable).
            let openLocalSha = '';
            try {
                openLocalSha = execSync('git rev-parse HEAD', {
                    cwd: openRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
                }).trim();
            } catch { /* ignore */ }
            const tag = openLocalSha && openLocalSha === remote
                ? color('✓ local ≡ origin/main', 'green')
                : openLocalSha
                    ? color(`⚠ open local ahead of public (${shaShort(remote)} vs ${shaShort(openLocalSha)})`, 'yellow')
                    : '';
            console.log(`  ${color('Open public', 'bold').padEnd(28)} ${shaShort(remote)}  ${tag}`);
        } else {
            console.log(`  ${color('Open public', 'bold').padEnd(28)} ${fmtResult(o)}`);
        }
    }

    const npm = bundle.npm;
    if (npm.ok && npm.value) {
        const localCliVer = openRoot ? readPackageJsonVersion(openRoot, 'packages/smartchats-cli') : null;
        const tag = localCliVer
            ? (localCliVer === npm.value ? color('✓ matches open package.json', 'green') : color(`⚠ open has ${localCliVer}`, 'yellow'))
            : '';
        console.log(`  ${color('npm', 'bold').padEnd(28)} smartchats-ai@${npm.value}  ${tag}`);
    } else {
        console.log(`  ${color('npm', 'bold').padEnd(28)} ${fmtResult(npm)}`);
    }

    console.log('');
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function runStatus(argv: string[]): Promise<number> {
    const verbose = argv.includes('-v') || argv.includes('--verbose');
    const noRemote = argv.includes('--no-remote');
    const refresh = argv.includes('--refresh');

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

    // --- Local state ---
    console.log(color('Local state', 'bold'));
    if (repo.kind === 'cloud') {
        // Cloud doesn't run its own verify (no bin/test-e2e). What matters is
        // whether the synced code was blessed by open's verify.
        const gate = computeOpenVerifyGate(repo.root);
        const glyph =
            gate.kind === 'ok' ? color('✓', 'green') :
            gate.kind === 'no_verify' || gate.kind === 'no_sync' ? color('?', 'gray') :
            color('✗', 'red');
        const headline = (() => {
            switch (gate.kind) {
                case 'ok':
                    return `Open verify + sync: ${gate.openVerify!.level} passed on ${gate.openSha!.slice(0, 7)} (${ageHuman(gate.openVerify!.timestamp)})`;
                case 'no_sync':
                    return `Open verify + sync: no .synced-from — run \`sm sync\``;
                case 'no_verify':
                    return `Open verify + sync: synced from ${gate.openSha!.slice(0, 7)} but no open verify cached`;
                case 'verify_failed':
                    return `Open verify + sync: open verify FAILED (${gate.openVerify!.level}) on ${gate.openVerify!.head.slice(0, 7)}`;
                case 'sha_mismatch':
                    return `Open verify + sync: synced from ${gate.openSha!.slice(0, 7)} but open verified ${gate.openVerify!.head.slice(0, 7)}`;
            }
        })();
        console.log(`  ${glyph} ${headline}`);
    } else if (lastVerify) {
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
        for (const t of ['functions', 'frontend', 'schema'] as const) {
            const d = snapshot.lastDeploys[t];
            if (d) {
                console.log(`  ${color('·', 'dim')} Last ${t} deploy (locally recorded): ${d.head.slice(0, 7)} (${ageHuman(d.timestamp)})`);
            }
        }
    }
    console.log('');

    // --- Remote / Live state ---
    if (!noRemote) {
        const cloudRoot = findCloudRoot(repo.kind, repo.root);
        const openRoot = findOpenRoot();
        let cached = refresh ? null : readRemoteCache();
        if (!cached) {
            // Fetch fresh, show progress indicator if TTY.
            if (process.stdout.isTTY) {
                process.stdout.write(color('Fetching live state... ', 'dim'));
            }
            const bundle = await fetchAllRemotes({ cloudRoot, openRoot });
            cached = writeRemoteCache(bundle);
            if (process.stdout.isTTY) {
                process.stdout.write('\r\x1b[2K'); // clear line
            }
        }

        // Local cloud HEAD for the chain.
        const localCloudHead = repo.kind === 'cloud' ? git.head : (
            cloudRoot
                ? (() => {
                    try {
                        return execSync('git rev-parse HEAD', {
                            cwd: cloudRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
                        }).trim();
                    } catch { return null; }
                })()
                : null
        );

        renderLiveState(cached.bundle, cached.fetchedAt, cloudRoot, openRoot, localCloudHead);
    }

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

    return 0;
}

export const statusHelp = `sm status — read-only snapshot + recommended next step

Usage:
  sm status [-v|--verbose] [--refresh] [--no-remote]

Prints branch, dirty state, ahead/behind, last verify, last deploys (local),
plus a live state block showing what's actually deployed to production right
now (cloud origin, Vercel, Firebase functions, npm, open public).

Flags:
  -v / --verbose   List every changed file, not just counts.
  --refresh        Bust the 60s remote-state cache; refetch all.
  --no-remote      Skip all remote fetches; show local + cached only.

Environment:
  VERCEL_TOKEN          Required for Vercel state (get at https://vercel.com/account/tokens).
  VERCEL_PROJECT_ID     Optional: filter Vercel API to one project.
  VERCEL_TEAM_ID        Optional: filter to a team.
  FIREBASE_PROJECT      Override default project (\`tidyscripts\`).
  SMARTCHATS_PATH       Path to open repo for cross-repo state (default ~/dev/smartchats).

See: sm explain status
`;
