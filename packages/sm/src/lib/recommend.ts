/**
 * Recommendation engine.
 *
 * Reads the current state of a repo (git, last verify, last deploys,
 * changed files since each baseline) and emits an ordered list of
 * recommended next verbs. Each recommendation has a priority — higher means
 * shown first / more important.
 *
 * This is where "intelligence" lives. The rules are intentionally
 * conservative — we only recommend when we have ground truth (e.g. don't
 * suggest "deploy functions" if we have NO last-deploy record, because we
 * have no way to know if it's actually drifted).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

import {
    type GitState,
    type RepoKind,
    readFunctionsEnvSymlink,
    readLastVerify,
} from './context.js';
import { categorizeChanges, type CategorizedChanges } from './changes.js';
import { readAllDeploys, type LastDeploy } from './last-deploy.js';
import { computeOpenVerifyGate } from './open_verify_gate.js';

export interface Recommendation {
    verb: string;
    reason: string;
    /** Higher = shown first. */
    priority: number;
    /** Optional severity: info / warn / urgent. */
    severity?: 'info' | 'warn' | 'urgent';
}

export interface RepoSnapshot {
    repo: RepoKind;
    root: string;
    git: GitState;
    /** What's changed against each baseline we care about. */
    changes: {
        /** Since last sync from open (cloud only). */
        sinceSync?: CategorizedChanges;
        /** Since last successful functions deploy (cloud only). */
        sinceFunctionsDeploy?: CategorizedChanges;
        /** Since last successful frontend deploy (cloud only). */
        sinceFrontendDeploy?: CategorizedChanges;
        /** Since last successful schema apply (cloud only). */
        sinceSchemaDeploy?: CategorizedChanges;
        /** Since origin/main (both repos). */
        sinceOrigin?: CategorizedChanges;
    };
    lastDeploys: ReturnType<typeof readAllDeploys>;
    syncedFrom: { sha: string; subject: string; at: string } | null;
    openHead: string | null;
}

