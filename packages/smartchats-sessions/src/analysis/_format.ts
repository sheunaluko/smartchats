/**
 * Formatting + statistical helpers shared across analysis modules.
 *
 * Pure — no I/O, no Node-only APIs.
 */

/** Epoch ms → 'HH:MM:SS.mmm' in the runtime's local timezone. */
export function fmtClock(ms: number | undefined | null): string {
    if (!ms) return '--:--:--.---';
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms3 = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms3}`;
}

/** ms → human-readable duration. */
export function fmtDuration(ms: number | undefined | null): string {
    if (ms === null || ms === undefined) return '?';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
    const m = Math.floor(ms / 60_000);
    const s = (ms % 60_000) / 1000;
    return `${m}m${s.toFixed(1)}s`;
}

/** Truncate string to n chars, appending "… (+N chars)" indicator. */
export function truncate(text: unknown, n: number = 200): string {
    if (text === null || text === undefined) return '';
    const s = typeof text === 'string' ? text : JSON.stringify(text);
    if (s.length <= n) return s;
    return s.slice(0, n).trimEnd() + `… (+${s.length - n} chars)`;
}

/** Linear-interpolation percentile (0–100). Returns null for empty input. */
export function percentile(values: number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 1) return sorted[0];
    const k = (sorted.length - 1) * (p / 100);
    const f = Math.floor(k);
    const c = Math.min(f + 1, sorted.length - 1);
    if (f === c) return sorted[f];
    return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

/** Sum of numeric array. */
export function sum(values: number[]): number {
    return values.reduce((a, b) => a + b, 0);
}

/** Indent every line in s by `prefix`. */
export function indent(s: string, prefix: string = '  '): string {
    return s
        .split('\n')
        .map((line) => (line.length > 0 ? prefix + line : line))
        .join('\n');
}
