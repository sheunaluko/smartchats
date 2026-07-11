/**
 * Issue events — a structured signal that something is worth a human's
 * later attention.
 *
 * Issues land in the same `insights_events` table as everything else,
 * under `event_type: 'issue'`, with discrimination via `payload.kind`.
 *
 * Design choices:
 *
 *   - `kind` is a free-form string, not an enum. New kinds can ship from
 *     anywhere (agent tools, future detectors, manual flags) without
 *     touching this module. The DB analyzer groups by whatever strings
 *     show up.
 *
 *   - `source` is also free-form. Names where the emission originated
 *     ('agent.report_issue', 'scm.build', 'tool_dispatcher.update_workspace',
 *     etc.) so post-hoc analysis can attribute reports.
 *
 *   - `severity` IS a fixed enum. The DB analyzer renders severity
 *     consistently across kinds and would degrade if every emitter
 *     invented their own scale.
 *
 *   - `detail` is opaque per-kind metadata. Each kind defines its own
 *     shape; the type system stays permissive at the issue layer.
 *
 *   - No status field. Issue events are point-in-time observations;
 *     handled-state lives in the triage layer (data/triage/handled.json
 *     in smartchats-sessions), same as for errors today.
 */

export type IssueSeverity = 'info' | 'warning' | 'error';

/**
 * Payload shape of an `event_type: 'issue'` row.
 *
 * Construct via `buildIssuePayload` or just spread directly into a call
 * to the insights emit path — both produce the same object.
 */
export interface IssuePayload {
    /** Free-form category (snake_case convention). E.g. 'tool_misbehavior'. */
    kind: string;
    /** Free-form emitter identity. E.g. 'agent.report_issue', 'scm.build'. */
    source: string;
    severity: IssueSeverity;
    /** One-line human-readable summary. The first thing a reviewer sees. */
    summary: string;
    /** Optional per-kind metadata. Shape is up to the emitter. */
    detail?: Record<string, unknown>;
    /**
     * Optional pointer at the underlying event that triggered this issue
     * (e.g. the llm_invocation event_id whose input_tokens spiked).
     */
    triggering_event_id?: string;
}

export interface BuildIssuePayloadArgs {
    kind: string;
    severity: IssueSeverity;
    summary: string;
    source?: string;
    detail?: Record<string, unknown>;
    triggering_event_id?: string;
}

/**
 * Normalizes and returns an IssuePayload. Trims string fields, defaults
 * `source` to 'unknown' when omitted (callers should always pass one but
 * we don't want a missing source to bomb the emit path).
 */
export function buildIssuePayload(args: BuildIssuePayloadArgs): IssuePayload {
    const kind = String(args.kind ?? '').trim();
    const summary = String(args.summary ?? '').trim();
    const source = String(args.source ?? 'unknown').trim() || 'unknown';

    if (!kind) throw new Error('buildIssuePayload: kind is required');
    if (!summary) throw new Error('buildIssuePayload: summary is required');
    if (!isValidSeverity(args.severity)) {
        throw new Error(`buildIssuePayload: severity must be 'info' | 'warning' | 'error', got: ${String(args.severity)}`);
    }

    const payload: IssuePayload = {
        kind,
        source,
        severity: args.severity,
        summary,
    };
    if (args.detail && typeof args.detail === 'object') payload.detail = args.detail;
    if (args.triggering_event_id) payload.triggering_event_id = String(args.triggering_event_id);
    return payload;
}

/** Canonical event_type string for issue events. */
export const ISSUE_EVENT_TYPE = 'issue';

export function isValidSeverity(v: unknown): v is IssueSeverity {
    return v === 'info' || v === 'warning' || v === 'error';
}

