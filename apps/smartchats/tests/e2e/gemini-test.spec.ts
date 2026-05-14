/**
 * Gemini streaming test — verifies Gemini works through the combined LLM+TTS endpoint.
 *
 * Usage: HEADED=1 npx playwright test gemini-test.spec.ts
 */

import { chromium, expect } from '@playwright/test';
import { test } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PROFILE_DIR = path.join(__dirname, '../../.auth/test-profile');
const RESULTS_DIR = path.join(__dirname, '../../test-results');

test('gemini basic chat', async () => {
  test.setTimeout(120_000);

  const headed = !!process.env.HEADED || process.argv.includes('--headed');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !headed,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  page.on('console', (msg: any) => {
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

    // Switch to Gemini
    await page.evaluate(() => {
      (window as any).__smartchats__.dispatch('updateSettings', { aiModel: 'gemini-3-pro-preview' });
    });
    await page.waitForTimeout(1000);

    // Send a message
    const result = await page.evaluate(async () => {
      const store = (window as any).__smartchats__;
      await store.dispatch('sendMessageAsync', 'Reply with exactly: gemini ok');
      const state = store.getState();
      return {
        lastAiMessage: state.lastAiMessage,
        chatHistory: state.chatHistory.slice(-3),
        aiModel: state.aiModel,
      };
    });

    console.log(`  Model: ${result.aiModel}`);
    console.log(`  Last AI message: "${result.lastAiMessage}"`);
    console.log(`  Chat history (last 3):`, JSON.stringify(result.chatHistory.map((m: any) => ({ role: m.role, content: m.content?.slice(0, 100) })), null, 2));

    expect(result.lastAiMessage.length).toBeGreaterThan(0);
    expect(result.lastAiMessage.toLowerCase()).toContain('gemini');

  } finally {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(RESULTS_DIR, 'gemini_test.png'), fullPage: true });
    await context.close();
  }
});
