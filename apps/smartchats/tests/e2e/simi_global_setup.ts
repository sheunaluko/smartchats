/**
 * Run-once setup: clears per-run state before any test spins up.
 *
 * Playwright restarts a worker after a failed test to isolate state, which
 * re-runs `test.beforeAll` in a fresh process. That means module-level
 * counters and "truncate on open" log streams lose continuity across a
 * failure. We route both the live-log file and the runIndex counter
 * through disk so they survive worker restarts; `globalSetup` resets
 * them exactly once at the start of a run.
 */
import * as fs from 'fs';
import * as path from 'path';

export default async function globalSetup() {
  const resultsDir = path.join(__dirname, '../../test-results');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, 'simi_live.log'), '');
  fs.rmSync(path.join(resultsDir, '.simi_run_state.json'), { force: true });
}
