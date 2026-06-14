/**
 * Preflight runner.
 *
 * Every destructive verb (`sm deploy *`, `sm ship`, `sm release`,
 * `sm push-public`, `sm rollback *`) routes through here:
 *
 *   1. Print the explain descriptor as a "here's what will happen" summary.
 *   2. Run the verb's checks (clean tree, correct env symlink, etc.). Each
 *      check has a severity: `pass`, `warn`, `block`.
 *   3. If any `block` → refuse with reasoning.
 *   4. If only `warn` → print + ask Y/n (unless --yes / non-TTY for CI).
 *   5. If only `pass` → proceed silently (or with --explain, print + exit).
 *
 * The descriptor + checks together are the user-facing "I'm about to do X"
 * preview — meaning the user never has to remember which file is symlinked
 * or which mode is active. The CLI tells them up front.
 */

import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { Explain } from './explain.js';
import { renderExplain } from './explain.js';

export type CheckSeverity = 'pass' | 'warn' | 'block';

export interface PreflightCheck {
    label: string;
    severity: CheckSeverity;
    detail: string;
    /** Optional suggestion shown when the check fails. */
    fix?: string;
}

export interface PreflightOptions {
    /** The verb's descriptor. Rendered as the preflight summary. */
    descriptor: Explain;
    /** Checks to run. Order matters — first block stops execution. */
    checks: PreflightCheck[];
    /** Skip the interactive prompt. CI sets this via --yes. */
    autoConfirm?: boolean;
    /** If true: print descriptor + checks, then return false (don't run). */
    explainOnly?: boolean;
}

export interface PreflightResult {
    proceed: boolean;
    reason?: string;
}

const C = {
    bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m',
    cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', green: '\x1b[32m', gray: '\x1b[90m',
};
const color = (s: string, k: keyof typeof C) =>
    (process.env.NO_COLOR || !process.stdout.isTTY) ? s : `${C[k]}${s}${C.reset}`;

function glyph(sev: CheckSeverity): string {
    switch (sev) {
        case 'pass': return color('✓', 'green');
        case 'warn': return color('⚠', 'yellow');
        case 'block': return color('✗', 'red');
    }
}

function severityWeight(sev: CheckSeverity): number {
    switch (sev) {
        case 'pass': return 0;
        case 'warn': return 1;
        case 'block': return 2;
    }
}

function summarize(checks: PreflightCheck[]): { blocks: PreflightCheck[]; warns: PreflightCheck[] } {
    const blocks = checks.filter(c => c.severity === 'block');
    const warns = checks.filter(c => c.severity === 'warn');
    return { blocks, warns };
}

/**
 * Run the preflight flow. Returns whether the caller should proceed with the
 * verb's actual side effects.
 */
export async function preflight(opts: PreflightOptions): Promise<PreflightResult> {
    console.log(renderExplain(opts.descriptor));

    console.log(color('Preflight checks', 'bold'));
    for (const c of opts.checks) {
        console.log(`  ${glyph(c.severity)} ${c.label}: ${c.detail}`);
        if (c.severity !== 'pass' && c.fix) {
            console.log(`    ${color('→ ' + c.fix, 'dim')}`);
        }
    }
    console.log('');

    if (opts.explainOnly) {
        console.log(color('(explain-only — not running)', 'dim'));
        return { proceed: false, reason: 'explain-only' };
    }

    const { blocks, warns } = summarize(opts.checks);

    if (blocks.length > 0) {
        console.log(color(`✗ Blocked by ${blocks.length} check${blocks.length === 1 ? '' : 's'}.`, 'red'));
        return { proceed: false, reason: `blocked: ${blocks.map(b => b.label).join(', ')}` };
    }

    if (opts.autoConfirm) {
        console.log(color('--yes provided; proceeding without prompt.', 'dim'));
        return { proceed: true };
    }

    if (!stdin.isTTY) {
        // Non-interactive (e.g. piped from a script). Refuse unless --yes,
        // otherwise the maintainer has no way to abort.
        console.log(color('✗ Non-interactive shell and --yes not set; refusing to proceed.', 'red'));
        return { proceed: false, reason: 'non-interactive without --yes' };
    }

    const warnSuffix = warns.length > 0 ? color(` (${warns.length} warning${warns.length === 1 ? '' : 's'})`, 'yellow') : '';
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
        const answer = (await rl.question(color(`Proceed?${warnSuffix} [y/N] `, 'bold'))).trim().toLowerCase();
        if (answer === 'y' || answer === 'yes') {
            return { proceed: true };
        }
        return { proceed: false, reason: 'declined at prompt' };
    } finally {
        rl.close();
    }
}

/**
 * Parse the common flags every destructive verb accepts.
 */
export interface CommonFlags {
    yes: boolean;
    explain: boolean;
    dryRun: boolean;
    /** Positional + non-flag args, in order. */
    positional: string[];
    /** Args after `--`, forwarded to wrapped scripts. */
    passthrough: string[];
}

export function parseCommonFlags(argv: string[]): CommonFlags {
    const dashDash = argv.indexOf('--');
    const head = dashDash >= 0 ? argv.slice(0, dashDash) : argv;
    const passthrough = dashDash >= 0 ? argv.slice(dashDash + 1) : [];
    const positional: string[] = [];
    let yes = false, explain = false, dryRun = false;
    for (const arg of head) {
        if (arg === '--yes' || arg === '-y') yes = true;
        else if (arg === '--explain') explain = true;
        else if (arg === '--dry-run') dryRun = true;
        else if (!arg.startsWith('-')) positional.push(arg);
        // unknown flags fall through to positional; verbs can detect them
    }
    return { yes, explain, dryRun, positional, passthrough };
}
