import type { Level, LevelContext, LevelResult } from '../types.js';
import { runCmd } from '../exec.js';
import { listPackages, packagesWithScript } from '../workspace.js';

/**
 * L0 — workspace-wide lint.
 *
 * Skipped when no package defines a `lint` script. When at least one does,
 * runs `turbo run lint --continue` so per-package cache is honored. The
 * skip-when-empty behavior avoids the noisy "command not found" path for
 * monorepos that haven't wired lint yet.
 */
export const lintLevel: Level = {
    id: 0,
    name: 'lint',
    description: 'Workspace-wide lint. Skipped if no package defines `lint`.',
    async run(ctx: LevelContext): Promise<LevelResult> {
        const pkgs = packagesWithScript(listPackages(ctx.repoRoot), 'lint');
        if (pkgs.length === 0) {
            return { status: 'SKIP', note: 'no packages define a `lint` script' };
        }
        ctx.log.info(`Running lint across ${pkgs.length} package(s) via turbo...`);
        const result = await runCmd('npx', ['turbo', 'run', 'lint', '--continue'], {
            cwd: ctx.repoRoot,
        });
        if (result.code === 0) {
            return { status: 'PASS' };
        }
        return { status: 'FAIL', note: `exit ${result.code}` };
    },
};