// ──────────────────────────────────────────────────────────────────────────
// Triage status marks — DB-native handled-state
//
// Marking an issue kind or an error signature as fixed / wontfix /
// investigating is itself a point-in-time observation, so it goes on
// `insights_events` as a normal event row rather than a mutable side
// table. Latest event per target wins. Append-only preserves history
// (mark fixed → later mark investigating → back to fixed is all visible).
//
// Two parallel event types because the target-identifier shape differs:
//   • issues target a kind (stable snake_case string)
//   • errors target a signature_hash (16-hex, from the DB analyzer)
// ──────────────────────────────────────────────────────────────────────────

export type TriageStatus = 'fixed' | 'wontfix' | 'investigating';

export function isValidTriageStatus(v: unknown): v is TriageStatus {
    return v === 'fixed' || v === 'wontfix' || v === 'investigating';
}

/** Payload of an `event_type: 'issue_status_change'` row. */
export interface IssueStatusChangePayload {
    /** The issue kind being marked. */
    issue_kind: string;
    status: TriageStatus;
    /** ISO datetime — required when status='fixed' (drives regression detection). */
    fixed_at?: string;
    /** Commit sha that introduced the fix. */
    fixed_in_commit?: string;
    /** Free-form notes. */
    notes?: string;
    /** Optional whoami output at mark time. */
    marked_by?: string;
}

/** Payload of an `event_type: 'error_status_change'` row. */
export interface ErrorStatusChangePayload {
    /** 16-hex signature hash (matches DB analyzer's row key). */
    signature_hash: string;
    /** Truncated raw signature — surfaces in audit output for human-readability. */
    signature_preview: string;
    status: TriageStatus;
    fixed_at?: string;
    fixed_in_commit?: string;
    notes?: string;
    marked_by?: string;
}

export const ISSUE_STATUS_CHANGE_EVENT_TYPE = 'issue_status_change';
export const ERROR_STATUS_CHANGE_EVENT_TYPE = 'error_status_change';

interface BuildStatusChangeArgs {
    status: TriageStatus;
    fixed_at?: string;
    fixed_in_commit?: string;
    notes?: string;
    marked_by?: string;
}

export function buildIssueStatusChangePayload(
    args: BuildStatusChangeArgs & { issue_kind: string },
): IssueStatusChangePayload {
    if (!isValidTriageStatus(args.status)) {
        throw new Error(`buildIssueStatusChangePayload: invalid status: ${String(args.status)}`);
    }
    const issue_kind = String(args.issue_kind ?? '').trim();
    if (!issue_kind) throw new Error('buildIssueStatusChangePayload: issue_kind is required');
    if (args.status === 'fixed' && !args.fixed_at) {
        throw new Error('buildIssueStatusChangePayload: fixed_at is required when status=fixed');
    }
    const p: IssueStatusChangePayload = { issue_kind, status: args.status };
    if (args.fixed_at) p.fixed_at = args.fixed_at;
    if (args.fixed_in_commit) p.fixed_in_commit = args.fixed_in_commit;
    if (args.notes) p.notes = args.notes;
    if (args.marked_by) p.marked_by = args.marked_by;
    return p;
}

export function buildErrorStatusChangePayload(
    args: BuildStatusChangeArgs & { signature_hash: string; signature_preview: string },
): ErrorStatusChangePayload {
    if (!isValidTriageStatus(args.status)) {
        throw new Error(`buildErrorStatusChangePayload: invalid status: ${String(args.status)}`);
    }
    const signature_hash = String(args.signature_hash ?? '').trim();
    if (!signature_hash) throw new Error('buildErrorStatusChangePayload: signature_hash is required');
    if (args.status === 'fixed' && !args.fixed_at) {
        throw new Error('buildErrorStatusChangePayload: fixed_at is required when status=fixed');
    }
    const p: ErrorStatusChangePayload = {
        signature_hash,
        signature_preview: String(args.signature_preview ?? '').trim(),
        status: args.status,
    };
    if (args.fixed_at) p.fixed_at = args.fixed_at;
    if (args.fixed_in_commit) p.fixed_in_commit = args.fixed_in_commit;
    if (args.notes) p.notes = args.notes;
    if (args.marked_by) p.marked_by = args.marked_by;
    return p;
}
