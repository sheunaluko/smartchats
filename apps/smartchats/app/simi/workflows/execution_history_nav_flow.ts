import { defineWorkflow } from 'simi';

export const executionHistoryNavFlow = defineWorkflow({
  id: 'execution_history_nav_flow',
  app: 'smartchats',
  tags: ['e2e', 'code', 'execution'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Wait for store + agent initialization
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },

    // Ask AI to run code that sets a variable
    { action: 'sendMessageAsync', args: ['Write and execute JavaScript code: let x = 42; x;'], timeout: 60000, wait: 500 },

    // Wait for first execution to complete
    { waitFor: 'state.executionHistory.length >= 1', timeout: 30000 },
    { assert: 'state.executionHistory.length >= 1', message: 'First execution should be captured' },

    // Ask for a second code execution
    { action: 'sendMessageAsync', args: ['Now write and execute JavaScript code: let y = 100; y;'], timeout: 60000, wait: 500 },

    // Wait for second execution to complete
    { waitFor: 'state.executionHistory.length >= 2', timeout: 30000 },
    { assert: 'state.executionHistory.length >= 2', message: 'Second execution should be captured' },

    // Click history item 0 (first execution)
    { action: 'handleHistoryItemClick', args: [0], wait: 300 },
    { assert: 'state.selectedIndex === 0', message: 'Selected index should be 0 after clicking first history item' },

    // Verify the first execution snapshot is accessible
    { assert: 'state.executionHistory[0].code.length > 0', message: 'First execution should have code' },
    { assert: 'state.executionHistory[0].status === "success" || state.executionHistory[0].status === "error"', message: 'First execution should have a terminal status' },
  ],
});
