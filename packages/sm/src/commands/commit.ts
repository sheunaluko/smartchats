/**
 * `sm commit` — thin wrapper around bin/checkpoint with diff preview.
 *
 * `bin/checkpoint` does `git add -A` + commit with a `checkpoint:` prefix.
 * The hazard is that `git add -A` sweeps every untracked file — easy to
 * accidentally include a draft script, a `.env` file, debug logs, etc.
 *
 * This wrapper:
 *   1. Renders the dirty tree, calling out untracked files explicitly so
 *      the maintainer can spot anything they didn't intend to sweep.
 *   2. Prompts for a commit message (readline).
 *   3. Shells out to bin/checkpoint with the message.
 *
 * Step 1. Step 2 (future commit) layers `--llm` on top: drafts a message
 * via `claude -p` over the diff + recent log, presents
 * accept/edit/regenerate/manual options.
 *
 * Flags:
 *   -m, --message <msg>    Skip the prompt, use this message directly.
 *   --yes                  Don't warn about untracked files (still prompts for
 *                          message unless -m is also given).
 *   -h, --help
 */

import { spawn, execFileSync } from 'node:child_process';
import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';
import * as path from 'node:path';
import * as fs from 'node:fs';
import consola from 'consola';

import { detectRepo } from '../lib/context.js';

const C = {
    bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
    dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
    red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
    green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

export const commitHelp = `sm commit [options]

Wraps bin/checkpoint. Shows the dirty tree first so unintended sweeps by
\`git add -A\` are obvious, then prompts for a commit message.

Options:
  -m, --message <msg>    Skip the prompt; commit with <msg> directly.
  --yes                  Don't pause on untracked-file warnings.
  -h, --help

Examples:
  sm commit
  sm commit -m "checkpoint: wip on monitor alert dsl"

Pairs with the project convention that all commits go through bin/checkpoint
(prefixes with "checkpoint:"). For typed feature commits, prefer
\`git commit\` directly with explicit \`git add <files>\`.

See: sm explain commit
`;

interface ParsedArgs {
    message: string | null;
    yes: boolean;
}

function parseArgs(argv: string[]): ParsedArgs | null {
    const out: ParsedArgs = { message: null, yes: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        switch (a) {
            case '-h':
            case '--help':
                return null;
            case '-m':
            case '--message':
                out.message = argv[++i] ?? '';
                if (!out.message.trim()) {
                    consola.error('--message requires a non-empty value');
                    return null;
                }
                break;
            case '--yes':
            case '-y':
                out.yes = true;
                break;
            default:
                consola.error(`unknown arg: ${a}`);
                return null;
        }
    }
    return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Tree rendering
// ──────────────────────────────────────────────────────────────────────────

interface DirtyEntry {
    /** Two-char porcelain code: e.g. " M", "M ", "MM", "??", "A ", "D ", etc. */
    code: string;
    path: string;
    /** Classified for display + warning logic. */
    kind: 'staged' | 'modified' | 'untracked' | 'deleted' | 'renamed' | 'other';
}

function readDirty(root: string): DirtyEntry[] {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    return out.split('\n').filter(Boolean).map((line) => {
        const code = line.slice(0, 2);
        const p = line.slice(3);
        let kind: DirtyEntry['kind'] = 'other';
        if (code === '??') kind = 'untracked';
        else if (code.startsWith('R')) kind = 'renamed';
        else if (code === ' D' || code === 'D ') kind = 'deleted';
        else if (code[0] !== ' ' && code[0] !== '?') kind = 'staged';
        else if (code[1] === 'M') kind = 'modified';
        return { code, path: p, kind };
    });
}

function renderTree(entries: DirtyEntry[]): void {
    if (entries.length === 0) {
        console.log(C.dim('  (clean tree)'));
        return;
    }
    for (const e of entries) {
        const marker = e.kind === 'untracked' ? C.yellow('  ?? ') : C.dim('  ' + e.code + ' ');
        const pathStr = e.kind === 'untracked' ? C.yellow(e.path) : e.path;
        const warn = e.kind === 'untracked' ? C.dim('    ← untracked, will be swept') : '';
        console.log(`${marker}${pathStr}${warn}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Command
// ──────────────────────────────────────────────────────────────────────────

export async function runCommit(argv: string[]): Promise<number> {
    const parsed = parseArgs(argv);
    if (!parsed) { console.log(commitHelp); return 1; }

    const repo = detectRepo(process.cwd());
    if (!repo.root) {
        consola.error('Not inside a smartchats repo.');
        return 2;
    }
    const root = repo.root;
    const checkpoint = path.join(root, 'bin/checkpoint');
    if (!fs.existsSync(checkpoint)) {
        consola.error(`bin/checkpoint not found at ${checkpoint}`);
        return 2;
    }

    const entries = readDirty(root);
    if (entries.length === 0) {
        consola.info('Nothing to commit — working tree is clean.');
        return 0;
    }

    const untracked = entries.filter((e) => e.kind === 'untracked');

    console.log(C.bold('\nTree contents (bin/checkpoint will run `git add -A`):'));
    renderTree(entries);
    console.log('');

    if (untracked.length > 0) {
        const word = untracked.length === 1 ? 'file' : 'files';
        console.log(C.yellow(`  ⚠ ${untracked.length} untracked ${word} above will be included.`));
        console.log(C.dim(`     If any should NOT be: cancel, \`git add <files>\` explicitly, then \`git commit\` manually.`));
        console.log('');
    }

    // Resolve message — either via -m or interactive prompt.
    let message: string;
    if (parsed.message) {
        message = parsed.message;
    } else {
        if (!stdin.isTTY) {
            consola.error('No -m/--message and stdin is non-TTY. Refusing to commit.');
            return 3;
        }
        const rl = readline.createInterface({ input: stdin, output: stdout });
        let answer = '';
        try {
            answer = await rl.question(C.bold('Commit message (or empty to cancel): '));
        } finally {
            rl.close();
        }
        message = answer.trim();
        if (!message) {
            consola.info('Cancelled.');
            return 0;
        }
    }

    // Shell out to bin/checkpoint. It does `git add -A && git commit -m
    // "checkpoint: $1"`. We pass the raw message; the prefix is its job.
    console.log(C.dim(`\nRunning bin/checkpoint "${message}"…\n`));
    const exit = await new Promise<number>((resolve) => {
        const child = spawn(checkpoint, [message], { cwd: root, stdio: 'inherit' });
        child.on('exit', (code: number | null) => resolve(code ?? 1));
        child.on('error', (err: Error) => {
            consola.error(`bin/checkpoint failed to spawn: ${err.message}`);
            resolve(127);
        });
    });

    if (exit === 0) {
        console.log(C.green('\n✓ Committed.'));
    } else {
        consola.error(`bin/checkpoint exited ${exit}.`);
    }
    return exit;
}
