/**
 * Worker-scoped Playwright fixtures for the parallel Simi runner.
 *
 * One persistent Chromium context per worker (reused across tests in
 * that worker — replaces the old REUSE_BROWSER=1 mode by making it the
 * default). Each worker gets its own profile dir, cloned lazily from
 * the template at `.auth/test-profile/`. New page per test for isolation.
 *
 * Why worker-scoped: chromium's --user-data-dir is single-instance, so
 * two workers can't share a profile. The template stays read-only;
 * each worker's clone absorbs Chromium's writebacks (cookies, IDB) so
 * test runs can mutate freely without poisoning the template.
 */

import { test as baseTest, chromium, type BrowserContext, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const TEMPLATE_DIR = path.join(__dirname, '../../.auth/test-profile');

function profileDirForWorker(workerIndex: number): string {
  return path.join(__dirname, `../../.auth/test-profile-${workerIndex}`);
}

export const test = baseTest.extend<
  { workflowPage: Page },
  { profileDir: string; persistentContext: BrowserContext }
>({
  profileDir: [async ({ }, use, workerInfo) => {
    const dir = profileDirForWorker(workerInfo.workerIndex);
    if (!fs.existsSync(path.join(dir, 'Default'))) {
      if (!fs.existsSync(path.join(TEMPLATE_DIR, 'Default'))) {
        throw new Error(
          `Test profile template missing at ${TEMPLATE_DIR}.\n` +
          `Run once: HEADED=1 npx playwright test setup-test-profile.spec.ts`,
        );
      }
      fs.cpSync(TEMPLATE_DIR, dir, { recursive: true });
    }
    await use(dir);
  }, { scope: 'worker' }],

  persistentContext: [async ({ profileDir }, use) => {
    const headed = !!process.env.HEADED || process.argv.includes('--headed');
    const ctx = await chromium.launchPersistentContext(profileDir, {
      headless: !headed,
      viewport: { width: 1280, height: 720 },
    });
    await use(ctx);
    await ctx.close();
  }, { scope: 'worker' }],

  workflowPage: async ({ persistentContext }, use) => {
    const page = await persistentContext.newPage();
    await page.addInitScript(() => {
      (window as any).__DISABLE_ONBOARDING__ = true;
      // Mirror old behavior: enable __SIMI_DEBUG__ logger output for every run.
      (window as any).__SIMI_DEBUG__ = true;
    });
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
