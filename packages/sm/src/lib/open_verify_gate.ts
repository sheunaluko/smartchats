/**
 * Open-verify gate — shared "is the synced code blessed by open?" check.
 *
 * Cloud commands don't usefully re-run verify locally: bin/test-e2e
 * doesn't exist in cloud, and cloud code is rsync'd from open anyway.
 * The verify that matters happens upstream. Cloud just needs to know
 * three things:
 *
 *   1. .synced-from exists, with an open_sha field.
 *   2. ~/.smartchats/sm/last-verify-open.json exists, is OK, and is at
 *      a known SHA.
 *   3. The two SHAs match — meaning what's deployed-from-cloud IS what
 *      open verified.
 *
 * Used by sm status (cloud display line), sm recommend (cloud
 * suggestions), sm deploy {functions,frontend}, sm ship, sm ship-full.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

import { readLastVerify, type LastVerify } from './context.js';
import type { PreflightCheck } from './preflight.js';

export type OpenVerifyGateKind =
    | 'no_sync'        // .synced-from missing or malformed
    | 'no_verify'      // no open verify cache
    | 'verify_failed'  // open verify cache says FAILED
    | 'sha_mismatch'   // synced from open SHA X, open verified at SHA Y
    | 'ok';            // synced SHA matches a passing open verify

export interface OpenVerifyGateState {
    kind: OpenVerifyGateKind;
    /** Short human-readable detail line (one row in a table). */
    detail: string;
    /** Suggested action (omitted when kind === 'ok'). */
    fix?: string;
    /** SHA from .synced-from (when readable). */
    openSha?: string;
    /** ISO datetime from .synced-from. */
    syncedAt?: string;
    /** Commit subject from .synced-from. */
    subject?: string;
    /** The cached open-verify record (when readable). */
    openVerify?: LastVerify;
}

interface SyncedFrom {
    openSha: string;
    syncedAt: string;
    subject: string;
}

function readSyncedFrom(cloudRoot: string): SyncedFrom | null {
    try {
        const raw = fs.readFileSync(path.join(cloudRoot, '.synced-from'), 'utf8');
        const openSha = raw.match(/^open_sha:\s*(.+)$/m)?.[1]?.trim() ?? '';
        const syncedAt = raw.match(/^synced_at:\s*(.+)$/m)?.[1]?.trim() ?? '';
        const subject  = raw.match(/^open_subject:\s*(.+)$/m)?.[1]?.trim() ?? '';
        if (!openSha) return null;
        return { openSha, syncedAt, subject };
    } catch {
        return null;
    }
}

/**
 * Pure data — computes the gate state. Callers adapt to whatever shape
 * they need (preflight check, status line, recommendation, …).
 */
export function computeOpenVerifyGate(cloudRoot: string): OpenVerifyGateState {
    const syncedFrom = readSyncedFrom(cloudRoot);
    if (!syncedFrom) {
        return {
            kind: 'no_sync',
            detail: 'no .synced-from in cloud repo (or missing open_sha field)',
            fix: 'Run `sm sync` first — synced code is the deploy unit.',
        };
    }

    const openVerify = readLastVerify('open');
    if (!openVerify) {
        return {
            kind: 'no_verify',
            openSha: syncedFrom.openSha,
            syncedAt: syncedFrom.syncedAt,
            subject: syncedFrom.subject,
            detail: 'no open verify cached (cloud reads ~/.smartchats/sm/last-verify-open.json)',
            fix: 'In open repo: `sm verify`',
        };
    }
    if (!openVerify.ok) {
        return {
            kind: 'verify_failed',
            openSha: syncedFrom.openSha,
            syncedAt: syncedFrom.syncedAt,
            subject: syncedFrom.subject,
            openVerify,
            detail: `open verify (${openVerify.level}) FAILED on ${openVerify.head.slice(0, 7)}`,
            fix: 'In open repo: fix the failures and re-run `sm verify`.',
        };
    }
    if (openVerify.head !== syncedFrom.openSha) {
        return {
            kind: 'sha_mismatch',
            openSha: syncedFrom.openSha,
            syncedAt: syncedFrom.syncedAt,
            subject: syncedFrom.subject,
            openVerify,
            detail: `synced from open ${syncedFrom.openSha.slice(0, 7)} but open verify is on ${openVerify.head.slice(0, 7)}`,
            fix: 'Either re-sync (`sm sync`) so cloud has the verified code, or re-run `sm verify` in open against the current state.',
        };
    }

    const subjectSnip = syncedFrom.subject
        ? ` — "${syncedFrom.subject.slice(0, 50)}${syncedFrom.subject.length > 50 ? '…' : ''}"`
        : '';
    const syncedAtDisplay = syncedFrom.syncedAt || '(unknown)';
    return {
        kind: 'ok',
        openSha: syncedFrom.openSha,
        syncedAt: syncedFrom.syncedAt,
        subject: syncedFrom.subject,
        openVerify,
        detail: `open ${openVerify.level} passed on ${syncedFrom.openSha.slice(0, 7)}${subjectSnip} (synced ${syncedAtDisplay})`,
    };
}

/**
 * Adapt the gate state to a preflight check, with the label and severity
 * driven by the kind.
 */
export function openVerifyGateAsCheck(state: OpenVerifyGateState): PreflightCheck {
    const label = (() => {
        switch (state.kind) {
            case 'no_sync':        return 'sync state';
            case 'no_verify':      return 'open verify';
            case 'verify_failed':  return 'open verify';
            case 'sha_mismatch':   return 'open verify SHA';
            case 'ok':             return 'open verify + sync';
        }
    })();
    const severity = state.kind === 'ok' ? 'pass' : 'block';
    return { label, severity, detail: state.detail, fix: state.fix };
}

/**
 * Is the open-verify record strong enough for this command? `levels` is
 * the set of acceptable verify levels (e.g. ['all', 'e2e'] for
 * ship-full's full-coverage gate). Returns null if the gate isn't 'ok'
 * (caller will surface the underlying problem first); returns a string
 * detail if the open verify passed but at too weak a level; null if ok.
 */
export function checkOpenVerifyLevel(
    state: OpenVerifyGateState,
    levels: string[],
): string | null {
    if (state.kind !== 'ok' || !state.openVerify) return null;
    if (levels.includes(state.openVerify.level)) return null;
    return `open verify was at level "${state.openVerify.level}"; this command expects one of: ${levels.join(', ')}`;
}
