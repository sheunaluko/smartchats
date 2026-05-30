/**
 * Billing per-model verification — sends one message per provider and verifies
 * credits were deducted at the correct rate.
 *
 * Usage: HEADED=1 npx playwright test billing-models.spec.ts
 */

import { chromium, expect } from '@playwright/test';
import { test } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PROFILE_DIR = path.join(__dirname, '../../.auth/test-profile');
const RESULTS_DIR = path.join(__dirname, '../../test-results');

const MODELS = [
  { name: 'gpt-5.2', provider: 'openai', inputPricePer1M: 1.75, outputPricePer1M: 14 },
  { name: 'gemini-3.1-pro-preview', provider: 'gemini', inputPricePer1M: 2, outputPricePer1M: 12 },
  { name: 'claude-opus-4-5', provider: 'anthropic', inputPricePer1M: 5, outputPricePer1M: 25 },
];

function ensureResultsDir() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

for (const model of MODELS) {
  test(`billing: ${model.name} (${model.provider})`, async () => {
    test.setTimeout(120_000);

    const headed = !!process.env.HEADED || process.argv.includes('--headed');
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: !headed,
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    const consoleLogs: string[] = [];
    page.on('console', (msg: any) => {
      const ts = new Date().toISOString().slice(11, 23);
      consoleLogs.push(`[${ts}] [${msg.type()}] ${msg.text()}`);
      if (msg.type() === 'error') console.log(`  [browser:error] ${msg.text()}`);
    });

    try {
      await page.addInitScript(() => { (window as any).__DISABLE_ONBOARDING__ = true; });
      await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

      // Wait for app ready
      await page.waitForFunction(
        () => {
          const s = (window as any).__smartchats__?.getState?.();
          return s?.agent && s?.settingsLoaded;
        },
        { timeout: 30_000 },
      );

      // Switch model
      await page.evaluate((m: string) => {
        (window as any).__smartchats__.dispatch('updateSettings', { aiModel: m });
      }, model.name);
      await page.waitForTimeout(500);

      // Get balance before
      const balanceBefore = await page.evaluate(() => {
        const bs = (window as any).__smartchats_billing__?.getState?.();
        return {
          totalAvailable: bs?.totalAvailable ?? null,
          periodCredits: bs?.periodCredits ?? null,
          purchasedCredits: bs?.purchasedCredits ?? null,
        };
      });
      console.log(`\n  Model: ${model.name} (${model.provider})`);
      console.log(`  Balance before: ${balanceBefore.totalAvailable} credits`);

      // Send a minimal message
      await page.evaluate(async () => {
        await (window as any).__smartchats__.dispatch('sendMessageAsync', 'Say ok');
      });

      // Wait for billing update event to propagate
      await page.waitForTimeout(2000);

      // Get balance after
      const balanceAfter = await page.evaluate(() => {
        const bs = (window as any).__smartchats_billing__?.getState?.();
        return {
          totalAvailable: bs?.totalAvailable ?? null,
          periodCredits: bs?.periodCredits ?? null,
          purchasedCredits: bs?.purchasedCredits ?? null,
        };
      });
      console.log(`  Balance after: ${balanceAfter.totalAvailable} credits`);

      // Get usage from the last response event
      const lastUsage = await page.evaluate(() => {
        const s = (window as any).__smartchats__?.getState?.();
        return s?.contextUsage || null;
      });

      const creditsUsed = (balanceBefore.totalAvailable ?? 0) - (balanceAfter.totalAvailable ?? 0);
      console.log(`  Credits used: ${creditsUsed}`);

      // Verify billing happened
      expect(balanceBefore.totalAvailable).not.toBeNull();
      expect(balanceAfter.totalAvailable).not.toBeNull();
      expect(creditsUsed).toBeGreaterThan(0);

      // Verify rate is reasonable for the provider
      // System prompt is ~17K tokens, response is tiny.
      // Prompt caching can reduce input costs by ~90% for repeat calls.
      // Max estimate (no caching): (17000 / 1M) * inputPrice + (50 / 1M) * outputPrice
      // Min estimate (full caching): (17000 / 1M) * inputPrice * 0.1 + (50 / 1M) * outputPrice
      const maxCostUsd = (17000 / 1_000_000) * model.inputPricePer1M + (50 / 1_000_000) * model.outputPricePer1M;
      const minCostUsd = (17000 / 1_000_000) * model.inputPricePer1M * 0.1 + (50 / 1_000_000) * model.outputPricePer1M;
      const maxCredits = Math.ceil(maxCostUsd * 1000);
      const minCredits = Math.max(1, Math.floor(minCostUsd * 1000));
      console.log(`  Expected range: ${minCredits}-${maxCredits} credits (${model.inputPricePer1M}/${model.outputPricePer1M} $/MTok, caching varies)`);

      // Credits should be within the range accounting for caching + TTS overhead
      expect(creditsUsed).toBeGreaterThanOrEqual(minCredits);
      expect(creditsUsed).toBeLessThanOrEqual(maxCredits * 2); // 2x for TTS + overhead

      console.log(`  ✓ ${model.name}: ${creditsUsed} credits (range: ${minCredits}-${maxCredits})`);

    } catch (err) {
      ensureResultsDir();
      await page.screenshot({ path: path.join(RESULTS_DIR, `billing_${model.provider}_fail.png`), fullPage: true });
      throw err;
    } finally {
      ensureResultsDir();
      fs.writeFileSync(
        path.join(RESULTS_DIR, `billing_${model.provider}_console.log`),
        consoleLogs.join('\n'),
      );
      await context.close();
    }
  });
}
