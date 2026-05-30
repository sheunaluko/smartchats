import { defineConfig } from '@playwright/test';
import * as os from 'os';

// Worker count: env-tunable, sane defaults.
// HEADED=1 forces workers=1 (you don't want N Chrome windows fighting for focus).
// CI defaults to 2; local defaults to min(4, cpus/2).
function resolveWorkers(): number {
  if (process.env.PW_WORKERS) return Math.max(1, parseInt(process.env.PW_WORKERS, 10) || 1);
  if (process.env.HEADED) return 1;
  if (process.env.CI) return 2;
  return Math.min(4, Math.max(1, Math.floor(os.cpus().length / 2)));
}

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: require.resolve('./tests/e2e/simi_global_setup'),
  // Parallel/serial granularity is controlled per-describe in simi.spec.ts
  // (test.describe.configure({ mode: 'parallel' | 'serial' })). Leaving
  // fullyParallel off so non-simi specs default to serial within a file.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: resolveWorkers(),
  // `open: 'never'` prevents Playwright's HTML reporter from auto-launching
  // a browser + report server when tests finish in a TTY context. The
  // auto-open hangs orchestrated runs like bin/test-e2e (the parent script
  // can't exit until the user closes the browser). View the report
  // explicitly via `npx playwright show-report` when wanted.
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: {
    command: 'curl -so /dev/null http://localhost:3000 2>&1 && sleep 86400 || npm run dev 2>&1 | tee test-results/server.log',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
