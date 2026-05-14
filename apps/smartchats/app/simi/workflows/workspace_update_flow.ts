import { defineWorkflow } from 'simi';

export const workspaceUpdateFlow = defineWorkflow({
  id: 'workspace_update_flow',
  app: 'smartchats',
  tags: ['e2e', 'workspace'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Reset to GPT for speed/consistency (model_switch_flow may leave Opus active)
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'clearChat', args: [], wait: 500 },

    // Ask agent to update the workspace
    { action: 'sendMessageAsync', args: ['Store the following in the workspace: key "test_value" with value 42, and key "test_name" with value "simi"'], timeout: 60000, wait: 500 },

    // Wait for workspace to be populated
    { waitFor: 'Object.keys(state.workspace).length > 0', timeout: 15000 },

    // Assert workspace was updated
    { assert: 'state.workspace !== null && typeof state.workspace === "object"', message: 'Workspace should be a non-null object' },
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should have responded' },
  ],
});
