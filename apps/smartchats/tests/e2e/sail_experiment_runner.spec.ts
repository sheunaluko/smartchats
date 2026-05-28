/**
 * /sail experiment runner — headless suite execution + bundle capture.
 *
 * Drives the /sail ExperimentRunner end-to-end through the actual UI:
 *   1. Navigate to /sail, wait for SailShell mount + simi bridge ready
 *   2. Click the header "start voice" button → voice_session_start
 *   3. Set ExperimentRunner replicates input to 1 (keeps test runtime
 *      reasonable: 6 configs × 1 replicate × ~12s/run ≈ 1.5 min)
 *   4. Click "run suite (...)" → runner iterates DEFAULT_SUITE
 *   5. Wait for "stop" button to revert back to "run suite (...)" — that's
 *      the completion signal
 *   6. Snapshot `window.cortexInsights.exportSession()` and write the full
 *      bundle to test-results/sail_experiment_<ts>.json
 *
 * Asserts:
 *   - Run completes without crashing
 *   - At least one tts_playback_timing event fired (client-side scheduling
 *     telemetry working)
 *   - At least one tts_server_timing event fired (server-side encoder
 *     instrumentation working — gates on experiment_id presence)
 *   - At least one config produced a results row (UI rendered the matrix)
 *
 * Deeper analysis (chunk-0 arrival distributions, snap rate comparisons,
 * encoder warmup variance across configs) is done offline against the
 * saved bundle. This spec just generates the data + smoke-checks.
 *
 * Cost note: each run hits OpenAI TTS + LLM. 6 runs ≈ $0.05. Cheap but
 * non-zero. Headless TTS audio plays to a null sink (per fixtures.ts
 * fake-device flags) so no actual audio is emitted.
 *
 * Run:   PW_WORKERS=1 npx playwright test sail_experiment_runner.spec.ts
 *        (--workers=1 because the suite occupies the dev server while
 *        running; parallelism would just serialize at the server.)
 */

import { test, expect } from './fixtures';
import * as fs from 'fs';
import * as path from 'path';

const RESULTS_DIR = path.join(__dirname, '../../test-results');

// Workflow selection — env-toggleable so the same spec exercises both
// fast-pipeline-validation (basic_chat_flow) and bug-reproduction
// (long_response_flow). The long flow asks for ~200-word responses to
// force enough server-side HTTP flush cadence that audio_start arrives
// at the client BEFORE the first audio chunk — exposing the encoder
// warmup latency as a visible chunk-0 snap-forward (the actual bug).
//
// Run modes:
//   SAIL_EXPERIMENT_WORKFLOW=basic_chat_flow    (default, fast, validates instrumentation)
//   SAIL_EXPERIMENT_WORKFLOW=long_response_flow (slow, reproduces glitch)
const WORKFLOW_ID = process.env.SAIL_EXPERIMENT_WORKFLOW || 'basic_chat_flow';
const IS_LONG_FLOW = WORKFLOW_ID === 'long_response_flow';

const SUITE_TIMEOUT_MS = IS_LONG_FLOW ? 20 * 60_000 : 8 * 60_000;
const POST_SUITE_FLUSH_MS = IS_LONG_FLOW ? 15_000 : 6_000;

