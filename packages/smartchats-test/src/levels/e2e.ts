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

        if (ctx.pickInteractive) {
            const choices = await promptForRun(ctx);
            if (choices === null) {
                return { status: 'SKIP', note: 'cancelled at interactive prompt' };
            }
            if (choices.grep) extraArgs.push('--grep', choices.grep);
            if (choices.headed) extraArgs.push('--headed');
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

        // No selection → run everything; otherwise build a grep with alternation.
        // We use a `›`-boundary so we anchor on the test-title boundary —
        // Playwright's full test path looks like:
        //   `[chromium] › tests/e2e/simi.spec.ts:NN:N › <workflow>`
        // Anchoring with `^...$` matches the whole path (fails). A leading
        // ` › ` ensures we match the test-title segment, not a path substring,
        // and avoids false positives from one name being a prefix of another
        // (e.g. metrics_explorer_flow vs auto_metrics_explorer_flow).
        const TITLE_BOUNDARY = '\\s\\u203A\\s'; // ' › ' as regex
        const grep = selected.length === 0
            ? null
            : selected.length === 1
                ? `${TITLE_BOUNDARY}${escapeRegex(selected[0])}$`
                : `${TITLE_BOUNDARY}(${selected.map(escapeRegex).join('|')})$`;

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
