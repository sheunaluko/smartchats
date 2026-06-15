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
 *   2. Resolves a commit message via one of three paths:
 *        - `-m <msg>`         use directly, skip everything else
 *        - `--llm`            draft via `claude -p` over the diff +
 *                             recent log, then [a]ccept / [e]dit /
 *                             [r]egen / [m]anual / [c]ancel
 *        - default            readline prompt for raw text
 *   3. Shells out to bin/checkpoint with the message.
 *
 * The LLM path is a first instance of the "prompt-construction pipeline"
 * pattern for `sm` verbs — gather structured input, pipe to `claude -p`,
 * present output, accept/edit/regen. Same shape will work for future
 * verbs (sm explain-commit, sm changelog, sm investigate, etc.).
 *
 * Flags:
 *   -m, --message <msg>    Skip everything, use this message directly.
 *   --llm                  Draft via claude -p; opt-in for now.
 *   -h, --help
 */

import { spawn, execFileSync } from 'node:child_process';
import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import consola from 'consola';

import { detectRepo } from '../lib/context.js';

const C = {
    bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
    dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
    red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
    green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
    cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
};

export const commitHelp = `sm commit [options]

Wraps bin/checkpoint. Shows the dirty tree first so unintended sweeps by
\`git add -A\` are obvious, then prompts for a commit message.

Options:
  -m, --message <msg>    Skip the prompt; commit with <msg> directly.
  --llm                  Draft a commit message via \`claude -p\` over the
                         current diff + recent log. Presents [a]ccept /
                         [e]dit / [r]egen / [m]anual / [c]ancel.
  -h, --help

Examples:
  sm commit
  sm commit --llm
  sm commit -m "checkpoint: wip on monitor alert dsl"

Pairs with the project convention that all commits go through bin/checkpoint
(prefixes with "checkpoint:"). For typed feature commits, prefer
\`git commit\` directly with explicit \`git add <files>\`.

See: sm explain commit
`;

interface ParsedArgs {
    message: string | null;
    llm: boolean;
}

function parseArgs(argv: string[]): ParsedArgs | null {
    const out: ParsedArgs = { message: null, llm: false };
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
            case '--llm':
                out.llm = true;
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
// LLM draft path
// ──────────────────────────────────────────────────────────────────────────

const MAX_DIFF_CHARS = 60_000;
const MAX_UNTRACKED_INLINE_LINES = 200;
const CLAUDE_TIMEOUT_MS = 60_000;

function gitOut(root: string, args: string[]): string {
    try {
        return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 });
    } catch {
        return '';
    }
}

function gatherDraftContext(root: string, entries: DirtyEntry[]): {
    diff: string;
    untrackedSection: string;
    recentCommits: string;
} {
    // git diff HEAD captures both staged and unstaged tracked changes.
    let diff = gitOut(root, ['diff', 'HEAD']);
    if (diff.length > MAX_DIFF_CHARS) {
        diff = diff.slice(0, MAX_DIFF_CHARS) + `\n…[diff truncated at ${MAX_DIFF_CHARS} chars]\n`;
    }

    const untracked = entries.filter((e) => e.kind === 'untracked');
    const parts: string[] = [];
    for (const u of untracked) {
        const abs = path.join(root, u.path);
        try {
            const stat = fs.statSync(abs);
            if (!stat.isFile()) {
                parts.push(`+++ ${u.path}\n  (directory or special; skipped)\n`);
                continue;
            }
            const text = fs.readFileSync(abs, 'utf8');
            const lines = text.split('\n');
            if (lines.length > MAX_UNTRACKED_INLINE_LINES) {
                parts.push(`+++ ${u.path}  (${lines.length} lines, content omitted)\n`);
            } else {
                parts.push(`+++ ${u.path}\n${text}\n`);
            }
        } catch {
            parts.push(`+++ ${u.path}  (unreadable)\n`);
        }
    }
    const untrackedSection = parts.length ? parts.join('\n') : '(none)';

    // Last 3 non-merge commits, full message, as style exemplars.
    const recentCommits = gitOut(root, ['log', '-3', '--no-merges', '--pretty=format:--- %h%n%B']).trim();

    return { diff, untrackedSection, recentCommits };
}

