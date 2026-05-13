/**
 * transcript — conversation extraction from a session bundle.
 *
 * Produces an ordered list of turns: user inputs, agent thoughts/responses,
 * and (optionally) the code the agent executed to fulfill the turn.
 *
 * Sources:
 *   • user_input.payload.context.content           → user turn
 *   • llm_invocation.payload.context.output.{thoughts, response, code}
 *                                                  → agent turn (success only)
 *   • llm_cancel                                   → interruption marker
 *
 * Note: `llm_invocation.payload.context.response` is a duplicate of
 * `output.response` provided by the cortex runner for convenience; we
 * always read the structured `output` so we get `thoughts` and `code` too.
 */

import type { SessionBundle, SessionTimelineEntry } from '../types.js';
import { fmtClock, truncate } from './_format.js';

export type TurnRole = 'user' | 'agent_thoughts' | 'agent' | 'agent_code' | 'interrupt';

export interface TranscriptTurn {
    timestamp: number;
    role: TurnRole;
    text: string;
    /** Source event id — lets a reader cross-reference with `session_inspect`. */
    event_id: string;
}

export interface TranscriptResult {
    session_id: string;
    turns: TranscriptTurn[];
}

interface LlmOutput {
    thoughts?: string;
    response?: string;
    code?: string;
}

function readLlmOutput(entry: SessionTimelineEntry): LlmOutput | null {
    const ctx = entry.payload?.context as { output?: LlmOutput; response?: string } | undefined;
    if (!ctx) return null;
    // Prefer structured output; fall back to flat response field (older shape).
    if (ctx.output && typeof ctx.output === 'object') return ctx.output;
    if (typeof ctx.response === 'string') return { response: ctx.response };
    return null;
}

export function analyzeTranscript(
    bundle: SessionBundle,
    opts: { withCode?: boolean } = {},
): TranscriptResult {
    const turns: TranscriptTurn[] = [];
    for (const e of bundle.timeline) {
        if (e.event_type === 'user_input') {
            const text = (e.payload?.context as { content?: string } | undefined)?.content;
            if (typeof text === 'string' && text.trim()) {
                turns.push({ timestamp: e.timestamp, role: 'user', text, event_id: e.event_id });
            }
        } else if (e.event_type === 'llm_invocation') {
            const status = e.payload?.status as string | undefined;
            if (status && status !== 'success') continue;
            const out = readLlmOutput(e);
            if (!out) continue;
            if (out.thoughts && out.thoughts.trim()) {
                turns.push({ timestamp: e.timestamp, role: 'agent_thoughts', text: out.thoughts, event_id: e.event_id });
            }
            if (out.response && out.response.trim()) {
                turns.push({ timestamp: e.timestamp, role: 'agent', text: out.response, event_id: e.event_id });
            }
            if (opts.withCode && out.code && out.code.trim()) {
                turns.push({ timestamp: e.timestamp, role: 'agent_code', text: out.code, event_id: e.event_id });
            }
        } else if (e.event_type === 'llm_cancel') {
            turns.push({
                timestamp: e.timestamp,
                role: 'interrupt',
                text: '(user interrupted the agent)',
                event_id: e.event_id,
            });
        }
    }
    return { session_id: bundle.session_id, turns };
}

export interface TranscriptFormatOpts {
    markdown?: boolean;
    /** Include the wall-clock prefix on each turn. Default false for clean reading. */
    timestamps?: boolean;
    /** Suppress agent thoughts. Default false (thoughts included). */
    hideThoughts?: boolean;
}

export function formatTranscript(
    result: TranscriptResult,
    opts: TranscriptFormatOpts = {},
): string {
    const lines: string[] = [];
    if (opts.markdown) {
        lines.push(`# Session Transcript — \`${result.session_id}\``, '', '---', '');
    }

    for (const turn of result.turns) {
        if (opts.hideThoughts && turn.role === 'agent_thoughts') continue;
        const ts = opts.timestamps ? `[${fmtClock(turn.timestamp)}] ` : '';
        if (opts.markdown) {
            switch (turn.role) {
                case 'user':
                    lines.push(`${ts}**User:** ${turn.text}`); break;
                case 'agent_thoughts':
                    lines.push(`${ts}*Agent (thinking):* ${truncate(turn.text, 600)}`); break;
                case 'agent':
                    lines.push(`${ts}**Agent:** ${turn.text}`); break;
                case 'agent_code':
                    lines.push(`${ts}**Agent (code):**`, '```js', turn.text, '```'); break;
                case 'interrupt':
                    lines.push(`${ts}> ${turn.text}`); break;
            }
            lines.push('');
        } else {
            switch (turn.role) {
                case 'user':            lines.push(`${ts}[USER] ${turn.text}`); break;
                case 'agent_thoughts':  lines.push(`${ts}[THOUGHTS] ${truncate(turn.text, 600)}`); break;
                case 'agent':           lines.push(`${ts}[AGENT] ${turn.text}`); break;
                case 'agent_code':      lines.push(`${ts}[AGENT CODE]\n${turn.text}`); break;
                case 'interrupt':       lines.push(`${ts}[INTERRUPT] ${turn.text}`); break;
            }
            lines.push('');
        }
    }
    return lines.join('\n').trimEnd() + '\n';
}
