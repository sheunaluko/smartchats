import { chromium, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { test } from '@playwright/test';

const USER_DATA_DIR = path.join(__dirname, '../../.auth/chrome-profile');

async function captureSession(page: any, testName: string) {
  try {
    const sessionData = await page.evaluate(() => {
      const insights = (window as any).cortexInsights || (window as any).smartchatsInsights;
      return insights?.exportSession?.() || null;
    });
    if (sessionData) {
      const p = path.join(__dirname, '../../test-results', `session_${testName}_${Date.now()}.json`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(sessionData, null, 2));
      console.log(`Session captured: ${p}`);
    }
  } catch (e) {
    console.warn('Failed to capture session:', e);
  }
}

/**
 * Agent Delegation E2E — exercises ProcessManager agent mode via Simi flow.
 *
 * Uses a persistent Chrome profile (.auth/chrome-profile) for Firebase auth.
 * First run: `npx ts-node tests/e2e/auth.setup.ts` to create the profile.
 */

interface RunResult {
  completed: boolean;
  workflow_id: string;
  total_ms: number;
  steps: Array<{
    step: string;
    result?: any;
    duration_ms: number;
    status: 'ok' | 'error';
    error?: string;
  }>;
  error?: string;
}

test.describe('Agent Delegation', () => {
  test('fork_process agent mode completes successfully', async () => {
    test.setTimeout(180_000);

    // Ensure auth profile exists
    if (!fs.existsSync(path.join(USER_DATA_DIR, 'Default'))) {
      throw new Error('No auth profile. Run: npx ts-node tests/e2e/auth.setup.ts --headed');
    }

    // Launch with persistent context to get Firebase IndexedDB auth
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    try {
      await page.goto('http://localhost:3000');

      // Wait for the Simi bridge to be available
      await page.waitForFunction(
        () => (window as any).__smartchats__?.simi?.workflows?.agent_delegation_flow,
        { timeout: 30_000 },
      );

      // Run the Simi workflow
      const result: RunResult = await page.evaluate(() => {
        return (window as any).__smartchats__.simi.workflows.agent_delegation_flow();
      });

      // Log step details for debugging
      for (const step of result.steps) {
        console.log(`  [${step.status}] ${step.step} (${step.duration_ms}ms)${step.error ? ' — ' + step.error : ''}`);
      }

      // Assert workflow completed
      expect(result.completed, `Workflow failed: ${result.error || result.steps.find(s => s.status === 'error')?.error}`).toBe(true);

      // Verify final store state
      const state = await page.evaluate(() => {
        const s = (window as any).__smartchats__.getState();
        return {
          processCount: s.processes.length,
          firstProcess: s.processes[0] ? {
            mode: s.processes[0].mode,
            status: s.processes[0].status,
            exitCode: s.processes[0].exitCode,
            stdoutLines: s.processes[0].stdoutLines,
            name: s.processes[0].name,
          } : null,
        };
      });

      expect(state.processCount).toBeGreaterThan(0);
      expect(state.firstProcess).not.toBeNull();
      expect(state.firstProcess!.mode).toBe('agent');
      expect(state.firstProcess!.status).toBe('completed');
      expect(state.firstProcess!.exitCode).toBe(0);
      expect(state.firstProcess!.stdoutLines).toBeGreaterThan(0);

      await captureSession(page, 'agent_delegation');
    } catch (err) {
      await captureSession(page, 'agent_delegation_FAIL');

      // Pause to see the error state, then screenshot
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'test-results/debug-screenshot.png', fullPage: true });

      // Dump process state for debugging
      const debugState = await page.evaluate(() => {
        const s = (window as any).__smartchats__?.getState();
        return {
          processes: s?.processes,
          lastAiMessage: s?.lastAiMessage,
          chatHistory: s?.chatHistory?.slice(-3),
        };
      }).catch(() => null);
      console.log('Debug state:', JSON.stringify(debugState, null, 2));

      throw err;
    } finally {
      await context.close();
    }
  });
});
