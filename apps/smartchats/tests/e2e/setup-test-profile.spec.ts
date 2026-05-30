/**
 * Creates a persistent Chrome profile for the open-source simi runner.
 *
 * Open has no Firebase / no login state — this spec just materializes a
 * warm profile dir under .auth/test-profile/ that the worker fixtures in
 * fixtures.ts can clone from. Run once, then all simi tests reuse it.
 *
 * Cloud / closed overlays its own setup spec on top (which DOES sign in
 * anonymously via Firebase) — see overlays/smartchats-app/tests/e2e/setup-test-profile.spec.ts
 * in the closed repo.
 *
 * Usage: HEADED=1 npx playwright test setup-test-profile.spec.ts
 *        (or just run bin/simi-bun — it auto-bootstraps if missing)
 */

import { chromium } from '@playwright/test';
import { test } from '@playwright/test';
import * as path from 'path';

const PROFILE_DIR = path.join(__dirname, '../../.auth/test-profile');

test('setup persistent test profile', async () => {
  test.setTimeout(60_000);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !process.env.HEADED,
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();

  await page.addInitScript(() => { (window as any).__DISABLE_ONBOARDING__ = true; });
  // The React app + __smartchats__ bridge live at /app. Root (/) serves
  // the marketing landing from _site/ — see local-server src/app.ts:69.
  // simi.spec.ts navigates to /app too; mirror that.
  await page.goto('http://localhost:3000/app', { waitUntil: 'networkidle' });

  // Wait for the SmartChats bridge to mount — same gate the simi workflows
  // assume is up before they start. No auth check here: open is unauthed.
  await page.waitForFunction(() => (window as any).__smartchats__, { timeout: 30_000 });

  console.log('Persistent profile created at:', PROFILE_DIR);
  await context.close();
});
