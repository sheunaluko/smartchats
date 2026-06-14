/**
 * Output renderers shared across analysis_db/ formatters.
 *
 * Each module's `formatX(result, opts)` picks the appropriate renderer
 * by `opts.format`. Pure — no I/O.
 */

export type OutputFormat = 'text' | 'table' | 'json' | 'csv' | 'markdown';

export interface FormatOpts {
    /** Output format. Default 'text' (which most modules render as a plain table). */
    format?: OutputFormat;
    /** Truncate long string values to this many chars (table / markdown only). */
    truncate?: number;
}

// ────────────────────────────────────────────────────────────────────────
// Renderers
// ────────────────────────────────────────────────────────────────────────

/**
 * Render rows as a fixed-width text table. Columns inferred from the
 * first row's keys (or all-row union to handle sparse rows). Values are
 * rendered via `String(v)` with null/undefined as empty string.
 *
 * Stable column ordering: if `columns` is omitted, uses
 * `Object.keys(rows[0])` then appends any additional keys discovered
 * in later rows.
 */
export function renderTable(
    rows: Record<string, unknown>[],
    opts: { columns?: string[]; truncate?: number } = {},
): string {
    if (rows.length === 0) return '(no rows)';

    const columns = opts.columns ?? inferColumns(rows);
    const truncN = opts.truncate ?? 60;

    // Stringify every cell once.
    const cells: string[][] = rows.map((r) =>
        columns.map((c) => fmtCell(r[c], truncN)),
    );

    // Column widths: header vs max cell.
    const widths = columns.map((c, i) =>
        Math.max(c.length, ...cells.map((row) => row[i]!.length)),
    );

    const lines: string[] = [];
    lines.push(columns.map((c, i) => c.padEnd(widths[i]!)).join('  '));
    lines.push(widths.map((w) => '─'.repeat(w)).join('  '));
    for (const row of cells) {
        lines.push(row.map((v, i) => v.padEnd(widths[i]!)).join('  '));
    }
    return lines.join('\n');
}

/** Render rows as CSV (RFC 4180-ish — double-quote escaping). */
export function renderCsv(
    rows: Record<string, unknown>[],
    opts: { columns?: string[] } = {},
): string {
    if (rows.length === 0) return '';
    const columns = opts.columns ?? inferColumns(rows);
    const lines: string[] = [columns.map(csvEscape).join(',')];
    for (const r of rows) {
        lines.push(columns.map((c) => csvEscape(fmtScalar(r[c]))).join(','));
    }
    return lines.join('\n');
}

/**
 * Render rows as a markdown table. Suitable for pasting into a markdown
 * report. Stops at 200 rows by default — long tables aren't useful in
 * markdown viewers.
 */
export function renderMarkdownTable(
    rows: Record<string, unknown>[],
    opts: { columns?: string[]; truncate?: number; maxRows?: number } = {},
): string {
    if (rows.length === 0) return '_(no rows)_';
    const maxRows = opts.maxRows ?? 200;
    const trimmed = rows.length > maxRows ? rows.slice(0, maxRows) : rows;
    const columns = opts.columns ?? inferColumns(rows);
    const truncN = opts.truncate ?? 60;

    const lines: string[] = [];
    lines.push(`| ${columns.join(' | ')} |`);
    lines.push(`| ${columns.map(() => '---').join(' | ')} |`);
    for (const r of trimmed) {
        lines.push(`| ${columns.map((c) => mdEscape(fmtCell(r[c], truncN))).join(' | ')} |`);
    }
    if (rows.length > maxRows) {
        lines.push('');
        lines.push(`_(${rows.length - maxRows} more rows truncated)_`);
    }
    return lines.join('\n');
}

/** Render rows as pretty JSON. */
export function renderJson(rows: unknown): string {
    return JSON.stringify(rows, null, 2);
}

/**
 * Pick the right renderer for `opts.format`. Each module's `formatX`
 * normally calls this directly after wrapping its specific result in a
 * row array.
 */
export function renderRows(
    rows: Record<string, unknown>[],
    opts: FormatOpts & { columns?: string[] } = {},
): string {
    const format = opts.format ?? 'text';
    switch (format) {
        case 'json':     return renderJson(rows);
        case 'csv':      return renderCsv(rows, { columns: opts.columns });
        case 'markdown': return renderMarkdownTable(rows, { columns: opts.columns, truncate: opts.truncate });
        case 'table':
        case 'text':
        default:         return renderTable(rows, { columns: opts.columns, truncate: opts.truncate });
    }
}

// ────────────────────────────────────────────────────────────────────────
// Cell formatting helpers
// ────────────────────────────────────────────────────────────────────────

function inferColumns(rows: Record<string, unknown>[]): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const r of rows) {
        for (const k of Object.keys(r)) {
            if (!seen.has(k)) { seen.add(k); ordered.push(k); }
        }
    }
    return ordered;
}

function fmtCell(v: unknown, truncN: number): string {
    const s = fmtScalar(v);
    return s.length > truncN ? s.slice(0, truncN - 1) + '…' : s;
}

function fmtScalar(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') {
        if (Number.isInteger(v)) return v.toLocaleString();
        return v.toFixed(4);
    }
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return JSON.stringify(v);
}

function csvEscape(s: string): string {
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

function mdEscape(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

// ────────────────────────────────────────────────────────────────────────
// Small formatters
// ────────────────────────────────────────────────────────────────────────

/** ms → human-readable duration (matches analysis/_format.ts conventions). */
export function fmtDuration(ms: number | undefined | null): string {
    if (ms === null || ms === undefined) return '?';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
    const m = Math.floor(ms / 60_000);
    const s = (ms % 60_000) / 1000;
    return `${m}m${s.toFixed(1)}s`;
}

/** USD with 4 decimals when small, 2 when ≥ $1. */
export function fmtUsd(usd: number | undefined | null): string {
    if (usd === null || usd === undefined) return '$?';
    if (Math.abs(usd) >= 1) return `$${usd.toFixed(2)}`;
    return `$${usd.toFixed(4)}`;
}
