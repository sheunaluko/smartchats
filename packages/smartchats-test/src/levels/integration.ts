import type { Level, LevelContext, LevelResult } from '../types.js';

/**
 * L3 — integration tests requiring running infrastructure.
 *
 * Examples (when wired):
 *   - smartchats-database cloud_crud.test.ts against cloud_test_db (port 8001)
 *   - smartchats-database local_crud.test.ts against AIO (port 3000 / 8000)
 *   - smartchats-mcp stdio smoke against AIO
 *   - bundle import/export round-trip
 *
 * These rely on prerequisites NOT spun up by the runner itself (caller
 * brings the cloud_test_db / AIO container up first). Mark requiresInfra
 * so it's opt-in by default.
 *
 * STATUS: stub. Pattern (for future implementer): each integration test
 * gets a function here that probes its prerequisite (curl the health
 * endpoint), runs the test runner (vitest or tsx), reports result.
 */
export const integrationLevel: Level = {
    id: 3,
    name: 'integration',
    description: 'Tests against running infra (cloud_test_db, AIO). Caller brings infra up first.',
    requiresInfra: true,
    async run(_ctx: LevelContext): Promise<LevelResult> {
        return {
            status: 'SKIP',
            note: 'not yet wired — integration suite is a stub',
        };
    },
};
