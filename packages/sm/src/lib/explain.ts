/**
 * Explain framework.
 *
 * Every verb in `sm` carries a structured Explain descriptor. The same
 * descriptor powers two surfaces:
 *
 *   - `sm explain <verb>` — prints everything the verb does, before doing it,
 *     including which toggles are active right now (cloud vs local, emulator
 *     vs prod, docker vs binary, etc.) so the user doesn't have to remember.
 *   - destructive verbs — print the descriptor as a preflight summary and
 *     ask for confirmation before running.
 *
 * The descriptor is intentionally human-shaped (not machine-shaped). It's a
 * memory aid for the maintainer: "I'm in this mode right now, and here's
 * what that means."
 */

export interface ExplainToggle {
    /** Label shown to the user (e.g. "target", "stack runtime"). */
    label: string;
    /** Currently-detected value. */
    current: string;
    /** What that value means for this verb's behavior. */
    impact: string;
    /** Other values this toggle could have, and what each would do. */
    alternatives?: Array<{ value: string; impact: string }>;
}

export interface ExplainContext {
    /** Short label (e.g. "functions/.env symlink", "stripe listen tunnel"). */
    label: string;
    /** Currently-detected value, or "missing" / "not running" / "unknown". */
    current: string;
    /** Why it matters for this verb. */
    impact: string;
    /** ok / warn / error / unknown — drives the prefix glyph. */
    status: 'ok' | 'warn' | 'error' | 'unknown';
}

export interface ExplainSideEffect {
    /** Network egress, disk writes, processes spawned, deploys, etc. */
    kind: 'network' | 'disk' | 'process' | 'deploy' | 'git' | 'none';
    description: string;
}

export interface Explain {
    /** The verb itself (e.g. "verify e2e", "deploy functions"). */
    verb: string;
    /** One-line summary. */
    summary: string;
    /** Who runs this. */
    audience: 'end-user' | 'maintainer' | 'both';
    /** Which repo this verb is valid in. */
    repos: Array<'open' | 'cloud'>;
    /** Toggles whose value changes how this verb behaves. */
    toggles: ExplainToggle[];
    /** Detected prerequisites and ambient state. */
    context: ExplainContext[];
    /** Ordered narrative of what the verb will do. */
    steps: string[];
    /** Side effects the verb produces. */
    sideEffects: ExplainSideEffect[];
    /** Common pitfalls; things the maintainer always forgets. */
    gotchas: string[];
    /** Related verbs / alternatives the user might have meant. */
    seeAlso?: string[];
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const COLORS = {
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    gray: '\x1b[90m',
};

function colorize(s: string, color: keyof typeof COLORS): string {
    if (process.env.NO_COLOR || !process.stdout.isTTY) return s;
    return `${COLORS[color]}${s}${COLORS.reset}`;
}

function glyphFor(status: ExplainContext['status']): string {
    switch (status) {
        case 'ok': return colorize('✓', 'green');
        case 'warn': return colorize('⚠', 'yellow');
        case 'error': return colorize('✗', 'red');
        case 'unknown': return colorize('?', 'gray');
    }
}

function sectionHeader(title: string): string {
    return colorize(title, 'bold');
}

function indent(s: string, spaces = 2): string {
    const prefix = ' '.repeat(spaces);
    return s.split('\n').map(line => line ? prefix + line : line).join('\n');
}

export function renderExplain(e: Explain): string {
    const lines: string[] = [];

    lines.push(colorize(`sm ${e.verb}`, 'cyan') + colorize(` — ${e.summary}`, 'dim'));
    lines.push('');
    lines.push(`Audience: ${e.audience}    Valid in: ${e.repos.join(', ')} repo${e.repos.length > 1 ? 's' : ''}`);
    lines.push('');

    if (e.toggles.length > 0) {
        lines.push(sectionHeader('Active toggles'));
        for (const t of e.toggles) {
            lines.push(`  ${colorize(t.label, 'bold')}: ${t.current}`);
            lines.push(indent(`↳ ${t.impact}`, 6));
            if (t.alternatives && t.alternatives.length > 0) {
                for (const alt of t.alternatives) {
                    lines.push(indent(colorize(`alt: ${alt.value} — ${alt.impact}`, 'dim'), 6));
                }
            }
        }
        lines.push('');
    }

    if (e.context.length > 0) {
        lines.push(sectionHeader('Detected context'));
        for (const c of e.context) {
            lines.push(`  ${glyphFor(c.status)} ${c.label}: ${c.current}`);
            lines.push(indent(colorize(`↳ ${c.impact}`, 'dim'), 4));
        }
        lines.push('');
    }

    lines.push(sectionHeader('What it does'));
    e.steps.forEach((step, i) => {
        lines.push(`  ${i + 1}. ${step}`);
    });
    lines.push('');

    if (e.sideEffects.length > 0) {
        lines.push(sectionHeader('Side effects'));
        for (const se of e.sideEffects) {
            const tag = se.kind === 'none' ? '—' : `[${se.kind}]`;
            lines.push(`  ${colorize(tag, 'dim')} ${se.description}`);
        }
        lines.push('');
    }

    if (e.gotchas.length > 0) {
        lines.push(sectionHeader('Gotchas'));
        for (const g of e.gotchas) {
            lines.push(`  ${colorize('!', 'yellow')} ${g}`);
        }
        lines.push('');
    }

    if (e.seeAlso && e.seeAlso.length > 0) {
        lines.push(sectionHeader('See also'));
        for (const s of e.seeAlso) {
            lines.push(`  ${colorize(s, 'cyan')}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}
