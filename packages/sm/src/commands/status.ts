/**
 * `sm status` — read-only snapshot + recommended next step.
 *
 * Phase 1: pure local reads. Phase 4 will add Vercel / Firebase / npm /
 * public-remote fetches in parallel with a 60s cache.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    detectRepo,
    readGitState,
    readLastVerify,
    readFunctionsEnvSymlink,
    probeDockerContainer,
} from '../lib/context.js';

const C = {
    bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m',
    cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', green: '\x1b[32m', gray: '\x1b[90m',
};
const color = (s: string, k: keyof typeof C) =>
    (process.env.NO_COLOR || !process.stdout.isTTY) ? s : `${C[k]}${s}${C.reset}`;

interface Recommendation {
    verb: string;
    reason: string;
}

function readSyncedFrom(cloudRoot: string): { sha: string; subject: string; at: string } | null {
    const p = path.join(cloudRoot, '.synced-from');
    try {
        const raw = fs.readFileSync(p, 'utf8');
        const sha = (raw.match(/^open_sha:\s*(\S+)/m) ?? [])[1] ?? '';
        const subject = (raw.match(/^open_subject:\s*(.+)$/m) ?? [])[1] ?? '';
        const at = (raw.match(/^synced_at:\s*(.+)$/m) ?? [])[1] ?? '';
        if (!sha && !at) return null;
        return { sha, subject, at };
    } catch {
        return null;
    }
}

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

export async function runStatus(_argv: string[]): Promise<number> {
    const repo = detectRepo();
    if (repo.kind === 'unknown' || !repo.root) {
        console.log(color('sm', 'cyan') + ' · no smartchats repo detected from cwd');
        console.log(color('Run from inside ~/dev/smartchats or ~/dev/smartchats-cloud.', 'dim'));
        return 1;
    }

    const git = readGitState(repo.root);
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
    const recs: Recommendation[] = [];

    if (git.dirty) {
        recs.push({ verb: 'commit', reason: 'working tree has uncommitted changes' });
    }

    if (!lastVerify) {
        recs.push({ verb: 'sm verify', reason: 'no verify run cached' });
    } else if (lastVerify.head !== git.head) {
        recs.push({ verb: 'sm verify', reason: `last verify was on ${lastVerify.head.slice(0, 7)} (${ageHuman(lastVerify.timestamp)}); HEAD has moved` });
    } else if (!lastVerify.ok) {
        recs.push({ verb: 'sm verify', reason: `last verify FAILED (${lastVerify.level}, ${ageHuman(lastVerify.timestamp)})` });
    }

    if (repo.kind === 'cloud') {
        const synced = readSyncedFrom(repo.root);
        if (synced) {
            // Compare against local open repo HEAD if reachable.
            const openHome = process.env.SMARTCHATS_HOME ?? `${process.env.HOME}/dev/smartchats`;
            try {
                const openHead = require('node:child_process').execSync('git rev-parse HEAD', {
                    cwd: openHome, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
                }).trim();
                if (openHead && openHead !== synced.sha) {
                    recs.push({ verb: 'sm sync', reason: `open has new commits since last sync (${synced.sha.slice(0, 7)} → ${openHead.slice(0, 7)})` });
                }
            } catch { /* open not reachable; skip */ }
        } else {
            recs.push({ verb: 'sm sync', reason: '.synced-from missing — never synced from open' });
        }

        const env = readFunctionsEnvSymlink(repo.root);
        if (env.symlinkTarget === '.env.cloud') {
            recs.push({ verb: 'sm dev', reason: 'functions/.env points at .env.cloud (deploy mode) — switch to .env.local-test before dev' });
        }
    }

    if (recs.length === 0) {
        console.log(color('✓ No action recommended.', 'green'));
    } else {
        console.log(color('Recommended next:', 'bold'));
        for (const r of recs) {
            console.log(`  ${color(r.verb, 'cyan')}  ${color(r.reason, 'dim')}`);
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
        const synced = readSyncedFrom(repo.root);
        if (synced) {
            console.log(`  ${color('·', 'dim')} Last sync from open: ${synced.sha.slice(0, 7)} (${ageHuman(synced.at)})`);
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
    }

    console.log('');
    console.log(color('Phase 1 status: local only. Vercel / Firebase / npm reads land in Phase 4.', 'dim'));

    return 0;
}

export const statusHelp = `sm status — read-only snapshot + recommended next step

Usage:
  sm status

Prints: branch, dirty state, ahead/behind, last verify result, and (cloud repo)
last sync state and functions/.env symlink target. Generates one or more
suggested next verbs based on what it sees.

Phase 1: local-only. Phase 4 adds Vercel + Firebase + npm + public-remote
fetches with a 60s cache.

See: sm explain status
`;
