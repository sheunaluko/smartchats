/**
 * Benchpress matrix runner — runs (scenarios × models) end-to-end and writes
 * per-run results + a model×scenario matrix CSV.
 *
 * Prereq: bin/test-bun-deploy --seed packages/benchpress/fixtures/canonical_user.surql
 *
 *   tsx packages/benchpress/scripts/run_bench.ts                 # full matrix (skips q08)
 *   tsx … --models claude-sonnet-4-6,gpt-5-mini                  # subset of models
 *   tsx … --scenarios q01_weight_lookup,q07_last_tennis          # subset of scenarios
 *   tsx … --app-url http://localhost:3000/app                    # override
 *   tsx … --headed                                               # show the browser
 *   tsx … --include-mutation                                     # include q08 (no seed reset yet)
 *
 * Output: packages/benchpress/results/run_<ISO>/{run.json,matrix.csv}
 *
 * q08 (multi-turn mutation) is skipped unless --include-mutation is set.
 * Seed reset between models isn't wired yet (Task #11). Until then, q08 in
 * a multi-model run accumulates +30 Dune pages per model — the truth drifts.
 */
import { chromium, type Page, type BrowserContext } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_SCENARIOS } from '../src/index.js';
import { scoreScenario, type ScenarioResult } from '../src/scoring/index.js';
import type { TruthsSnapshot } from '../src/types.js';

// ──────────────────────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_MODELS = [
  // Anthropic — best, 3rd best, cheapest
  'claude-opus-4-7',
  'claude-opus-4-5',
  'claude-haiku-4-5',
  // Google — best, 3rd best, cheapest
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  // OpenAI — best, 3rd best, cheapest
  'gpt-5.5',
  'gpt-5.2',
  'gpt-5-nano',
];

const EXPECTED_DELTAS: Record<string, unknown> = {
  q08_dune_mutate_then_count: 30,
};

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const truthsPath = resolve(pkgRoot, 'fixtures', 'truths.json');
const resultsDir = resolve(pkgRoot, 'results');

interface Args {
  appUrl: string;
  models: string[];
  scenarios: string[];
  headed: boolean;
  includeMutation: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    appUrl: 'http://localhost:3000/app',
    models: DEFAULT_MODELS,
    scenarios: ALL_SCENARIOS.map((s) => s.id),
    headed: false,
    includeMutation: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i]!;
    if (a === '--app-url') out.appUrl = next();
    else if (a === '--models') out.models = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--scenarios') out.scenarios = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--headed') out.headed = true;
    else if (a === '--include-mutation') out.includeMutation = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }
  if (!out.includeMutation) {
    out.scenarios = out.scenarios.filter((s) => s !== 'q08_dune_mutate_then_count');
  }
  return out;
}

function printHelp() {
  console.log(`Usage: run_bench [options]
  --models a,b,c           Subset of models (default: 9 reference models)
  --scenarios id1,id2      Subset of scenario ids (default: all 11)
  --include-mutation       Include q08 (seed mutation — no reset between models yet)
  --app-url URL            App URL (default http://localhost:3000/app)
  --headed                 Show the browser`);
}

// ──────────────────────────────────────────────────────────────────────────
// Session driving
// ──────────────────────────────────────────────────────────────────────────

async function setupContext(headed: boolean): Promise<{ browser: Awaited<ReturnType<typeof chromium.launch>>; ctx: BrowserContext }> {
  const browser = await chromium.launch({ headless: !headed });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    (window as unknown as { __BENCHPRESS_MODE: boolean }).__BENCHPRESS_MODE = true;
    (window as unknown as { __DISABLE_ONBOARDING__: boolean }).__DISABLE_ONBOARDING__ = true;
    try { localStorage.setItem('appdata::smartchats::__backend_mode__', 'local'); } catch { /* noop */ }
  });
  return { browser, ctx };
}

