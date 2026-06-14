/**
 * Benchpress prototype spec — proves the end-to-end path before we generalize.
 *
 *   - Forces local backend mode (no Firebase auth needed).
 *   - Disables onboarding so we land directly on the chat UI.
 *   - Runs the `bench_q01_prototype` simi workflow — directive is inline
 *     in the user prompt; SCM is identical to production.
 *   - Reads `state.workspace.bench_answer` + the exported session bundle.
 *   - Asserts the answer is the expected weight (158.4 lbs) for 2026-03-15
 *     (lenient: accepts bare number or {value: number} wrapper).
 *
 * Prereq: bin/test-bun-deploy --seed packages/benchpress/fixtures/canonical_user.surql
 *
 *   npx playwright test bench_prototype --reporter=list
 */
import { test, expect, chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const APP_URL = 'http://localhost:3000/app';
const TRUTH_Q01 = 158.4;
const RESULTS_DIR = path.join(__dirname, '../../test-results');

test('bench_q01_prototype end-to-end', async () => {
  test.setTimeout(180_000);

  const browser = await chromium.launch({ headless: !process.env.HEADED });
  const ctx = await browser.newContext();

  // Pre-boot setup: localStorage to force local mode + window flags to skip
  // onboarding. No benchpress-mode flag — SCM is now identical to production
  // and the directive lives inline in the user message.
  await ctx.addInitScript(() => {
    (window as any).__DISABLE_ONBOARDING__ = true;
    (window as any).__SIMI_DEBUG__ = true;
    try {
      localStorage.setItem('appdata::smartchats::__backend_mode__', 'local');
    } catch {
      /* page hasn't been navigated yet, ignore */
    }
  });

  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.text().includes('benchpress')) {
      console.log(`  [browser:${msg.type()}] ${msg.text()}`);
    }
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60_000 });

  // Wait for store + agent.
  await page.waitForFunction(
    () => (window as any).__smartchats__?.getState().agent !== null,
    null,
    { timeout: 30_000 },
  );

  // Drive the workflow.
  const wfResult = await page.evaluate(async () => {
    const sm = (window as any).__smartchats__;
    return await sm.simi.workflows.bench_q01_prototype();
  });

  console.log('  workflow result:', JSON.stringify(wfResult, null, 2));

  // Read the typed answer the agent submitted.
  const benchAnswer = await page.evaluate(
    () => (window as any).__smartchats__.getState().workspace.bench_answer,
  );

  console.log('  bench_answer:', JSON.stringify(benchAnswer, null, 2));

  // Export the session for offline analysis (same flow Part 2 scoring will use).
  const sessionBundle = await page.evaluate(() => {
    const ins = (window as any).cortexInsights;
    return ins?.exportSession?.() || null;
  });
  if (sessionBundle) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const p = path.join(RESULTS_DIR, `bench_q01_prototype_${Date.now()}.json`);
    fs.writeFileSync(p, JSON.stringify(sessionBundle, null, 2));
    console.log(`  session bundle saved: ${p}`);
  }

  // ── Assertions (lenient) ──────────────────────────────────────────────
  expect(benchAnswer, 'workspace.bench_answer was never set by the agent').toBeTruthy();
  // Accept bare number or {value: number} wrapper.
  const numeric = typeof benchAnswer === 'number'
    ? benchAnswer
    : (benchAnswer as { value?: number }).value;
  expect(typeof numeric).toBe('number');
  // Tolerant to rounding (truth is 158.4; agent may say 158 or 158.4).
  expect(Math.abs((numeric as number) - TRUTH_Q01)).toBeLessThanOrEqual(0.5);

  await browser.close();
});
