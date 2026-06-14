/**
 * Benchpress prototype — one scenario (q01_weight_lookup), one model
 * (claude-sonnet-4-6), one path validated end-to-end.
 *
 * Post-2026-06-14 refactor: the directive ("set workspace.bench_answer =
 * {...}") is inline in the user message, not a system-prompt module. SCM
 * is identical to production. The agent writes to workspace from its
 * sandboxed code; cortex syncs back via the workspace_update event.
 */
import { defineWorkflow } from 'simi';

const Q01_PROMPT_WITH_DIRECTIVE =
  `What was my weight on 2026-03-15?` +
  ` After computing the answer, set workspace.bench_answer = { value: <your_answer>, kind: 'scalar', unit: 'lbs' }.` +
  ` Then briefly reply.`;

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

    // Clean transcript + clear any prior bench_answer.
    { action: 'clearChat', args: [], wait: 500 },
    { action: 'updateWorkspace', args: [{ bench_answer: null }], wait: 200 },

    // q01 prompt with inline directive.
    {
      action: 'sendMessageAsync',
      args: [Q01_PROMPT_WITH_DIRECTIVE],
      timeout: 60_000,
      wait: 500,
    },

    // The agent writes workspace.bench_answer from its sandboxed code → cortex
    // emits workspace_update → store reflects it → simi sees it.
    { waitFor: 'state.workspace.bench_answer != null', timeout: 10_000 },

    // Lenient sanity — accept either a bare numeric or a {value: number} wrapper.
    {
      assert: 'typeof state.workspace.bench_answer === "number" || ' +
              'typeof state.workspace.bench_answer.value === "number"',
      message: 'q01 expects a numeric answer (bare or wrapped)',
    },
  ],
});