function buildClaudePrompt(ctx: ReturnType<typeof gatherDraftContext>): string {
    return [
        `You are drafting a git commit message for the smartchats project.`,
        ``,
        `CONVENTION:`,
        `- Lead line: short imperative summary, under ~72 chars. Use a prefix that`,
        `  matches the scope:`,
        `    "feat(<package>): <summary>"     new functionality`,
        `    "fix(<package>): <summary>"      bug fix`,
        `    "docs: <summary>"                documentation only`,
        `    "refactor(<package>): <summary>" structural change, no behavior delta`,
        `    "checkpoint: <summary>"          ad-hoc snapshot (when changes span`,
        `                                     multiple concerns or are wip)`,
        `- Blank line.`,
        `- Body: 1-3 paragraphs explaining the WHY and the impact — not a restatement`,
        `  of the diff. Use bullets for granular file-level details when useful.`,
        `- Direct active voice ("Adds", "Fixes", "Refactors"), not "This commit adds".`,
        `- No "Co-Authored-By" trailers. No agent attribution.`,
        ``,
        `RECENT COMMITS (as style exemplars):`,
        ctx.recentCommits || '(no recent commits)',
        ``,
        `DIFF (git diff HEAD):`,
        ctx.diff || '(no tracked changes)',
        ``,
        `UNTRACKED FILES (will be included via git add -A):`,
        ctx.untrackedSection,
        ``,
        `Output ONLY the commit message itself. No backticks, no markdown code`,
        `fences, no preface like "Here is the commit message:". Just the raw text`,
        `that should appear in the commit.`,
    ].join('\n');
}

async function runClaudeDraft(prompt: string, root: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const child = spawn('claude', ['-p'], {
            cwd: root,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdoutBuf = '';
        let stderrBuf = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`claude -p timed out after ${CLAUDE_TIMEOUT_MS / 1000}s`));
        }, CLAUDE_TIMEOUT_MS);

        child.stdout.on('data', (d: Buffer) => { stdoutBuf += d.toString('utf8'); });
        child.stderr.on('data', (d: Buffer) => { stderrBuf += d.toString('utf8'); });
        child.on('error', (err: Error) => {
            clearTimeout(timer);
            reject(err);
        });
        child.on('exit', (code: number | null) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve(stripDraft(stdoutBuf));
            } else {
                reject(new Error(`claude -p exited ${code}: ${stderrBuf.trim() || 'no stderr'}`));
            }
        });

        child.stdin.write(prompt);
        child.stdin.end();
    });
}

