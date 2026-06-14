/**
 * Score every session bundle currently in apps/smartchats/test-results/ that
 * matches `bench_<scenario>_<timestamp>.json`. Cross-checks the scoring lib
 * against real exported bundles before the matrix runner is wired (Task #10).
 *
 *   tsx packages/benchpress/scripts/score_local_sessions.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreScenario, type ScenarioResult } from '../src/scoring/index.js';
import type { TruthsSnapshot } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const truthsPath = resolve(here, '..', 'fixtures', 'truths.json');
const sessionsDir = resolve(repoRoot, 'apps', 'smartchats', 'test-results');

const truths: TruthsSnapshot = JSON.parse(readFileSync(truthsPath, 'utf8'));

const expectedDeltaByScenario: Record<string, unknown> = {
  q08_dune_mutate_then_count: 30,
};

const files = readdirSync(sessionsDir)
  .filter((n) => /^bench_(q\d+_[a-z0-9_]+|q\d+_prototype)_\d+\.json$/.test(n))
  .map((n) => join(sessionsDir, n));

if (files.length === 0) {
  console.error(`no session bundles in ${sessionsDir}`);
  process.exit(2);
}

interface Row {
  file: string;
  scenario_id: string;
  result: ScenarioResult;
}
const rows: Row[] = [];
for (const file of files) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const m = basename(file).match(/^bench_(q\d+_[a-z0-9_]+|q\d+_prototype)_/);
  if (!m) continue;
  let sid = m[1]!;
  // The q01 prototype shares scenario data with q01_weight_lookup.
  if (sid === 'q01_prototype') sid = 'q01_weight_lookup';
  if (!truths.scenarios[sid]) {
    console.error(`unknown scenario in file ${file}: ${sid}`);
    continue;
  }
  const result = scoreScenario(raw, sid, truths, {
    expectedDelta: expectedDeltaByScenario[sid],
  });
  rows.push({ file: basename(file), scenario_id: sid, result });
}

console.log();
console.log(`Scored ${rows.length} session bundle(s)`);
console.log('─'.repeat(120));
for (const { file, scenario_id, result } of rows) {
  const tm = result.trace_metrics;
  console.log(`${file}`);
  console.log(`  scenario: ${scenario_id}  model: ${result.model ?? '(unknown)'}  outcome: ${result.outcome}`);
  if (result.correctness) {
    console.log(`  correctness: ${result.correctness.passed ? 'PASS' : 'FAIL'} — ${result.correctness.detail}`);
  } else {
    console.log(`  correctness: (no bench_answer submitted)`);
  }
  console.log(
    `  metrics: turns=${tm.turn_count} total=${(tm.total_ms / 1000).toFixed(1)}s ` +
    `llm_calls=${tm.llm_call_count} tokens=${tm.input_tokens}+${tm.output_tokens} ` +
    `cached=${tm.cached_input_tokens} cost=$${tm.estimated_cost_usd.toFixed(5)}`,
  );
  const topTools = Object.entries(tm.tools_called)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([n, c]) => `${n}=${c}`)
    .join(', ');
  console.log(`  tools: ${topTools || '(none)'}`);
  if (result.trace_assertions.length > 0) {
    for (const a of result.trace_assertions) {
      console.log(`  assertion ${a.name}: ${a.passed ? 'PASS' : 'FAIL'} — ${a.reason}`);
    }
  }
  console.log();
}
