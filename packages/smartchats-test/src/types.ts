/**
 * Public types for the layered test runner.
 *
 * Each Level is one stage of the pipeline (lint, build, unit, integration,
 * e2e). Levels run in order; each gates the next unless explicitly continued.
 * Status tracks per-level outcome; the runner returns an overall summary.
 */

export type LevelStatus = 'PASS' | 'FAIL' | 'SKIP' | 'PENDING';

export interface Level {
    /** Stable numeric id (L0, L1, ...). Sort order. */
    id: number;
    /** Short stable name used in CLI flags + reports (lint, build, unit, etc). */
    name: string;
    /** One-line description shown in --help. */
    description: string;
    /**
     * Run the level. Should resolve when the level is complete and reject
     * (or return non-zero result) on failure. Receives a logger so output
     * is consistently prefixed.
     */
    run: (ctx: LevelContext) => Promise<LevelResult>;
    /**
     * True when the level needs external running infrastructure (a database,
     * AIO container, etc.). Used to mark these "opt-in" rather than "default".
     */
    requiresInfra?: boolean;
}

export interface LevelContext {
    /** Absolute path to the monorepo root. */
    repoRoot: string;
    /** Logger for prefixed/coloured output. */
    log: Logger;
    /** Whether to continue iterating after errors within a level. */
    continueOnFailure: boolean;
    /**
     * Args after `--` on the CLI, forwarded verbatim into the level's
     * underlying tool (e.g. Playwright). Empty when nothing was passed.
     */
    passthroughArgs: string[];
    /**
     * When true, levels MAY prompt interactively (e.g. ask the user to
     * pick specific Simi workflows, choose headed/headless). Levels that
     * don't support interactive mode just ignore this.
     */
    pickInteractive: boolean;
}

export interface LevelResult {
    status: 'PASS' | 'FAIL' | 'SKIP';
    /** Optional message — surfaced in the summary table. */
    note?: string;
}

export interface LevelOutcome {
    level: Level;
    result: LevelResult;
    /** Milliseconds spent in this level. */
    duration_ms: number;
}

export interface RunOutcome {
    /** Per-level outcomes in run order. */
    levels: LevelOutcome[];
    /** True if every executed level passed (skipped levels don't fail). */
    passed: boolean;
    /** Total wall-clock duration. */
    duration_ms: number;
}

export interface Logger {
    info(msg: string): void;
    ok(msg: string): void;
    warn(msg: string): void;
    err(msg: string): void;
    header(msg: string): void;
}
