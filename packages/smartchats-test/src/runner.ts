/**
 * Layered runner — executes selected levels in order, returns per-level
 * outcomes + an overall pass/fail.
 *
 * Pure orchestration; level implementations live under ./levels/. Caller
 * supplies the workspace root and (optionally) a logger.
 */

import type {
    Level,
    LevelOutcome,
    RunOutcome,
    Logger,
} from './types.js';
import { consoleLogger } from './reporters/console.js';

export interface RunOptions {
    repoRoot: string;
    levels: Level[];
    continueOnFailure?: boolean;
    /** Skip levels marked requiresInfra=true. */
    skipInfra?: boolean;
    logger?: Logger;
}

export async function runLevels(opts: RunOptions): Promise<RunOutcome> {
    const log = opts.logger ?? consoleLogger;
    const continueOnFailure = opts.continueOnFailure ?? false;
    const start = Date.now();
    const outcomes: LevelOutcome[] = [];

    let earlyAbort = false;
    for (const level of opts.levels) {
        if (earlyAbort) {
            outcomes.push({
                level,
                result: { status: 'SKIP', note: 'aborted after earlier failure' },
                duration_ms: 0,
            });
            continue;
        }
        if (opts.skipInfra && level.requiresInfra) {
            outcomes.push({
                level,
                result: { status: 'SKIP', note: 'requires infra; opt-in via flags' },
                duration_ms: 0,
            });
            continue;
        }

        log.header(`L${level.id} — ${level.name}: ${level.description}`);
        const levelStart = Date.now();
        let result;
        try {
            result = await level.run({
                repoRoot: opts.repoRoot,
                log,
                continueOnFailure,
            });
        } catch (err) {
            result = {
                status: 'FAIL' as const,
                note: err instanceof Error ? err.message : String(err),
            };
        }
        const duration_ms = Date.now() - levelStart;
        outcomes.push({ level, result, duration_ms });

        if (result.status === 'PASS') {
            log.ok(`L${level.id} ${level.name}: PASS (${(duration_ms / 1000).toFixed(1)}s)`);
        } else if (result.status === 'SKIP') {
            log.info(`L${level.id} ${level.name}: SKIP${result.note ? ` — ${result.note}` : ''}`);
        } else {
            log.err(`L${level.id} ${level.name}: FAIL${result.note ? ` — ${result.note}` : ''}`);
            if (!continueOnFailure) {
                earlyAbort = true;
            }
        }
    }

    const passed = outcomes.every((o) => o.result.status !== 'FAIL');
    return {
        levels: outcomes,
        passed,
        duration_ms: Date.now() - start,
    };
}