async function bootPage(ctx: BrowserContext, appUrl: string): Promise<Page> {
  const page = await ctx.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') console.log(`    [browser:error] ${msg.text()}`); });
  await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForFunction(
    () => (window as unknown as { __smartchats__?: { getState(): { agent: unknown } } }).__smartchats__?.getState().agent !== null,
    null,
    { timeout: 30_000 },
  );
  // Onboarding — run once. Don't drag this into the bench workflows.
  await page.evaluate(async () => {
    const sm = (window as unknown as { __smartchats__: { simi: { workflows: Record<string, () => Promise<unknown>> } } }).__smartchats__;
    await sm.simi.workflows.complete_onboarding();
  });
  return page;
}

async function setModel(page: Page, model: string) {
  await page.evaluate(async (m) => {
    const sm = (window as unknown as { __smartchats__: { dispatch(action: string, ...args: unknown[]): Promise<unknown> } }).__smartchats__;
    await sm.dispatch('updateSettings', { aiModel: m });
    await sm.dispatch('saveSettings');
  }, model);
  await page.waitForFunction(
    (m) => {
      const st = (window as unknown as { __smartchats__?: { getState(): { agent: unknown; aiModel: string; llmRunning: boolean; settingsLoaded: boolean } } }).__smartchats__?.getState();
      return !!st && st.agent !== null && st.aiModel === m && !st.llmRunning && st.settingsLoaded;
    },
    model,
    { timeout: 15_000 },
  );
}

async function runScenario(page: Page, scenarioId: string): Promise<{ wfCompleted: boolean; raw: Record<string, unknown> | null }> {
  const wfId = `bench_${scenarioId}`;
  let wfCompleted = false;
  try {
    const wfRes = await page.evaluate(async (id) => {
      const sm = (window as unknown as { __smartchats__: { simi: { workflows: Record<string, () => Promise<{ completed?: boolean }>> } } }).__smartchats__;
      return await sm.simi.workflows[id]!();
    }, wfId);
    wfCompleted = !!(wfRes as { completed?: boolean }).completed;
  } catch (e) {
    console.log(`    workflow threw: ${(e as Error).message}`);
  }
  const raw = await page.evaluate(() => {
    const ins = (window as unknown as { cortexInsights?: { exportSession?: () => unknown } }).cortexInsights;
    return ins?.exportSession?.() ?? null;
  });
  return { wfCompleted, raw: raw as Record<string, unknown> | null };
}

// ──────────────────────────────────────────────────────────────────────────
// Aggregation
// ──────────────────────────────────────────────────────────────────────────

interface RunRecord {
  model: string;
  scenario_id: string;
  workflow_completed: boolean;
  result: ScenarioResult | null;
  error?: string;
}

function writeMatrixCsv(records: RunRecord[], models: string[], scenarios: string[], outPath: string) {
  const lines: string[] = [];
  lines.push(['scenario', ...models.map((m) => `${m}__outcome`), ...models.map((m) => `${m}__cost_usd`), ...models.map((m) => `${m}__total_s`)].join(','));
  for (const sid of scenarios) {
    const cells: string[] = [sid];
    for (const m of models) {
      const r = records.find((x) => x.model === m && x.scenario_id === sid);
      cells.push(r?.result?.outcome ?? (r ? 'errored' : 'missing'));
    }
    for (const m of models) {
      const r = records.find((x) => x.model === m && x.scenario_id === sid);
      cells.push(r?.result?.trace_metrics.estimated_cost_usd.toFixed(5) ?? '');
    }
    for (const m of models) {
      const r = records.find((x) => x.model === m && x.scenario_id === sid);
      cells.push(r?.result?.trace_metrics.total_ms ? (r.result.trace_metrics.total_ms / 1000).toFixed(1) : '');
    }
    lines.push(cells.join(','));
  }
  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
}

