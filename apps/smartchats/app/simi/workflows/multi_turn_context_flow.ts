import { defineWorkflow } from 'simi';

export const multiTurnContextFlow = defineWorkflow({
  id: 'multi_turn_context_flow',
  app: 'smartchats',
  tags: ['e2e', 'chat', 'context'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Reset to GPT for speed/consistency (model_switch_flow may leave Opus active)
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'clearChat', args: [], wait: 500 },

    // Establish a fact
    { action: 'sendMessageAsync', args: ['My favorite programming language is Haskell. Just acknowledge this.'], timeout: 60000, wait: 500 },
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should have acknowledged' },

    // Verify context retention
    { action: 'sendMessageAsync', args: ['What is my favorite programming language?'], timeout: 60000, wait: 500 },
    { assert: 'state.lastAiMessage.toLowerCase().includes("haskell")', message: 'AI should recall Haskell' },

    // Update the fact
    { action: 'sendMessageAsync', args: ['Now change it — my favorite language is Rust. Acknowledge this.'], timeout: 60000, wait: 500 },
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should have acknowledged the change' },

    // Verify updated context
    { action: 'sendMessageAsync', args: ['What is my favorite language now?'], timeout: 60000, wait: 500 },
    { assert: 'state.lastAiMessage.toLowerCase().includes("rust")', message: 'AI should recall Rust' },
  ],
});
