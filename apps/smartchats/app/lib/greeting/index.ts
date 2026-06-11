/**
 * Public API for templated greetings.
 *
 * The agent's first audible message used to be LLM-generated, paying the
 * full provider TTFT (~1.5–4 s) for what is almost always a wave + a
 * question. This module replaces that with a pure string-interpolation
 * + direct-TTS path: a name from the user KG, a time-aware template,
 * sent straight to the TTS queue. ~500 ms vs ~5 s.
 *
 * See ./README.md for design notes and how to add templates.
 */

import { TEMPLATES, type GreetingTemplate } from './templates';
import { timeBucketAt, type TimeBucket, type TimeBucketContext } from './time_bucket';

export type { TimeBucket } from './time_bucket';

export interface GreetingContext extends TimeBucketContext {
    /** User's display name. Undefined → no-name variants are used. */
    name?: string;
    /** If true, force the 'neutral' bucket (time-agnostic). Defaults to
     *  false (time-aware). */
    forceNeutral?: boolean;
    /** Template ids to avoid (last few spoken — prevents back-to-back
     *  repeats). Defaults to []. */
    excludeRecent?: string[];
    /** Override the default Math.random — for deterministic tests. */
    rand?: () => number;
}

export interface GreetingResult {
    /** The text to speak. Name has already been interpolated (or
     *  fallback form used). */
    text: string;
    /** Stable id of the template that produced this. Useful for
     *  telemetry + the excludeRecent dedup mechanism on the next call. */
    template_id: string;
    /** Which time bucket was used to pick the template. */
    time_bucket: TimeBucket;
    /** True iff `name` was non-empty and got interpolated. */
    has_name: boolean;
}

const LAST_TEMPLATE_KEY = 'smartchats.greeting.last_template_ids';
const RECENT_HISTORY = 3;

export function getGreeting(ctx: GreetingContext = {}): GreetingResult {
    const bucket: TimeBucket = ctx.forceNeutral ? 'neutral' : timeBucketAt(ctx);
    const pool = TEMPLATES[bucket];

    const exclude = new Set(ctx.excludeRecent ?? readRecentFromStorage());
    // First try excluding recents. If that empties the pool (small bucket,
    // long exclude list), drop the exclusion — better to repeat than fail.
    const candidates = pool.filter((t) => !exclude.has(t.id));
    const choices = candidates.length > 0 ? candidates : pool;

    const rand = ctx.rand ?? Math.random;
    const template = choices[Math.floor(rand() * choices.length)];

    const trimmedName = ctx.name?.trim();
    const has_name = !!trimmedName;
    const text = has_name
        ? template.with_name.replaceAll('{name}', trimmedName!)
        : template.without_name;

    writeRecentToStorage(template.id);

    return { text, template_id: template.id, time_bucket: bucket, has_name };
}

/** Inspect the current pool size — useful for tests and for diagnostics. */
export function listTemplates(bucket: TimeBucket): GreetingTemplate[] {
    return TEMPLATES[bucket].slice();
}

function readRecentFromStorage(): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(LAST_TEMPLATE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
    } catch {
        return [];
    }
}

function writeRecentToStorage(id: string): void {
    if (typeof window === 'undefined') return;
    try {
        const current = readRecentFromStorage();
        const next = [id, ...current.filter((x) => x !== id)].slice(0, RECENT_HISTORY);
        window.localStorage.setItem(LAST_TEMPLATE_KEY, JSON.stringify(next));
    } catch { /* localStorage failures are non-fatal */ }
}
