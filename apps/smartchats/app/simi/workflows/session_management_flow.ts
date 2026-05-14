import { defineWorkflow } from 'simi';

export const sessionManagementFlow = defineWorkflow({
  id: 'session_management_flow',
  app: 'smartchats',
  tags: ['e2e', 'session'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Wait for store + agent initialization
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },

    // Send message "Alpha" — auto-saves on turn_complete
    { action: 'sendMessageAsync', args: ['Remember: the codeword is Alpha'], timeout: 30000, wait: 500 },
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should respond to Alpha message' },

    // Manually save to ensure persistence
    { action: 'saveSession', args: [], timeout: 15000, wait: 1000 },

    // Clear chat (saves current, resets session ID), send "Beta"
    { action: 'clearChat', args: [], wait: 500 },
    { action: 'sendMessageAsync', args: ['Remember: the codeword is Beta'], timeout: 30000, wait: 500 },
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should respond to Beta message' },

    // Save the Beta session
    { action: 'saveSession', args: [], timeout: 15000, wait: 1000 },

    // List sessions — both Alpha and Beta should exist
    { id: 'list', action: 'listSessions', args: [], timeout: 15000, wait: 500 },
    { assert: 'results.list.length >= 2', message: 'Should have at least 2 sessions' },

    // Clear and load the Alpha session (second in list since list is ordered by updated_at DESC)
    { action: 'clearChat', args: [], wait: 300 },
    { action: 'loadSession', args: [{ $resolve: 'result', step: 'list', path: '1.id' }], timeout: 15000, wait: 500 },

    // Verify Alpha session content was restored
    { assert: 'state.chatHistory.length >= 2', message: 'Alpha session should be restored' },
    { assert: 'state.chatHistory.some(m => m.role === "user" && m.content.includes("Alpha"))', message: 'Should contain Alpha message' },
  ],
});
