import { defineWorkflow } from 'simi';

export const clearAndResumeFlow = defineWorkflow({
  id: 'clear_and_resume_flow',
  app: 'smartchats',
  tags: ['smoke', 'chat'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Reset to GPT for speed/consistency (model_switch_flow may leave Opus active)
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'clearChat', args: [], wait: 500 },

    // Send a message
    { action: 'sendMessageAsync', args: ['Hello, can you count to 3?'], timeout: 60000, wait: 500 },
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should have responded' },
    { assert: 'state.chatHistory.length >= 2', message: 'Should have user + assistant' },

    // Clear chat
    { action: 'clearChat', args: [], wait: 500 },

    // Assert chatHistory fully emptied
    { assert: 'state.chatHistory.length === 0', message: 'chatHistory should be empty after clear' },
    { assert: 'state.lastAiMessage === ""', message: 'lastAiMessage should be empty' },

    // Send a new message — AI should respond fresh
    { action: 'sendMessageAsync', args: ['What is the capital of France?'], timeout: 60000, wait: 500 },
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should respond after clear' },
    { assert: 'state.chatHistory.length === 2', message: 'Should have user + assistant after fresh message' },
  ],
});