function summarize(records: RunRecord[]): Record<string, { runs: number; correct: number; wrong: number; no_submission: number; errored: number; total_cost: number }> {
  const byModel: Record<string, { runs: number; correct: number; wrong: number; no_submission: number; errored: number; total_cost: number }> = {};
  for (const r of records) {
    const slot = (byModel[r.model] ??= { runs: 0, correct: 0, wrong: 0, no_submission: 0, errored: 0, total_cost: 0 });
    slot.runs++;
    if (!r.result) slot.errored++;
    else {
      if (r.result.outcome === 'submitted_correct') slot.correct++;
      else if (r.result.outcome === 'submitted_wrong') slot.wrong++;
      else if (r.result.outcome === 'no_submission') slot.no_submission++;
      slot.total_cost += r.result.trace_metrics.estimated_cost_usd;
    }
  }
  return byModel;
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const truths: TruthsSnapshot = JSON.parse(readFileSync(truthsPath, 'utf8'));

const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = resolve(resultsDir, `run_${runStamp}`);
mkdirSync(runDir, { recursive: true });

console.log(`benchpress matrix run → ${runDir}`);
console.log(`  models   : ${args.models.length} (${args.models.join(', ')})`);
console.log(`  scenarios: ${args.scenarios.length} (${args.scenarios.join(', ')})`);
console.log(`  total    : ${args.models.length * args.scenarios.length} runs`);
console.log();

const records: RunRecord[] = [];

for (const model of args.models) {
  console.log(`── ${model} ──`);
  const { browser, ctx } = await setupContext(args.headed);
  try {
    const page = await bootPage(ctx, args.appUrl);
    await setModel(page, model);
    for (let i = 0; i < args.scenarios.length; i++) {
      const sid = args.scenarios[i]!;
      // Reload between scenarios to kill any orphaned llm-loops or stale
      // workspace from the prior scenario's failure mode. localStorage
      // persists across reload, so aiModel / backend_mode / onboarding-done
      // all survive — no need to re-onboard or re-setModel. Skip on the
      // first iteration (bootPage already gave us a fresh page).
      if (i > 0) {
        const tReload = Date.now();
        await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
        await page.waitForFunction(
          () => {
            const sm = (window as unknown as { __smartchats__?: { getState(): { agent: unknown; aiModel: string; settingsLoaded: boolean } } }).__smartchats__;
            const st = sm?.getState();
            return !!st && st.agent !== null && st.aiModel !== '' && st.settingsLoaded;
          },
          null,
          { timeout: 30_000 },
        );
        console.log(`    [reload ${Date.now() - tReload}ms]`);
      }
      const t0 = Date.now();
      try {
        const { wfCompleted, raw } = await runScenario(page, sid);
        if (!raw) {
          console.log(`  ${sid}: no session exported (${Date.now() - t0}ms)`);
          records.push({ model, scenario_id: sid, workflow_completed: wfCompleted, result: null, error: 'no session exported' });
          continue;
        }
        // Persist raw bundle per (model, scenario) so we can re-score later.
        writeFileSync(
          resolve(runDir, `session_${model}_${sid}.json`),
          JSON.stringify(raw, null, 2),
        );
        const result = scoreScenario(
          raw as Parameters<typeof scoreScenario>[0],
          sid,
          truths,
          { expectedDelta: EXPECTED_DELTAS[sid] },
        );
        records.push({ model, scenario_id: sid, workflow_completed: wfCompleted, result });
        const tm = result.trace_metrics;
        const mark = result.outcome === 'submitted_correct' ? '✓' : result.outcome === 'submitted_wrong' ? '✗' : '·';
        console.log(`  ${mark} ${sid}: ${result.outcome}  $${tm.estimated_cost_usd.toFixed(4)}  ${(tm.total_ms / 1000).toFixed(1)}s  (${Date.now() - t0}ms wall)`);
      } catch (e) {
        console.log(`  ${sid}: error — ${(e as Error).message}`);
        records.push({ model, scenario_id: sid, workflow_completed: false, result: null, error: (e as Error).message });
      }
    }
  } finally {
    await browser.close();
  }
}

writeFileSync(resolve(runDir, 'run.json'), JSON.stringify({ args, records, summary: summarize(records) }, null, 2));
writeMatrixCsv(records, args.models, args.scenarios, resolve(runDir, 'matrix.csv'));

const summary = summarize(records);
console.log();
console.log('── summary ──');
for (const [m, s] of Object.entries(summary)) {
  console.log(`  ${m}: ${s.correct}/${s.runs} correct, ${s.no_submission} no-submission, ${s.errored} errored, $${s.total_cost.toFixed(4)} total`);
}
console.log();
console.log(`run saved: ${runDir}`);
