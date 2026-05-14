import { defineWorkflow } from 'simi';

export const fullConversationFlow = defineWorkflow({
  id: 'full_conversation_flow',
  app: 'smartchats',
  tags: ['e2e', 'chat', 'session'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Wait for store + agent to be initialized
    { waitFor: 'state.aiModel !== "" && state.agent !== null', timeout: 10000 },
    // First message (full cycle — awaits LLM response)
    { action: 'sendMessageAsync', args: ['Hello, what can you help me with?'], timeout: 30000, wait: 500 },
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should have responded to first message' },
    // Second message (multi-turn)
    { action: 'sendMessageAsync', args: ['Can you show me a simple JavaScript function?'], timeout: 30000, wait: 500 },
    { assert: 'state.chatHistory.length > 4', message: 'Should have at least 5 messages (system + 2 user + 2 assistant)' },
    // Save session (auto-save handles this on turn_complete, but explicit save ensures persistence)
    { action: 'saveSession', args: [], timeout: 15000, wait: 500 },
    // List sessions to verify save
    { action: 'listSessions', args: [], timeout: 15000, wait: 500 },
  ],
});
