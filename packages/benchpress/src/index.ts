/**
 * Browser-safe public surface — types + scenario metadata only.
 *
 * The scoring lib (`./scoring`) pulls in `smartchats-sessions`, which
 * imports node:fs / node:crypto / node:path. Importing it through this
 * barrel into Next.js client bundles fails the webpack build. Apps that
 * only need scenarios should import from `'benchpress'`; node-only
 * consumers (run_bench, score_local_sessions) import from
 * `'benchpress/scoring'` directly.
 */
export * from './types.js';
export { ALL_SCENARIOS } from './scenarios/index.js';
export type { BenchScenarioV1 } from './scenarios/index.js';
