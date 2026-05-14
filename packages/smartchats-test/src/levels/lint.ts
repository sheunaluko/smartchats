import type { Level, LevelContext, LevelResult } from '../types.js';
import { runCmd } from '../exec.js';

/**
 * L0 — workspace-wide lint.
 *
 * Uses turbo so per-package cache is honored. Skipped if no package defines
 * a `lint` script (avoids failing on workspaces that haven't wired it).
 */
export const lintLevel: Level = {
    id: 0,
    name: 'lint',
    description: 'Workspace-wide lint via `turbo run lint`. Skipped if no package defines lint.',
    async run(ctx: LevelContext): Promise<LevelResult> {
        ctx.log.info('Running `turbo run lint --continue` across workspace...');
        const result = await runCmd('npx', ['turbo', 'run', 'lint', '--continue'], {
            cwd: ctx.repoRoot,
        });
        if (result.code === 0) {
            return { status: 'PASS' };
        }
        return { status: 'FAIL', note: `exit ${result.code}` };
    },
};