/** Strip wrapping noise the model occasionally adds (code fences, intro lines). */
function stripDraft(raw: string): string {
    let s = raw.trim();
    // Strip leading "Here is..." / "Commit message:" preface if present.
    s = s.replace(/^(here(?:'s| is)[^\n]*?:|commit message:[^\n]*)\n+/i, '');
    // Strip surrounding triple-backtick block if the entire output is a fence.
    const fenced = s.match(/^```[a-z]*\n([\s\S]*)\n```\s*$/);
    if (fenced) s = fenced[1]!;
    return s.trim();
}

function renderDraftBox(draft: string): void {
    const lines = draft.split('\n');
    const width = Math.min(80, Math.max(...lines.map((l) => l.length), 40));
    const horiz = '─'.repeat(width + 2);
    console.log('');
    console.log(C.cyan(`┌─ suggested message ${'─'.repeat(Math.max(0, width - 19))}┐`));
    for (const line of lines) {
        console.log(C.cyan('│ ') + line);
    }
    console.log(C.cyan(`└${horiz}┘`));
    console.log('');
}

async function editInEditor(seed: string, root: string): Promise<string> {
    const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
    const tmp = path.join(os.tmpdir(), `sm-commit-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(tmp, seed + '\n');
    try {
        await new Promise<void>((resolve, reject) => {
            const child = spawn(editor, [tmp], { cwd: root, stdio: 'inherit' });
            child.on('error', reject);
            child.on('exit', (code: number | null) => {
                if (code === 0) resolve();
                else reject(new Error(`${editor} exited ${code}`));
            });
        });
        const content = fs.readFileSync(tmp, 'utf8');
        return content.trim();
    } finally {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
}

async function promptDraftAction(
    rl: readline.Interface,
): Promise<'accept' | 'edit' | 'regen' | 'manual' | 'cancel'> {
    while (true) {
        const a = await rl.question(C.bold('[a]ccept  [e]dit  [r]egen  [m]anual  [c]ancel: '));
        const ch = a.trim().toLowerCase()[0] ?? '';
        if (ch === 'a') return 'accept';
        if (ch === 'e') return 'edit';
        if (ch === 'r') return 'regen';
        if (ch === 'm') return 'manual';
        if (ch === 'c' || ch === '') return 'cancel';
        console.log(C.dim('  unrecognized — try a / e / r / m / c'));
    }
}

async function resolveViaLlm(
    root: string,
    entries: DirtyEntry[],
    rl: readline.Interface,
): Promise<{ message: string } | { fallback: 'manual' | 'cancel' }> {
    let draft: string | null = null;
    while (true) {
        if (!draft) {
            process.stdout.write(C.dim('[drafting with claude…]\n'));
            const ctx = gatherDraftContext(root, entries);
            const prompt = buildClaudePrompt(ctx);
            try {
                draft = await runClaudeDraft(prompt, root);
            } catch (err) {
                consola.warn(`LLM draft unavailable: ${(err as Error).message}`);
                console.log(C.dim('  → falling through to manual prompt.\n'));
                return { fallback: 'manual' };
            }
            if (!draft) {
                consola.warn('LLM returned an empty draft.');
                console.log(C.dim('  → falling through to manual prompt.\n'));
                return { fallback: 'manual' };
            }
        }

        renderDraftBox(draft);
        const action = await promptDraftAction(rl);
        if (action === 'accept') return { message: draft };
        if (action === 'edit') {
            try {
                const edited = await editInEditor(draft, root);
                if (!edited.trim()) {
                    consola.info('Edit produced empty content — cancelling.');
                    return { fallback: 'cancel' };
                }
                return { message: edited };
            } catch (err) {
                consola.warn(`Editor failed: ${(err as Error).message}`);
                continue; // re-prompt
            }
        }
        if (action === 'regen') {
            draft = null;
            continue;
        }
        if (action === 'manual') return { fallback: 'manual' };
        if (action === 'cancel') return { fallback: 'cancel' };
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

    // Resolve message — three paths: -m, --llm, or default manual prompt.
    let message: string;

    if (parsed.message) {
        message = parsed.message;
    } else {
        if (!stdin.isTTY) {
            consola.error('No -m/--message and stdin is non-TTY. Refusing to commit.');
            return 3;
        }
        const rl = readline.createInterface({ input: stdin, output: stdout });
        try {
            let resolved: string | null = null;

            if (parsed.llm) {
                const r = await resolveViaLlm(root, entries, rl);
                if ('message' in r) {
                    resolved = r.message;
                } else if (r.fallback === 'cancel') {
                    consola.info('Cancelled.');
                    return 0;
                }
                // fallback === 'manual' falls through to the manual prompt below
            }

            if (!resolved) {
                const answer = await rl.question(C.bold('Commit message (or empty to cancel): '));
                resolved = answer.trim();
            }

            if (!resolved) {
                consola.info('Cancelled.');
                return 0;
            }
            message = resolved;
        } finally {
            rl.close();
        }
    }

    // Shell out to bin/checkpoint. It does `git add -A && git commit -m
    // "checkpoint: $1"`. We pass the raw message; the prefix is its job.
    console.log(C.dim(`\nRunning bin/checkpoint…\n`));
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
