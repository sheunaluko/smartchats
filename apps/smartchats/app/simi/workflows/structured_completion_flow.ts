import { defineWorkflow } from 'simi';

/**
 * Regression test for cortex.run_structured_completion.
 *
 * Uses find_scripture_for_time (which calls run_structured_completion
 * internally with a Zod schema) and asks the agent to stash the raw tool
 * result in workspace. We then assert the result indicates a real
 * extraction occurred — i.e. NOT the hardcoded fallback.
 *
 * Why this catches the regression class: when run_structured_completion
 * is broken (e.g. text_format not reaching the server, OpenAI returns
 * prose, JSON.parse throws), the scripture tool's try/catch returns
 * confidence:'none' on every pass and falls to the hardcoded Proverbs
 * 3:5 with fallback_used:'hardcoded'. This flow fails in that state.
 */
export const structuredCompletionFlow = defineWorkflow({
  id: 'structured_completion_flow',
  app: 'smartchats',
  tags: ['e2e', 'structured_completion', 'regression'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'clearChat', args: [], wait: 500 },

    {
      action: 'sendMessageAsync',
      args: [
        'Call find_scripture_for_time and store the entire result object in workspace under the key "scripture_probe". Do not modify the result — store it exactly as returned.',
      ],
      timeout: 90000,
      wait: 500,
    },
    { waitFor: '!state.llmRunning', timeout: 60000 },

    // Tool was called and succeeded
    {
      waitFor: 'state.functionCalls.some(c => c.name === "find_scripture_for_time" && c.status === "success")',
      timeout: 5000,
    },

    // Workspace has the result the agent stashed
    { waitFor: 'state.workspace.scripture_probe !== undefined', timeout: 10000 },

    // The structured-completion extraction actually produced a verse —
    // not the hardcoded fallback.
    {
      assert: 'state.workspace.scripture_probe.fallback_used !== "hardcoded"',
      message: 'fallback_used should NOT be "hardcoded" — that indicates structured completion failed and we fell through both extraction passes',
    },
    {
      assert: '["high","low"].includes(state.workspace.scripture_probe.confidence)',
      message: 'confidence should be "high" or "low", not "none" — "none" means the structured-completion extractor returned nothing or threw',
    },
    {
      assert: 'typeof state.workspace.scripture_probe.verse_text === "string" && state.workspace.scripture_probe.verse_text.length > 0',
      message: 'verse_text should be a non-empty string when extraction succeeded',
    },
  ],
});
