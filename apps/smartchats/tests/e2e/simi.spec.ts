/**
 * SmartChats v1 Validation Suite
 *
 * Run one:     HEADED=1 npx playwright test simi.spec.ts --grep "basic_chat_flow"
 * Run all:     npx playwright test simi.spec.ts
 * Run by tag:  npx playwright test simi.spec.ts --grep "smoke"
 *
 * Setup:       npx playwright test setup-test-profile --headed
 * Requires:    Dev server + Firebase emulator running
 */

import { chromium, expect } from '@playwright/test';
import { test } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PROFILE_DIR = path.join(__dirname, '../../.auth/test-profile');
const RESULTS_DIR = path.join(__dirname, '../../test-results');

// bridge: which window global hosts the simi runner for this workflow
// requiresBilling: when true, the workflow is skipped against backends that
//                  don't advertise billing (e.g. self-hosted / LocalBackend).
type WorkflowDef = {
  name: string;
  bridge: '__smartchats__' | '__smartchats_billing__';
  requiresBilling?: boolean;
};

const ALL_WORKFLOWS: WorkflowDef[] = [
  // ── No LLM (fast) ──
  { name: 'settings_persistence_flow', bridge: '__smartchats__' },
  { name: 'kg_settings_flow', bridge: '__smartchats__' },
  { name: 'auth_guard_flow', bridge: '__smartchats__' },
  { name: 'storage_mode_switch_flow', bridge: '__smartchats__' },
  { name: 'balance_fetch_flow', bridge: '__smartchats_billing__', requiresBilling: true },
  { name: 'usage_fetch_flow', bridge: '__smartchats_billing__' },
  { name: 'byo_key_lifecycle_flow', bridge: '__smartchats_billing__' },

  // ── LLM-dependent ──
  { name: 'basic_chat_flow', bridge: '__smartchats__' },
  { name: 'model_switch_flow', bridge: '__smartchats__' },
  { name: 'clear_and_resume_flow', bridge: '__smartchats__' },
  { name: 'multi_turn_context_flow', bridge: '__smartchats__' },
  { name: 'session_save_load_flow', bridge: '__smartchats__' },
  { name: 'code_execution_flow', bridge: '__smartchats__' },
  { name: 'knowledge_graph_flow', bridge: '__smartchats__' },
  { name: 'workspace_update_flow', bridge: '__smartchats__' },
  { name: 'html_display_flow', bridge: '__smartchats__' },
  { name: 'agent_delegation_flow', bridge: '__smartchats__' },
  { name: 'boolean_metrics_flow', bridge: '__smartchats__' },
  { name: 'app_lifecycle_flow', bridge: '__smartchats__' },
  { name: 'breathing_app_flow', bridge: '__smartchats__' },
  { name: 'canary_sweep_flow', bridge: '__smartchats__' },
  { name: 'log_explorer_flow', bridge: '__smartchats__' },
  { name: 'metrics_explorer_flow', bridge: '__smartchats__' },
  { name: 'auto_metrics_explorer_flow', bridge: '__smartchats__' },
  { name: 'auto_todo_flow', bridge: '__smartchats__' },
  { name: 'auto_kg_explorer_flow', bridge: '__smartchats__' },
  { name: 'seed_test_data_flow', bridge: '__smartchats__' },
];

// Filter out billing-required workflows when running against a no-billing
// backend (self-hosted / LocalBackend). Controlled via `SMARTCHATS_BOOTSTRAP`:
// the same env var the app reads to pick its bootstrap path.
const IS_LOCAL_BOOTSTRAP = process.env.SMARTCHATS_BOOTSTRAP === 'local' ||
  process.env.NEXT_PUBLIC_SMARTCHATS_BOOTSTRAP === 'local';
const WORKFLOWS: WorkflowDef[] = IS_LOCAL_BOOTSTRAP
  ? ALL_WORKFLOWS.filter((w) => !w.requiresBilling)
  : ALL_WORKFLOWS;

function ensureResultsDir() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

async function captureSession(page: any, name: string) {
  try {
    const data = await page.evaluate(() => {
      const ins = (window as any).cortexInsights;
      return ins?.exportSession?.() || null;
    });
    if (data) {
      ensureResultsDir();
      const p = path.join(RESULTS_DIR, `session_${name}_${Date.now()}.json`);
      fs.writeFileSync(p, JSON.stringify(data, null, 2));
      console.log(`  Session saved: ${p}`);
    }
  } catch { /* non-critical */ }
}

