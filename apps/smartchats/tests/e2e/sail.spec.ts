/**
 * /sail — SmartChats Audio Intelligence Lab regression net.
 *
 * Strategy (per the simi-vs-/sail testing discussion):
 *   - simi workflows test the agent pipeline, which is identical between
 *     /app and /sail (same orchestrator, same store, same insights). We
 *     run one canonical simi workflow inside /sail to prove the shell
 *     variant doesn't break the pipeline.
 *   - Direct Playwright assertions handle /sail's NEW surface (wasm
 *     load status text, three canvas presence, event-trace panel
 *     content, session tags) — these are component-local React state
 *     and DOM/canvas concerns that don't fit simi's store-driven model.
 *
 * Headless audio caveat: TTS plays to a null sink (you can't *hear*
 * anything), but every `source.start(scheduleTime)` still happens and
 * every `tts_playback_timing` field is computed correctly. The fixture
 * adds `--use-fake-device-for-media-stream` so the Spectrogram's
 * getUserMedia call resolves without a permission prompt.
 */

import { test, expect } from './fixtures';
import * as fs from 'fs';
import * as path from 'path';

const RESULTS_DIR = path.join(__dirname, '../../test-results');

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
            const p = path.join(RESULTS_DIR, `session_sail_${name}_${Date.now()}.json`);
            fs.writeFileSync(p, JSON.stringify(data, null, 2));
            console.log(`  Session saved: ${p}`);
        }
    } catch { /* non-critical */ }
}

// All sail tests are parallel-safe — they read sail surface state +
// run a single short simi workflow, no shared user-data mutation that
// would race other workers.
test.describe('sail surface', () => {
    test.describe.configure({ mode: 'parallel' });

    test('mounts cleanly + lab poc loads + session tagged', async ({ workflowPage }, testInfo) => {
        test.setTimeout(60_000);
        await workflowPage.goto('http://localhost:3000/sail', { waitUntil: 'networkidle' });

        // SailShell rendered
        await expect(workflowPage.getByText('SAIL', { exact: true })).toBeVisible();

        // Lab POC: wasm loaded and the two rust-side checks pass
        await expect(workflowPage.getByText(/loaded · all checks pass/)).toBeVisible({
            timeout: 10_000,
        });
        await expect(workflowPage.getByText(/sail-dsp 0\.1\.0/)).toBeVisible();
        await expect(workflowPage.getByText(/add\(2,3\)/)).toContainText('5 ✓');
        await expect(workflowPage.getByText(/rms\(\[/)).toContainText('0.500000 ✓');

        // Canvases present: index 0 is the Spectrogram, index 1 is the three.js cube.
        const spectrogramBox = await workflowPage.locator('canvas').nth(0).boundingBox();
        expect(spectrogramBox?.width ?? 0).toBeGreaterThan(0);
        const cubeBox = await workflowPage.locator('canvas').nth(1).boundingBox();
        expect(cubeBox?.width ?? 0).toBeGreaterThan(0);

        // Session tagged 'sail' (so `bin/find-sessions --tag sail` can isolate
        // /sail sessions from /app sessions even though both share app_name).
        const tags = await workflowPage.evaluate(
            () => (window as any).cortexInsights?.getSessionTags?.() ?? []
        );
        expect(tags).toContain('sail');

        await captureSession(workflowPage, 'mounts_cleanly');
    });

    test('voice pipeline runs inside /sail (same simi workflow as /app)', async ({ workflowPage }) => {
        test.setTimeout(180_000);
        await workflowPage.goto('http://localhost:3000/sail', { waitUntil: 'networkidle' });

        // Wait for the agent bridge to be ready (same as simi.spec.ts pattern)
        await workflowPage.waitForFunction(
            () => (window as any).__smartchats__?.simi?.workflows?.basic_chat_flow,
            { timeout: 30_000 },
        );

        // Run the canonical chat workflow — proves the shell variant doesn't
        // interfere with the orchestrator / agent / TTS pipeline.
        const result = await workflowPage.evaluate(
            () => (window as any).__smartchats__.simi.workflows.basic_chat_flow()
        );
        const failedStep = (result as any).steps?.find((s: any) => s.status === 'error');
        const errSummary = (result as any).error || failedStep?.error;
        expect((result as any).completed, `basic_chat_flow in /sail failed: ${errSummary}`).toBe(true);

        // Phase A telemetry should have fired during TTS playback. tts_playback_timing
        // is produced from inside tts_queue's playStream regardless of audible output —
        // headless null-sink audio doesn't suppress it.
        const events = await workflowPage.evaluate(
            () => (window as any).cortexInsights?.exportSession?.()?.events ?? []
        );
        const ttsEvents = events.filter((e: any) => e.event_type === 'tts_playback_timing');
        expect(ttsEvents.length, 'expected at least one tts_playback_timing event').toBeGreaterThan(0);

        // Sanity-check the event payload shape (Phase A fields)
        const ev = ttsEvents[0];
        expect(ev.payload.first_chunk).toBeTruthy();
        expect(typeof ev.payload.snap_forward_count).toBe('number');
        expect(typeof ev.payload.total_chunks).toBe('number');
        expect(['stream', 'external_stream']).toContain(ev.payload.path);

        await captureSession(workflowPage, 'voice_pipeline_chat');
    });

    test('event trace panel surfaces audio events live', async ({ workflowPage }) => {
        test.setTimeout(120_000);
        await workflowPage.goto('http://localhost:3000/sail', { waitUntil: 'networkidle' });
        await workflowPage.waitForFunction(
            () => (window as any).__smartchats__?.simi?.workflows?.basic_chat_flow,
            { timeout: 30_000 },
        );

        // Initially the panel either shows "no events yet" or a small count.
        // After running the workflow it should pick up at least one tts_playback_timing.
        await workflowPage.evaluate(
            () => (window as any).__smartchats__.simi.workflows.basic_chat_flow()
        );

        // Panel polls at 4Hz (250ms); give it 1s to catch up to the freshly
        // flushed event batch.
        await workflowPage.waitForTimeout(1000);

        // At least one tts_playback_timing row should be visible in the panel.
        // The panel renders the event_type as a colored span; locator
        // matches even when summaries differ.
        await expect(
            workflowPage.locator('text=/tts_playback_timing/').first()
        ).toBeVisible();
    });
});
