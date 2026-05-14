/**
 * smartchats-test — public API.
 *
 * Used either via the CLI (`smartchats-test` or `npm run …`) or
 * programmatically by importing { runLevels, ALL_LEVELS, ... } here.
 */

export type {
    Level,
    LevelContext,
    LevelResult,
    LevelOutcome,
    LevelStatus,
    Logger,
    RunOutcome,
} from './types.js';

export { runLevels } from './runner.js';
export type { RunOptions } from './runner.js';

export { ALL_LEVELS, findLevel } from './levels/index.js';

export { consoleLogger, printSummary } from './reporters/console.js';

export { findRepoRoot, listPackages, packagesWithScript } from './workspace.js';
export type { WorkspacePackage } from './workspace.js';

export { runCmd } from './exec.js';
export type { RunOpts, RunResult } from './exec.js';
