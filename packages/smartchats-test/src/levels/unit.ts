import type { Level, LevelContext, LevelResult } from '../types.js';
import { runCmd } from '../exec.js';
import { listPackages, packagesWithScript } from '../workspace.js';

/**
 * L2 — unit tests in every package that defines a `test:unit` script.
 *
 * The convention: packages with unit tests expose `npm run test:unit`
 * (typically a vitest invocation). We enumerate workspace packages and
 * iterate. Packages without `test:unit` are silently skipped.
 *
 * For shared/integration tests (cloud_test_db, AIO), see the integration
 * level — those need running infra.
 */
export const unitLevel: Level = {
    id: 2,
    name: 'unit',
    description: 'Vitest in each package that defines `test:unit`.',
    async run(ctx: LevelContext): Promise<LevelResult> {
        const pkgs = packagesWithScript(listPackages(ctx.repoRoot), 'test:unit');
        if (pkgs.length === 0) {
            return { status: 'SKIP', note: 'no packages define test:unit' };
        }
        let failed = 0;
        for (const pkg of pkgs) {
            ctx.log.info(`unit: ${pkg.name}`);
            const result = await runCmd('npm', ['run', 'test:unit'], { cwd: pkg.path });
            if (result.code !== 0) {
                failed++;
                ctx.log.err(`${pkg.name}: exit ${result.code}`);
                if (!ctx.continueOnFailure) {
                    return { status: 'FAIL', note: `${pkg.name} failed` };
                }
            }
        }
        if (failed > 0) {
            return { status: 'FAIL', note: `${failed} of ${pkgs.length} package(s) failed` };
        }
        return { status: 'PASS', note: `${pkgs.length} package(s) green` };
    },
};
