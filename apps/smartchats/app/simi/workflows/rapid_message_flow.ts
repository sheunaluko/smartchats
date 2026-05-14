import { defineWorkflow } from 'simi';

export const rapidMessageFlow = defineWorkflow({
  id: 'rapid_message_flow',
  app: 'smartchats',
  tags: ['e2e', 'chat', 'stress'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Wait for store + agent initialization
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },

    // Send 3 messages in quick succession
    { action: 'sendMessageAsync', args: ['Quick message 1: What is 1+1?'], timeout: 60000, wait: 200 },
    { action: 'sendMessageAsync', args: ['Quick message 2: What is 2+2?'], timeout: 60000, wait: 200 },
    { action: 'sendMessageAsync', args: ['Quick message 3: What is 3+3?'], timeout: 60000, wait: 200 },

    // Wait for all messages to resolve
    { waitFor: '!state.llmRunning', timeout: 90000 },

    // Assert chat history has all user+assistant message pairs
    // System prompt (1) + 3 user messages + at least 3 assistant messages = at least 7
    { assert: 'state.chatHistory.filter(m => m.role === "user").length >= 3', message: 'Should have at least 3 user messages' },
    { assert: 'state.chatHistory.filter(m => m.role === "assistant").length >= 1', message: 'Should have at least 1 assistant response' },
    { assert: 'state.lastAiMessage.length > 0', message: 'Last AI message should not be empty' },
  ],
});