function readSyncedFrom(cloudRoot: string): RepoSnapshot['syncedFrom'] {
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

function readOpenHead(): string | null {
    const home = process.env.SMARTCHATS_PATH ?? `${process.env.HOME}/dev/smartchats`;
    try {
        return execSync('git rev-parse HEAD', {
            cwd: home, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return null;
    }
}

export function buildSnapshot(repo: RepoKind, root: string, git: GitState): RepoSnapshot {
    const lastDeploys = readAllDeploys(repo);
    const syncedFrom = repo === 'cloud' ? readSyncedFrom(root) : null;
    const openHead = repo === 'cloud' ? readOpenHead() : null;

    const changes: RepoSnapshot['changes'] = {};
    if (repo === 'cloud' && syncedFrom?.sha) {
        // Compare current HEAD to whatever was vendored in at sync time. This
        // catches edits made post-sync in the cloud repo itself.
        changes.sinceSync = categorizeChanges(root, 'HEAD~0', repo); // placeholder; better: use HEAD compared to merge-base of sync — but rsync isn't a commit, so we approximate
        // The more useful diff for "have you changed things since sync?" is
        // not against a git ref — it's "what got committed AFTER the sync"
        // which lines up with `git diff <commit_at_sync_time>...HEAD`. We
        // don't track that yet, so leave undefined and rely on per-target.
        changes.sinceSync = undefined;
    }
    if (lastDeploys.functions) {
        changes.sinceFunctionsDeploy = categorizeChanges(root, lastDeploys.functions.head, repo);
    }
    if (lastDeploys.frontend) {
        changes.sinceFrontendDeploy = categorizeChanges(root, lastDeploys.frontend.head, repo);
    }
    if (lastDeploys.schema) {
        changes.sinceSchemaDeploy = categorizeChanges(root, lastDeploys.schema.head, repo);
    }
    if (git.ahead > 0 || git.behind > 0) {
        // Compare HEAD vs upstream tip — what's been committed locally but not pushed.
        changes.sinceOrigin = categorizeChanges(root, `${git.branch}@{upstream}`, repo);
    }

    return { repo, root, git, changes, lastDeploys, syncedFrom, openHead };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function ruleCommitDirty(s: RepoSnapshot, recs: Recommendation[]): void {
    if (s.git.dirty) {
        recs.push({ verb: 'commit', reason: 'working tree has uncommitted changes', priority: 100, severity: 'warn' });
    }
}

function ruleVerifyStale(s: RepoSnapshot, recs: Recommendation[]): void {
    // Cloud doesn't run its own verify — bin/test-e2e lives in open only.
    // The open-verify gate is checked separately (ruleCloudOpenVerifyGate);
    // recommending `sm verify` in cloud would always be wrong.
    if (s.repo === 'cloud') return;

    const last = readLastVerify(s.repo);
    if (!last) {
        recs.push({ verb: 'sm verify', reason: 'no verify run cached', priority: 80 });
        return;
    }
    if (!last.ok) {
        recs.push({ verb: 'sm verify', reason: `last verify (${last.level}) FAILED`, priority: 90, severity: 'urgent' });
        return;
    }
    if (last.head !== s.git.head) {
        recs.push({
            verb: 'sm verify',
            reason: `last verify on ${last.head.slice(0, 7)}; HEAD has moved`,
            priority: 75,
        });
    }
}

function ruleCloudOpenVerifyGate(s: RepoSnapshot, recs: Recommendation[]): void {
    if (s.repo !== 'cloud') return;
    const gate = computeOpenVerifyGate(s.root);
    switch (gate.kind) {
        case 'ok':
            return;
        case 'no_sync':
            // ruleSyncFromOpen already covers the "never synced" case; nothing
            // to add here.
            return;
        case 'no_verify':
            recs.push({
                verb: 'sm verify (in open repo)',
                reason: 'cloud has synced code but open has no verify cached',
                priority: 88,
            });
            return;
        case 'verify_failed':
            recs.push({
                verb: 'sm verify (in open repo)',
                reason: `open's last verify (${gate.openVerify!.level}) FAILED on ${gate.openVerify!.head.slice(0, 7)}`,
                priority: 95,
                severity: 'urgent',
            });
            return;
        case 'sha_mismatch':
            recs.push({
                verb: 'sm sync',
                reason: `cloud is synced from ${gate.openSha!.slice(0, 7)} but open verified ${gate.openVerify!.head.slice(0, 7)} — re-sync to bring verified code over`,
                priority: 85,
            });
            return;
    }
}

function ruleSyncFromOpen(s: RepoSnapshot, recs: Recommendation[]): void {
    if (s.repo !== 'cloud') return;
    if (s.openHead && s.syncedFrom && s.syncedFrom.sha !== s.openHead) {
        recs.push({
            verb: 'sm sync',
            reason: `open has new commits since last sync (${s.syncedFrom.sha.slice(0, 7)} → ${s.openHead.slice(0, 7)})`,
            priority: 85,
            severity: 'info',
        });
    } else if (!s.syncedFrom) {
        recs.push({ verb: 'sm sync', reason: '.synced-from missing — never synced', priority: 70 });
    }
}

function ruleEnvSymlink(s: RepoSnapshot, recs: Recommendation[]): void {
    if (s.repo !== 'cloud') return;
    const env = readFunctionsEnvSymlink(s.root);
    if (env.symlinkTarget === '.env.cloud') {
        recs.push({
            verb: 'sm dev',
            reason: 'functions/.env points at .env.cloud (deploy mode) — switch to local-test for dev',
            priority: 60,
            severity: 'warn',
        });
    }
}

function ruleDeployFunctions(s: RepoSnapshot, recs: Recommendation[]): void {
    const c = s.changes.sinceFunctionsDeploy;
    if (!c || c.empty || c.total === 0) return;
    const fnFiles = c.byCategory.functions?.length ?? 0;
    if (fnFiles > 0) {
        recs.push({
            verb: 'sm deploy functions',
            reason: `${fnFiles} file${fnFiles === 1 ? '' : 's'} changed in functions/ since last deploy (${s.lastDeploys.functions!.head.slice(0, 7)})`,
            priority: 70,
        });
    }
}

function ruleDeployFrontend(s: RepoSnapshot, recs: Recommendation[]): void {
    const c = s.changes.sinceFrontendDeploy;
    if (!c || c.empty || c.total === 0) return;
    const feFiles = (c.byCategory.frontend?.length ?? 0) + (c.byCategory.vendored?.length ?? 0);
    if (feFiles > 0) {
        recs.push({
            verb: 'sm deploy frontend',
            reason: `${feFiles} frontend file${feFiles === 1 ? '' : 's'} changed since last push (${s.lastDeploys.frontend!.head.slice(0, 7)})`,
            priority: 65,
        });
    }
}

function ruleDeploySchema(s: RepoSnapshot, recs: Recommendation[]): void {
    if (s.repo !== 'cloud') return;
    // Schema gets special treatment — recommend even without prior deploy,
    // because schema changes are silent and irreversible if forgotten.
    const c = s.changes.sinceSchemaDeploy ?? s.changes.sinceOrigin;
    const schemaFiles = c?.byCategory.schema?.length ?? 0;
    if (schemaFiles > 0) {
        const baseline = s.lastDeploys.schema ? `last apply (${s.lastDeploys.schema.head.slice(0, 7)})` : 'origin';
        recs.push({
            verb: 'sm deploy schema',
            reason: `${schemaFiles} schema file${schemaFiles === 1 ? '' : 's'} changed since ${baseline} — apply before deploying functions that depend on them`,
            priority: 78,
            severity: 'warn',
        });
    }
}

function rulePushPublic(s: RepoSnapshot, recs: Recommendation[]): void {
    if (s.repo !== 'open') return;
    if (s.git.ahead > 0 && s.git.branch === 'main' && !s.git.dirty) {
        recs.push({
            verb: 'sm push-public',
            reason: `${s.git.ahead} commit${s.git.ahead === 1 ? '' : 's'} ahead of origin/main`,
            priority: 55,
        });
    }
}

function ruleRelease(s: RepoSnapshot, recs: Recommendation[]): void {
    if (s.repo !== 'open') return;
    const c = s.changes.sinceOrigin;
    const releaseFiles = c?.byCategory['release-relevant']?.length ?? 0;
    if (releaseFiles > 0) {
        recs.push({
            verb: 'sm release vX.Y.Z',
            reason: `${releaseFiles} smartchats-cli file${releaseFiles === 1 ? '' : 's'} changed since origin — may need a version bump`,
            priority: 50,
        });
    }
}

function ruleShipReady(s: RepoSnapshot, recs: Recommendation[]): void {
    if (s.repo !== 'cloud') return;
    // Apex recommendation: if multiple deployable targets have drift AND state
    // is healthy, suggest the single-command ship.
    const targets: string[] = [];
    if ((s.changes.sinceFunctionsDeploy?.byCategory.functions?.length ?? 0) > 0) targets.push('functions');
    if ((s.changes.sinceFrontendDeploy?.byCategory.frontend?.length ?? 0) > 0) targets.push('frontend');
    if (targets.length >= 2 && !s.git.dirty && s.git.branch === 'main') {
        recs.push({
            verb: 'sm ship',
            reason: `${targets.join(' + ')} both have drift — ship covers both in one go`,
            priority: 95,
            severity: 'info',
        });
    }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export function recommend(s: RepoSnapshot): Recommendation[] {
    const recs: Recommendation[] = [];
    ruleCommitDirty(s, recs);
    ruleVerifyStale(s, recs);
    ruleCloudOpenVerifyGate(s, recs);
    ruleSyncFromOpen(s, recs);
    ruleEnvSymlink(s, recs);
    ruleDeploySchema(s, recs);
    ruleDeployFunctions(s, recs);
    ruleDeployFrontend(s, recs);
    ruleShipReady(s, recs);
    rulePushPublic(s, recs);
    ruleRelease(s, recs);
    // Sort by priority desc, stable.
    return recs.sort((a, b) => b.priority - a.priority);
}
