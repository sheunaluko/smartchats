import { defineWorkflow } from 'simi';

export const scriptureTimeFlow = defineWorkflow({
  id: 'scripture_time_flow',
  app: 'smartchats',
  tags: ['e2e', 'scripture', 'web_search'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Setup — pin to GPT for speed + clear chat
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'clearChat', args: [], wait: 500 },

    // Ask for a scripture for the current time + a log reflection — the
    // canonical recipe documented in modules/scripture.ts system_msg.
    {
      action: 'sendMessageAsync',
      args: ['Give me a scripture for the current time and reflect on how it relates to my recent logs.'],
      timeout: 120000,
      wait: 500,
    },
    { waitFor: '!state.llmRunning', timeout: 90000 },

    // Tool was invoked and completed
    {
      waitFor: 'state.functionCalls.some(c => c.name === "find_scripture_for_time" && c.status === "success")',
      timeout: 5000,
    },
    {
      assert: 'state.functionCalls.some(c => c.name === "find_scripture_for_time" && c.status === "success")',
      message: 'find_scripture_for_time should have been called and succeeded',
    },

    // Agent produced a reflection message
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should have produced a reflection' },
  ],
});
