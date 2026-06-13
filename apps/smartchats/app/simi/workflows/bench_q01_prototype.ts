/**
 * Benchpress prototype — one scenario (q01_weight_lookup), one model
 * (claude-sonnet-4-6), one path validated end-to-end.
 *
 * Requires `window.__BENCHPRESS_MODE = true` set BEFORE the page boots
 * (via Playwright `addInitScript`). Otherwise the `submit_answer` tool
 * isn't registered and `state.workspace.bench_answer` never appears.
 *
 * Generalized into a per-scenario factory in Task #8.
 */
import { defineWorkflow } from 'simi';

export const benchQ01PrototypeFlow = defineWorkflow({
  id: 'bench_q01_prototype',
  app: 'smartchats',
  tags: ['benchpress', 'prototype'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Wait for store + agent ready.
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },

    // Pin model. Sonnet 4.6 — fast + smart middle tier.
    { action: 'updateSettings', args: [{ aiModel: 'claude-sonnet-4-6' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },

    // Clean transcript.
    { action: 'clearChat', args: [], wait: 500 },

    // q01 prompt.
    {
      action: 'sendMessageAsync',
      args: ['What was my weight on 2026-03-15?'],
      timeout: 90000,
      wait: 500,
    },

    // The agent calls submit_answer → workspace.bench_answer is populated.
    // This is the cross-process signal that the turn produced a definitive answer.
    { waitFor: 'state.workspace.bench_answer != null', timeout: 60000 },

    // Soft structural asserts only — exact-value scoring runs post-hoc against
    // the exported session bundle. These fail loudly if the agent shipped a
    // bench_answer with the wrong shape (e.g. forgot kind, returned a string).
    {
      assert: 'state.workspace.bench_answer.kind === "scalar"',
      message: 'q01 expects kind=scalar',
    },
    {
      assert: 'typeof state.workspace.bench_answer.value === "number"',
      message: 'q01 expects a numeric value',
    },
  ],
});
