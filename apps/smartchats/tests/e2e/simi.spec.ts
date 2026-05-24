/**
 * SmartChats v1 Validation Suite — parallel runner.
 *
 * Two describes:
 *   - "simi parallel" — workflows that don't mutate user-scoped state,
 *     scheduled across all workers (mode: 'parallel').
 *   - "simi serial"   — workflows that write user-scoped data; pinned
 *     to one worker, runs in order (mode: 'serial'). Will go fully
 *     parallel once per-worker Firebase users land (phase 3).
 *
 * Worker count: --workers=N (CLI), PW_WORKERS=N env, or default from
 * playwright.config.ts. HEADED=1 forces workers=1.
 *
 * Run one:     npx playwright test simi.spec.ts --grep "basic_chat_flow"
 * Run all:     npx playwright test simi.spec.ts
 * Run by tag:  npx playwright test simi.spec.ts --grep "settings"
 * Run headed:  HEADED=1 npx playwright test simi.spec.ts
 * Setup:       npx playwright test setup-test-profile --headed
 * Requires:    Dev server + Firebase emulator running
 */

import { test, expect } from './fixtures';
import { PARALLEL_SAFE, RACE_PRONE, type WorkflowDef } from './workflow_partitions';
import * as path from 'path';
import * as fs from 'fs';

const RESULTS_DIR = path.join(__dirname, '../../test-results');

// Filter out billing-required workflows when running against a no-billing
// backend (self-hosted / LocalBackend). Controlled via `SMARTCHATS_BOOTSTRAP`.
const IS_LOCAL_BOOTSTRAP = process.env.SMARTCHATS_BOOTSTRAP === 'local' ||
  process.env.NEXT_PUBLIC_SMARTCHATS_BOOTSTRAP === 'local';

function filterByBootstrap(wfs: WorkflowDef[]): WorkflowDef[] {
  return IS_LOCAL_BOOTSTRAP ? wfs.filter((w) => !w.requiresBilling) : wfs;
}

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

// Per-worker live log. globalSetup wiped any prior simi_live.*.log, so
// opening in append mode here gives a clean per-worker stream that
// survives Playwright's worker-restart-after-failure cycle.
function liveLogPath(parallelIndex: number): string {
  return path.join(RESULTS_DIR, `simi_live.${parallelIndex}.log`);
}

function appendLive(parallelIndex: number, line: string) {
  try {
    ensureResultsDir();
    fs.appendFileSync(liveLogPath(parallelIndex), line + '\n');
  } catch { /* non-fatal */ }
  console.log('  ' + line);
}

function attachPageListeners(page: any, logStream: fs.WriteStream) {
  const stamp = () => new Date().toISOString().slice(11, 23);
  const line = (s: string) => { try { logStream.write(s + '\n'); } catch { /* ignore */ } };

  page.on('console', (msg: any) => {
    const type = msg.type();
    const text = msg.text();
    line(`[${stamp()}] [${type}] ${text}`);
    if (type === 'error') console.log(`  [browser:error] ${text}`);
  });
  page.on('pageerror', (err: any) => {
    line(`[${stamp()}] [pageerror] ${err.message}`);
    console.log(`  [browser:pageerror] ${err.message}`);
  });
  page.on('requestfailed', (req: any) => {
    line(`[${stamp()}] [network:fail] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on('response', async (res: any) => {
    const status = res.status();
    if (status < 400) return;
    const req = res.request();
    let bodySnippet = '';
    try {
      const text = await res.text();
      bodySnippet = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    } catch { /* body unavailable */ }
    const out = `[${stamp()}] [network:${status}] ${req.method()} ${res.url()} — ${bodySnippet.replace(/\n/g, ' ').trim()}`;
    line(out);
    console.log(`  ${out}`);
  });
}

async function runWorkflow(page: any, wf: WorkflowDef, workerIndex: number, parallelIndex: number) {
  test.setTimeout(180_000);
  ensureResultsDir();

  const logPath = path.join(RESULTS_DIR, `${wf.name}_w${workerIndex}_console.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  attachPageListeners(page, logStream);

  const startMs = Date.now();
  appendLive(parallelIndex, `▶ [w${workerIndex}] ${wf.name} — START`);
  console.log(`  Console log (streaming): ${logPath}`);

  try {
    // /app — the chat UI. Root (/) now serves the embedded apps/site landing,
    // which doesn't load the Simi runtime. All Simi workflows assume the
    // chat app, so navigate explicitly to /app.
    await page.goto('http://localhost:3000/app', { waitUntil: 'networkidle' });

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
      const icon = step.status === 'ok' ? '  ✓' : '  ✗';
      console.log(`${icon} ${step.step} (${step.duration_ms}ms)${step.error ? ' — ' + step.error : ''}`);
    }
    console.log(`  Total: ${(result as any).total_ms}ms`);

    const failedStep = (result as any).steps?.find((s: any) => s.status === 'error');
    const errSummary = (result as any).error || failedStep?.error;
    if ((result as any).completed) {
      appendLive(parallelIndex, `✓ [w${workerIndex}] ${wf.name} — PASS ${Date.now() - startMs}ms`);
    } else {
      appendLive(parallelIndex, `✗ [w${workerIndex}] ${wf.name} — FAIL ${Date.now() - startMs}ms — ${errSummary || 'unknown'}`);
    }

    expect(
      (result as any).completed,
      `${wf.name} failed: ${errSummary}`,
    ).toBe(true);

    await captureSession(page, wf.name);
  } catch (err) {
    appendLive(parallelIndex, `✗ [w${workerIndex}] ${wf.name} — ERROR ${Date.now() - startMs}ms — ${(err as Error).message.split('\n')[0]}`);
    await captureSession(page, `${wf.name}_FAIL`);
    await page.screenshot({ path: path.join(RESULTS_DIR, `${wf.name}_w${workerIndex}_fail.png`), fullPage: true });
    throw err;
  } finally {
    logStream.end();
  }
}

// ── Parallel describe — workflows safe to interleave across workers ──
test.describe('simi parallel', () => {
  test.describe.configure({ mode: 'parallel' });
  for (const wf of filterByBootstrap(PARALLEL_SAFE)) {
    test(wf.name, async ({ workflowPage }, testInfo) => {
      await runWorkflow(workflowPage, wf, testInfo.workerIndex, testInfo.parallelIndex);
    });
  }
});

// ── Serial describe — workflows that mutate shared user state ──
// Pinned to a single worker; runs in declaration order. Promote
// individual workflows to PARALLEL_SAFE once per-worker Firebase
// users exist (phase 3).
test.describe('simi serial', () => {
  test.describe.configure({ mode: 'serial' });
  for (const wf of filterByBootstrap(RACE_PRONE)) {
    test(wf.name, async ({ workflowPage }, testInfo) => {
      await runWorkflow(workflowPage, wf, testInfo.workerIndex, testInfo.parallelIndex);
    });
  }
});