// ─── Fast-iteration mode (opt-in) ─────────────────────────────────
//
// SIMI_REUSE_BROWSER=1 reuses a single browser context + page across
// every test, doing `page.goto` between workflows instead of a full
// browser relaunch. Cuts per-test overhead dramatically at the cost
// of shared in-memory state (persistent profile dir is shared in
// both modes; what differs is service workers, cached modules,
// connection pools, etc.).
const REUSE_BROWSER = process.env.SIMI_REUSE_BROWSER === '1' ||
  process.env.SIMI_REUSE_BROWSER === 'true';

// Single aggregated live log — stable file you can `tail -F` across
// the whole run. simi_global_setup truncates it at run start; beforeAll
// opens in append mode so a worker restart (triggered by a failing test)
// doesn't wipe the history. runIndex persists through the same restart
// via a JSON state file.
const LIVE_LOG = path.join(RESULTS_DIR, 'simi_live.log');
const STATE_FILE = path.join(RESULTS_DIR, '.simi_run_state.json');
let liveStream: fs.WriteStream | null = null;

function readRunIndex(): number {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const n = JSON.parse(raw)?.runIndex;
    return typeof n === 'number' && n >= 0 ? n : 0;
  } catch { return 0; }
}
function writeRunIndex(n: number) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ runIndex: n })); } catch { /* non-fatal */ }
}