function ensureResultsDir() {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

test.describe('sail experiment runner', () => {
    test.describe.configure({ mode: 'serial' }); // single worker — owns the dev server while running

    test('runs full experiment suite headless and captures session bundle', async ({ workflowPage }) => {
        test.setTimeout(SUITE_TIMEOUT_MS);

        await workflowPage.goto('http://localhost:3000/sail', { waitUntil: 'networkidle' });

        // SailShell + simi bridge ready
        await expect(workflowPage.getByText('SAIL', { exact: true })).toBeVisible();
        await workflowPage.waitForFunction(
            () => (window as any).__smartchats__?.simi?.workflows?.basic_chat_flow,
            { timeout: 30_000 },
        );

        // Tag the session so we can isolate this run later via
        // `bin/find-sessions --tag sail_experiment_runner_test`
        await workflowPage.evaluate(() => {
            try { (window as any).cortexInsights?.addSessionTags?.(['sail_experiment_runner_test']); } catch { /* ignore */ }
        });

        // Start voice mode — required for the experiment runner: the LLM
        // call's wantAudio gate flips on only when ttsQueue is registered +
        // shouldPlayAudio returns true (which it does in voice mode).
        await workflowPage.getByRole('button', { name: /^start voice$/i }).click();
        await expect(workflowPage.locator('text=/● (idle|listening|speaking|processing)/')).toBeVisible({ timeout: 10_000 });

        // Select the requested workflow in ExperimentRunner's dropdown.
        // Default selection is basic_chat_flow; long_response_flow is the
        // bug-reproduction mode (much slower per run).
        if (WORKFLOW_ID !== 'basic_chat_flow') {
            const workflowSelect = workflowPage.locator('select').last(); // ExperimentRunner is bottom-most select on /sail
            await workflowSelect.selectOption(WORKFLOW_ID);
        }

        // Find the ExperimentRunner panel + reduce replicates to 1 for a
        // tractable runtime. Default is 3 (~5 min); 1 brings it to ~1.5 min
        // for basic_chat_flow, or ~9-10 min for long_response_flow.
        const replicatesInput = workflowPage.locator('input[type="number"]').first();
        await replicatesInput.fill('1');

        // Click "run suite (...)" — text includes the count, so match by prefix.
        const runButton = workflowPage.getByRole('button', { name: /run suite/i });
        await expect(runButton).toBeEnabled();
        await runButton.click();

        // Runner replaces the button text with "stop suite" while running
        // (header has a separate "stop" voice button — disambiguated).
        await expect(workflowPage.getByRole('button', { name: /^stop suite$/i })).toBeVisible({ timeout: 30_000 });

        // Wait for the suite to complete — the "stop suite" button reverts
        // to "run suite (...)" when runSuite() finishes.
        await expect(workflowPage.getByRole('button', { name: /run suite/i })).toBeVisible({ timeout: SUITE_TIMEOUT_MS - 60_000 });

        // One more flush window for the final run's TTS + insights batch
        await workflowPage.waitForTimeout(POST_SUITE_FLUSH_MS);

        // ─── Snapshot insights session bundle + save FIRST (before any
        // assertions, so we always have the artifact for diagnosis even
        // when the suite produced no expected events) ─────────────────────
        const bundle: any = await workflowPage.evaluate(() => {
            const ins = (window as any).cortexInsights;
            return ins?.exportSession?.() ?? null;
        });
        ensureResultsDir();
        const outPath = path.join(RESULTS_DIR, `sail_experiment_${Date.now()}.json`);
        if (bundle) fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2));

        const events: any[] = bundle?.events ?? [];
        const playbackEvents = events.filter((e: any) => e.event_type === 'tts_playback_timing');
        const serverTimingEvents = events.filter((e: any) => e.event_type === 'tts_server_timing');

        // Event-type histogram for diagnosis
        const histogram: Record<string, number> = {};
        for (const e of events) histogram[e.event_type] = (histogram[e.event_type] ?? 0) + 1;

        // Pull the results matrix UI state for diagnosis (per-config success counts)
        const matrixRows = await workflowPage.locator('table tbody tr').count();
        const matrixSummary: string[] = [];
        for (let i = 0; i < matrixRows; i++) {
            const row = workflowPage.locator('table tbody tr').nth(i);
            const cells = await row.locator('td').allTextContents();
            matrixSummary.push(cells.join(' | '));
        }

        // Distinct experiment_id tags observed in the session
        const expIdsSeen = new Set<string>();
        const configs = new Set<string>();
        for (const e of events) {
            const tags: string[] = e.tags ?? [];
            for (const t of tags) {
                if (t.startsWith('exp:')) {
                    expIdsSeen.add(t);
                    configs.add(t.split('_r')[0]);
                }
            }
        }

        console.log('\n  ─── Experiment Runner Suite Summary ───');
        console.log(`  Bundle:                ${outPath}`);
        console.log(`  Total events:          ${events.length}`);
        console.log(`  tts_playback_timing:   ${playbackEvents.length}`);
        console.log(`  tts_server_timing:     ${serverTimingEvents.length}`);
        console.log(`  Distinct experiments:  ${expIdsSeen.size} (${[...configs].join(', ')})`);
        console.log(`  Results matrix rows:   ${matrixRows}`);
        console.log(`  Event-type histogram:`);
        for (const [type, count] of Object.entries(histogram).sort((a, b) => b[1] - a[1])) {
            console.log(`    ${type.padEnd(36)} ${count}`);
        }
        console.log(`  Results matrix (config | runs | first_chunk | gap | snap | server_byte):`);
        for (const line of matrixSummary) console.log(`    ${line}`);
        console.log('  ────────────────────────────────────────\n');

        // ─── Assertions — happen after diagnostics are printed/saved ────
        expect(bundle, 'expected to capture a session bundle').not.toBeNull();
        expect(bundle.events, 'bundle.events should be defined').toBeDefined();
        expect(matrixRows, 'expected ≥1 results matrix row').toBeGreaterThan(0);
        expect(playbackEvents.length, 'expected ≥1 tts_playback_timing event').toBeGreaterThan(0);
        expect(serverTimingEvents.length, 'expected ≥1 tts_server_timing event (server emission gated on experiment_id)').toBeGreaterThan(0);
    });
});
