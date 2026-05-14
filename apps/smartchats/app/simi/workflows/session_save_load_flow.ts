import { defineWorkflow } from 'simi';

export const sessionSaveLoadFlow = defineWorkflow({
  id: 'session_save_load_flow',
  app: 'smartchats',
  tags: ['e2e', 'session', 'persistence'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Reset to GPT for speed/consistency
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },

    // Clear chat to start a fresh session
    { action: 'clearChat', args: [], wait: 500 },

    // Send a message — auto-saves to SurrealDB on turn_complete
    { action: 'sendMessageAsync', args: ['The answer is forty-two'], timeout: 60000, wait: 500 },
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should have responded' },

    // Manually save to ensure persistence before clear
    { action: 'saveSession', args: [], timeout: 15000, wait: 1000 },

    // Clear chat — resets session ID, starts fresh
    { action: 'clearChat', args: [], wait: 500 },
    { assert: 'state.chatHistory.length === 0', message: 'Chat should be empty after clear' },
    { assert: 'state.lastAiMessage === ""', message: 'lastAiMessage should be empty after clear' },

    // List sessions — capture result to grab the session ID
    { id: 'list', action: 'listSessions', args: [], timeout: 15000, wait: 500 },
    { assert: 'results.list.length > 0', message: 'Should have at least one saved session' },

    // Load the most recent session using its ID from the list result
    { action: 'loadSession', args: [{ $resolve: 'result', step: 'list', path: '0.id' }], timeout: 15000, wait: 500 },

    // Verify chat was restored (user + assistant = 2+)
    { assert: 'state.chatHistory.length >= 2', message: 'Chat should be restored (user + assistant)' },
    { assert: 'state.chatHistory.some(m => m.role === "assistant" && m.content.length > 0)', message: 'Restored chat should contain an assistant message' },
  ],
});