// Filtered test count: Playwright's `testInfo.config.grep` doesn't
// reflect CLI `--grep` at runtime (microsoft/playwright#31086) and the
// worker process doesn't receive the flag via argv either. When you run
// a subset via --grep, pass SIMI_EXPECTED=<n> so progress markers show
// the true count. Defaults to the full set otherwise.
const EXPECTED_RUN_COUNT = (() => {
  const n = parseInt(process.env.SIMI_EXPECTED ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : WORKFLOWS.length;
})();

// Real-time log stream for the currently-running test. Set at the
// top of each test, closed in finally. Per-workflow file gets the
// FULL console stream; the aggregate live log only gets progress
// markers (see writeLive) so `simi_watch` stays scannable.
let activeLogStream: fs.WriteStream | null = null;
let activeWfName = '';
function logLine(line: string) {
  if (activeLogStream) activeLogStream.write(line + '\n');
}

function writeLive(line: string) {
  if (liveStream) liveStream.write(line + '\n');
  console.log('  ' + line);
}

function attachPageListeners(page: any) {
  page.on('console', (msg: any) => {
    const type = msg.type();
    const text = msg.text();
    const ts = new Date().toISOString().slice(11, 23);
    logLine(`[${ts}] [${type}] ${text}`);
    if (type === 'error') console.log(`  [browser:error] ${text}`);
  });
  page.on('pageerror', (err: any) => {
    const ts = new Date().toISOString().slice(11, 23);
    logLine(`[${ts}] [pageerror] ${err.message}`);
    console.log(`  [browser:pageerror] ${err.message}`);
  });
  page.on('requestfailed', (req: any) => {
    const ts = new Date().toISOString().slice(11, 23);
    logLine(`[${ts}] [network:fail] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  // Surface non-2xx HTTP responses. Browser "Failed to load resource"
  // lines don't carry the URL; this does.
  page.on('response', async (res: any) => {
    const status = res.status();
    if (status < 400) return;
    const ts = new Date().toISOString().slice(11, 23);
    const req = res.request();
    let bodySnippet = '';
    try {
      const text = await res.text();
      bodySnippet = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    } catch { /* body unavailable */ }
    const line = `[${ts}] [network:${status}] ${req.method()} ${res.url()} — ${bodySnippet.replace(/\n/g, ' ').trim()}`;
    logLine(line);
    console.log(`  ${line}`);
  });
}

async function launchBrowser() {
  if (!fs.existsSync(path.join(PROFILE_DIR, 'Default'))) {
    throw new Error('No test profile. Run: npx playwright test setup-test-profile --headed');
  }
  const headed = !!process.env.HEADED || process.argv.includes('--headed');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !headed,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as any).__DISABLE_ONBOARDING__ = true;
    // Turn on logger.simi_debug() output for every Simi test run. Any
    // diagnostic block gated on window.__SIMI_DEBUG__ becomes visible
    // in the per-workflow console log without changing env vars.
    (window as any).__SIMI_DEBUG__ = true;
  });
  attachPageListeners(page);
  return { context, page };
}

// Shared resources for REUSE_BROWSER mode
let sharedContext: any = null;
let sharedPage: any = null;

test.beforeAll(async () => {
  ensureResultsDir();
  liveStream = fs.createWriteStream(LIVE_LOG, { flags: 'a' });
  // Emit headline only on the first worker (detected via an empty state
  // file). Worker restarts after a failure re-enter beforeAll; we don't
  // want to re-print the headline then.
  if (readRunIndex() === 0) {
    const bootstrap = process.env.SMARTCHATS_BOOTSTRAP || 'default';
    writeLive(`[simi-harness] ${EXPECTED_RUN_COUNT} workflow(s) — bootstrap=${bootstrap} reuseBrowser=${REUSE_BROWSER}`);
  } else {
    writeLive(`[simi-harness] worker restarted — resuming from run ${readRunIndex() + 1}`);
  }
  if (REUSE_BROWSER) {
    const b = await launchBrowser();
    sharedContext = b.context;
    sharedPage = b.page;
  }
});

test.afterAll(async () => {
  if (sharedContext) {
    await sharedContext.close();
    sharedContext = null;
    sharedPage = null;
  }
  if (liveStream) {
    liveStream.end();
    liveStream = null;
  }
});

for (const wf of WORKFLOWS) {
  test(wf.name, async () => {
    test.setTimeout(180_000);

    const runIndex = readRunIndex() + 1;
    writeRunIndex(runIndex);
    const progressPrefix = `(${runIndex}/${EXPECTED_RUN_COUNT})`;
    const startMs = Date.now();

    ensureResultsDir();
    const logPath = path.join(RESULTS_DIR, `${wf.name}_console.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });
    activeLogStream = logStream;
    activeWfName = wf.name;
    writeLive(`▶ ${progressPrefix} ${wf.name} — START`);
    console.log(`  Console log (streaming): ${logPath}`);

    let context: any;
    let page: any;
    let ownContext = false;
    if (REUSE_BROWSER && sharedPage) {
      context = sharedContext;
      page = sharedPage;
    } else {
      const b = await launchBrowser();
      context = b.context;
      page = b.page;
      ownContext = true;
    }

    try {
      await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

      // Wait for the correct bridge + workflow to be ready
      await page.waitForFunction(
        ({ name, bridge }: { name: string; bridge: string }) =>
          (window as any)[bridge]?.simi?.workflows?.[name],
        { name: wf.name, bridge: wf.bridge },
        { timeout: 30_000 },
      );

      console.log(`\n  Running: ${wf.name} (via ${wf.bridge})`);

      const result = await page.evaluate(
        ({ name, bridge }: { name: string; bridge: string }) =>
          (window as any)[bridge].simi.workflows[name](),
        { name: wf.name, bridge: wf.bridge },
      );

      console.log(`  Steps:`);
      for (const step of (result as any).steps || []) {
        const icon = step.status === 'ok' ? '  \u2713' : '  \u2717';
        console.log(`${icon} ${step.step} (${step.duration_ms}ms)${step.error ? ' — ' + step.error : ''}`);
      }
      console.log(`  Total: ${(result as any).total_ms}ms`);

      const failedStep = (result as any).steps?.find((s: any) => s.status === 'error');
      const errSummary = (result as any).error || failedStep?.error;
      if ((result as any).completed) {
        writeLive(`✓ ${progressPrefix} ${wf.name} — PASS ${Date.now() - startMs}ms`);
      } else {
        writeLive(`✗ ${progressPrefix} ${wf.name} — FAIL ${Date.now() - startMs}ms — ${errSummary || 'unknown'}`);
      }

      expect(
        (result as any).completed,
        `${wf.name} failed: ${errSummary}`,
      ).toBe(true);

      await captureSession(page, wf.name);
    } catch (err) {
      writeLive(`✗ ${progressPrefix} ${wf.name} — ERROR ${Date.now() - startMs}ms — ${(err as Error).message.split('\n')[0]}`);
      await captureSession(page, `${wf.name}_FAIL`);
      await page.screenshot({ path: path.join(RESULTS_DIR, `${wf.name}_fail.png`), fullPage: true });
      throw err;
    } finally {
      activeLogStream = null;
      activeWfName = '';
      logStream.end();
      if (ownContext) await context.close();
    }
  });
}
