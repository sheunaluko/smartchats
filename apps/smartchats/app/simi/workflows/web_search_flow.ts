import { defineWorkflow } from 'simi';

export const webSearchFlow = defineWorkflow({
  id: 'web_search_flow',
  app: 'smartchats',
  tags: ['e2e', 'web_search', 'smoke'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'clearChat', args: [], wait: 500 },

    // A query Google will reliably surface organic results for.
    {
      action: 'sendMessageAsync',
      args: ['Use web_search to look up the current capital of France, then tell me what city it is.'],
      timeout: 90000,
      wait: 500,
    },
    { waitFor: '!state.llmRunning', timeout: 60000 },

    {
      waitFor: 'state.functionCalls.some(c => c.name === "web_search" && c.status === "success")',
      timeout: 5000,
    },
    {
      assert: 'state.functionCalls.some(c => c.name === "web_search" && c.status === "success")',
      message: 'web_search should have been called and returned successfully',
    },
    {
      assert: '/paris/i.test(state.lastAiMessage)',
      message: 'AI response should mention Paris (web_search returned valid organic results)',
    },
  ],
});
