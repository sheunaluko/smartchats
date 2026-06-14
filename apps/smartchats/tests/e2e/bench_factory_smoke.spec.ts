/**
 * Smoke test for the benchpress workflow factory.
 *
 * Sets one model (claude-sonnet-4-6), then runs the factory-generated
 * `bench_q01_weight_lookup` workflow. Validates that the factory
 * pattern (model set once at session start; setupWorkflows omitted from
 * the factory; sendMessageAsync + waitFor bench_answer) works end-to-end.
 *
 * Why just q01 here: scenarios like q07 (negative) and q06 (KG list) exercise
 * agent capabilities (anti-hallucination, KG navigation without embeddings)
 * that are real benchmark signal, not factory health. Those outcomes get
 * captured + scored by Part 2 (Tasks #9, #10), not asserted in the smoke.
 *
 * Prereq: bin/test-bun-deploy --seed packages/benchpress/fixtures/canonical_user.surql
 */
import { test, expect, chromium, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const APP_URL = 'http://localhost:3000/app';
const MODEL = 'claude-sonnet-4-6';
const RESULTS_DIR = path.join(__dirname, '../../test-results');

async function setupPage(): Promise<{ browser: Awaited<ReturnType<typeof chromium.launch>>; page: Page }> {
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    (window as any).__DISABLE_ONBOARDING__ = true;
    (window as any).__SIMI_DEBUG__ = true;
    try { localStorage.setItem('appdata::smartchats::__backend_mode__', 'local'); } catch { /* ignore */ }
  });
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`  [browser:error] ${msg.text()}`);
  });
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForFunction(
    () => (window as any).__smartchats__?.getState().agent !== null,
    null,
    { timeout: 30_000 },
  );
  // One-time onboarding completion — same effect the bench workflows
  // used to get from setupWorkflows: ['complete_onboarding']. Doing it
  // here means we set it once and aiModel isn't touched again.
  await page.evaluate(async () => {
    const sm = (window as any).__smartchats__;
    await sm.simi.workflows.complete_onboarding();
  });
  return { browser, page };
}

async function setModel(page: Page, model: string) {
  await page.evaluate(async (m) => {
    const sm = (window as any).__smartchats__;
    await sm.dispatch('updateSettings', { aiModel: m });
    await sm.dispatch('saveSettings');
  }, model);
  await page.waitForFunction(
    () => {
      const st = (window as any).__smartchats__?.getState();
      return st?.agent !== null && !st.llmRunning && st.settingsLoaded;
    },
    null,
    { timeout: 15_000 },
  );
}

async function runBench(page: Page, scenarioId: string): Promise<unknown> {
  const wfId = `bench_${scenarioId}`;
  const result = await page.evaluate(async (id) => {
    const sm = (window as any).__smartchats__;
    return await sm.simi.workflows[id]();
  }, wfId);
  const answer = await page.evaluate(
    () => (window as any).__smartchats__.getState().workspace.bench_answer,
  );

  // Persist session per scenario for Part 2 scoring (Task #9).
  const sessionBundle = await page.evaluate(() => {
    const ins = (window as any).cortexInsights;
    return ins?.exportSession?.() || null;
  });
  if (sessionBundle) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const p = path.join(RESULTS_DIR, `bench_${scenarioId}_${Date.now()}.json`);
    fs.writeFileSync(p, JSON.stringify(sessionBundle, null, 2));
    console.log(`  session saved: ${p}`);
  }
  console.log(`  ${wfId} result.completed=${(result as { completed?: boolean })?.completed} answer=${JSON.stringify(answer)}`);
  return answer;
}

test('benchpress factory smoke (scalar + list + negative)', async () => {
  test.setTimeout(360_000);

  const { browser, page } = await setupPage();
  try {
    await setModel(page, MODEL);

    const a1 = await runBench(page, 'q01_weight_lookup') as { value: number; kind: string };
    expect(a1).toBeTruthy();
    expect(a1.kind).toBe('scalar');
    expect(Math.abs(a1.value - 158.4)).toBeLessThanOrEqual(0.5);
  } finally {
    await browser.close();
  }
});
