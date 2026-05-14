import { defineWorkflow } from 'simi';

export const storageModeSwitchFlow = defineWorkflow({
  id: 'storage_mode_switch_flow',
  app: 'smartchats',
  tags: ['e2e', 'storage', 'persistence'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Wait for store + agent initialization
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },

    // Start in local mode
    { action: 'switchStorageMode', args: ['local'], timeout: 15000, wait: 500 },

    // Wait for agent to re-settle after mode switch
    { waitFor: 'state.agent !== null && !state.llmRunning', timeout: 15000 },

    // Send a message in local mode
    { action: 'sendMessageAsync', args: ['Storage test: the magic word is "Chrysanthemum"'], timeout: 30000, wait: 500 },
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should have responded in local mode' },

    // Save the conversation
    { action: 'saveConversation', args: [], timeout: 10000, wait: 500 },

    // Clear and verify clean slate
    { action: 'clearChat', args: [], wait: 300 },
    { assert: 'state.chatHistory.length === 0', message: 'Chat should be cleared' },

    // Reload from local storage — data should survive
    { action: 'loadConversation', args: [], timeout: 10000, wait: 500 },
    { assert: 'state.chatHistory.length >= 2', message: 'Conversation should be restored from local storage' },
    { assert: 'state.chatHistory.some(m => m.content.includes("Chrysanthemum"))', message: 'Restored chat should contain the magic word' },
  ],
});
