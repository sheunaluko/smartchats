import type { Level, LevelContext, LevelResult } from '../types.js';
import { runCmd } from '../exec.js';

/**
 * L1 — workspace-wide build.
 *
 * `tsc` emit type-checks every TS file as a side effect, so this level
 * covers both "does it compile" and "does it type-check." Turbo handles
 * topological order via the per-task `^build` dependency.
 */
export const buildLevel: Level = {
    id: 1,
    name: 'build',
    description: 'Workspace-wide `turbo run build`. Type-checks + emits dist.',
    async run(ctx: LevelContext): Promise<LevelResult> {
        ctx.log.info('Running `turbo run build` across workspace...');
        const result = await runCmd('npx', ['turbo', 'run', 'build'], {
            cwd: ctx.repoRoot,
        });
        if (result.code === 0) {
            return { status: 'PASS' };
        }
        return { status: 'FAIL', note: `exit ${result.code}` };
    },
};
