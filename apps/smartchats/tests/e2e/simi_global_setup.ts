/**
 * Run-once setup: clears per-run state before any worker spins up.
 *
 * Each worker writes its own `simi_live.${parallelIndex}.log` in
 * append mode (so a worker restart after a failed test preserves
 * history). This setup wipes any stale per-worker log files from a
 * prior run, then leaves it to workers to create their own.
 */
import * as fs from 'fs';
import * as path from 'path';

export default async function globalSetup() {
  const resultsDir = path.join(__dirname, '../../test-results');
  fs.mkdirSync(resultsDir, { recursive: true });

  // Wipe per-worker live logs from prior runs (any simi_live.*.log).
  // Also wipe the legacy simi_live.log if it's still around.
  for (const entry of fs.readdirSync(resultsDir)) {
    if (/^simi_live\.(\d+\.)?log$/.test(entry)) {
      fs.rmSync(path.join(resultsDir, entry), { force: true });
    }
  }

  // Drop the legacy serial-mode run-state counter (no longer meaningful in parallel).
  fs.rmSync(path.join(resultsDir, '.simi_run_state.json'), { force: true });
}
