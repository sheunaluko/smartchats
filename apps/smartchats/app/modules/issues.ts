/**
 * Issues module: report_issue
 *
 * Lets the agent file a structured `issue` event that the SmartChats
 * developers will review during triage. Emits through the insights
 * client (same path as every other agent event), tagged
 * `event_type: 'issue'` so the DB analyzer can roll them up.
 */

import {
    ISSUE_EVENT_TYPE,
    buildIssuePayload,
    isValidSeverity,
} from 'smartchats-common';

// ── System message ───────────────────────────────────────────────────────────

const ISSUES_SYSTEM_MSG = `
You have a tool called \`report_issue\` for filing structured issues that
the SmartChats development team reviews during triage. These reports
become part of the engineering backlog — treat them with weight and use
them to improve the system.

WHEN TO FILE:

- The user encounters a bug, wrong answer, or behavior that doesn't
  match what they asked for.
- You notice something off in the system itself: a tool returning
  garbage, a slow operation that shouldn't be slow, a recurring error,
  a misleading response you generated and want flagged for review.
- A clear user-experience friction worth surfacing (a clunky flow, a
  missing affordance the user worked around).
- A justifiable, concrete feature request the user expressed or that
  you observed a real gap for. NOT speculative "wouldn't it be cool" —
  only when there is a real, articulated need.
- Anytime the user EXPLICITLY asks you to file an issue. Their request
  is sufficient justification — do not push back, do not talk them out
  of it. File it.

WHEN NOT TO FILE:

- For normal chat, log entries, or transient failures that resolved on
  retry. Use \`save_log\` for things the user wants to remember; reserve
  \`report_issue\` for things a developer should act on.

HOW TO FILE:

- \`kind\` is a free-form short string in snake_case describing the
  category. Examples: \`weird_llm_response\`, \`tool_misbehavior\`,
  \`slow_dream_save\`, \`feature_request_voice_replay\`,
  \`user_flagged_session\`, \`onboarding_friction\`. Pick a specific
  string that groups well.
- \`severity\` is one of:
    'info'    — observation worth knowing but not blocking
    'warning' — degraded experience or a real bug that didn't break things
    'error'   — something broken, user-impacting, needs attention
  When the user files unprompted, default to 'warning' unless they
  signal otherwise.
- \`summary\` is one short sentence the engineer will read first. Be
  specific. Bad: "something is wrong". Good: "save_log silently failed
  on a dream entry — UI showed success, DB returned no row".
- \`detail\` (optional) is a free-form object — include the relevant
  context: function names, user inputs, observed vs expected behavior,
  recent error messages, anything that helps the reviewer reproduce.

After filing, briefly confirm to the user that you've filed it (one
sentence). Don't be performative about it.
`.trim();

// ── Module ───────────────────────────────────────────────────────────────────

export function createIssuesModule() {
    return {
        id: 'issues',
        name: 'Issues',
        position: 28,
        system_msg: ISSUES_SYSTEM_MSG,
        functions: [
            {
                enabled: true,
                description:
                    'File a structured issue event for the SmartChats developers to review. Use for bugs, real UX friction, justified feature requests, or anytime the user explicitly asks to file an issue. Do NOT use for normal conversation or save_log purposes.',
                name: 'report_issue',
                return_shape: `Success: { reported: true, kind: string, severity: 'info' | 'warning' | 'error' }. Validation error: { reported: false, error: string }.`,
                parameters: {
                    kind: 'string',
                    severity: 'string',
                    summary: 'string',
                    detail: 'object',
                    triggering_event_id: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util;
                    const { kind, severity, summary, detail, triggering_event_id } = ops.params || {};

                    if (!kind || !String(kind).trim()) {
                        return { reported: false, error: 'kind is required' };
                    }
                    if (!summary || !String(summary).trim()) {
                        return { reported: false, error: 'summary is required' };
                    }
                    if (!isValidSeverity(severity)) {
                        return {
                            reported: false,
                            error: `severity must be 'info' | 'warning' | 'error', got: ${String(severity)}`,
                        };
                    }

                    let payload;
                    try {
                        payload = buildIssuePayload({
                            kind: String(kind),
                            severity,
                            summary: String(summary),
                            source: 'agent.report_issue',
                            detail: detail && typeof detail === 'object' ? detail : undefined,
                            triggering_event_id: triggering_event_id ? String(triggering_event_id) : undefined,
                        });
                    } catch (err: any) {
                        return { reported: false, error: err?.message ?? String(err) };
                    }

                    log(`report_issue: kind=${payload.kind} severity=${payload.severity}`);

                    // addInsightEvent writes directly to insights_events via
                    // the InsightsClient — same path cortex's internal
                    // telemetry uses for llm_invocation / execution. Do NOT
                    // use ops.util.event here: that's the orchestrator/UI
                    // event bus, and unless useOrchestrator.handleEvent has
                    // an explicit case + addEvent forward for the type,
                    // nothing lands in insights. This is exactly the silent-
                    // drop bug the first version of this module had.
                    ops.util.addInsightEvent?.(ISSUE_EVENT_TYPE, payload);

                    return {
                        reported: true,
                        kind: payload.kind,
                        severity: payload.severity,
                    };
                },
                return_type: 'object',
            },
        ],
    };
}
