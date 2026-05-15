import type { Level, LevelContext, LevelResult } from '../types.js';
import { runCmd } from '../exec.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * L4 — browser end-to-end suite via Playwright.
 *
 * Invokes the Simi spec inside apps/smartchats/tests/e2e/simi.spec.ts.
 * Heavy — typically ~10-15 min. Requires Playwright installed in the
 * smartchats app workspace.
 *
 * Doesn't manage the dev server lifecycle itself; relies on Playwright's
 * webServer config (or assumes the dev server is up). Caller can pre-seed
 * the env: SIMI_REUSE_BROWSER=1, NEXT_PUBLIC_SMARTCHATS_BOOTSTRAP=local
 * etc — they pass through.
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
        ctx.log.info(`Running Playwright: ${specPath}${passthrough.length ? ` (extra args: ${passthrough.join(' ')})` : ''}`);
        const result = await runCmd('npx', ['playwright', 'test', 'simi.spec.ts', ...passthrough], {
            cwd: appDir,
        });
        if (result.code === 0) {
            return { status: 'PASS' };
        }
        return { status: 'FAIL', note: `playwright exit ${result.code}` };
    },
};
