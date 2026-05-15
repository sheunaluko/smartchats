import type { Level, LevelContext, LevelResult } from '../types.js';
import { runCmd } from '../exec.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { discoverWorkflows } from '../lib/discover-workflows.js';

/**
 * L4 — browser end-to-end suite via Playwright.
 *
 * Invokes the Simi spec inside apps/smartchats/tests/e2e/simi.spec.ts.
 * Heavy — typically ~10-15 min for the full suite. Requires Playwright
 * installed in the smartchats app workspace, and a dev server up on
 * localhost:3000.
 *
 * Two invocation modes:
 *   - Default: runs every workflow in the spec's WORKFLOWS list.
 *   - Interactive (`smartchats-test e2e --pick`): prompts the user to
 *     select specific workflows + headed/headless + reuseBrowser, then
 *     runs only the selection.
 *
 * Pass-through (`smartchats-test e2e -- --grep foo --headed`) forwards
 * extra args verbatim to Playwright in either mode.
 */
export const e2eLevel: Level = {
    id: 4,
    name: 'e2e',
    description: 'Playwright Simi suite (apps/smartchats/tests/e2e/simi.spec.ts).',
    requiresInfra: true,
    async run(ctx: LevelContext): Promise<LevelResult> {
        const appDir = join(ctx.repoRoot, 'apps', 'smartchats');
        const specPath = join(appDir, 'tests', 'e2e', 'simi.spec.ts');
        if (!existsSync(specPath)) {
            return { status: 'SKIP', note: 'no simi.spec.ts found in apps/smartchats/tests/e2e/' };
        }

        const passthrough = ctx.passthroughArgs ?? [];
        const extraArgs: string[] = [];
        const extraEnv: Record<string, string> = {};

        // simi.spec.ts creates its own chromium context, so Playwright's
        // --headed (consumed before the spec worker reads argv) doesn't
        // reach it. Mirror to HEADED=1 in env, which the spec DOES read.
        if (passthrough.includes('--headed')) {
            extraEnv.HEADED = '1';
        }

        if (ctx.pickInteractive) {
            const choices = await promptForRun(ctx);
            if (choices === null) {
                return { status: 'SKIP', note: 'cancelled at interactive prompt' };
            }
            if (choices.grep) extraArgs.push('--grep', choices.grep);
            // simi.spec.ts builds its own chromium context — Playwright's
            // `--headed` flag affects only Playwright's managed browser and
            // is consumed before the spec worker reads `process.argv`. The
            // spec also accepts `HEADED=1` env, which DOES reach the worker.
            // Set both so external callers that read --headed also work.
            if (choices.headed) {
                extraArgs.push('--headed');
                extraEnv.HEADED = '1';
            }
            if (choices.reuseBrowser) extraEnv.SIMI_REUSE_BROWSER = '1';
        }

        const playwrightArgs = ['playwright', 'test', 'simi.spec.ts', ...extraArgs, ...passthrough];
        ctx.log.info(`Running: npx ${playwrightArgs.join(' ')}`);
        const result = await runCmd('npx', playwrightArgs, {
            cwd: appDir,
            env: extraEnv,
        });
        if (result.code === 0) {
            return { status: 'PASS' };
        }
        return { status: 'FAIL', note: `playwright exit ${result.code}` };
    },
};

interface RunChoices {
    grep: string | null;
    headed: boolean;
    reuseBrowser: boolean;
}

/**
 * Interactive prompt flow. Returns null if the user cancels (Ctrl-C).
 *
 * Dynamic-imports `@inquirer/prompts` so the package is only loaded when
 * --pick is actually used (keeps default invocation snappy and avoids a
 * hard runtime dep for CI paths).
 */
async function promptForRun(ctx: LevelContext): Promise<RunChoices | null> {
    let inquirer: typeof import('@inquirer/prompts');
    try {
        inquirer = await import('@inquirer/prompts');
    } catch {
        ctx.log.err('--pick requires @inquirer/prompts. Install it: npm install @inquirer/prompts --workspace=packages/smartchats-test');
        return null;
    }

    const workflows = discoverWorkflows(ctx.repoRoot);
    if (workflows.length === 0) {
        ctx.log.err('Could not discover any workflows from simi.spec.ts. Falling back to running everything.');
        return { grep: null, headed: false, reuseBrowser: false };
    }

    try {
        const selected = await inquirer.checkbox({
            message: `Pick workflows to run (space to toggle, enter to confirm; empty = run all ${workflows.length})`,
            pageSize: 20,
            choices: workflows.map((w) => ({
                name: `${w.name}${w.requiresBilling ? ' (billing)' : ''}`,
                value: w.name,
            })),
            // No `loop: false` here; the default behavior is fine for this list size.
        });

        const headed = await inquirer.confirm({
            message: 'Run in headed mode (visible browser)?',
            default: false,
        });

        const reuseBrowser = await inquirer.confirm({
            message: 'Reuse a single browser across workflows (faster, but state carries over)?',
            default: false,
        });

        // Build a grep pattern that matches a workflow name as a whole
        // identifier — anchored on word-char boundaries (handles underscores
        // correctly, unlike \b). Without this, `metrics_explorer_flow` would
        // also match `auto_metrics_explorer_flow`.
        //
        // Playwright's --grep matches against the test title (NOT the full
        // path), so simple anchored patterns work; we just need to avoid
        // prefix-overlap false positives.
        //
        // Lookbehind/ahead syntax: (?<!\w)name(?!\w)
        //   — not preceded by a word char AND not followed by one
        //   — supported by Node 10+ regex engine, which Playwright uses
        const grep = selected.length === 0
            ? null
            : selected.length === 1
                ? `(?<!\\w)${escapeRegex(selected[0])}(?!\\w)`
                : `(?<!\\w)(${selected.map(escapeRegex).join('|')})(?!\\w)`;

        return { grep, headed, reuseBrowser };
    } catch (err) {
        // Inquirer throws ExitPromptError on Ctrl-C.
        if (err && (err as any).name === 'ExitPromptError') {
            return null;
        }
        throw err;
    }
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
