import { defineWorkflow } from 'simi';

export const htmlDisplayFlow = defineWorkflow({
  id: 'html_display_flow',
  app: 'smartchats',
  tags: ['e2e', 'html'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Reset to GPT for speed/consistency (model_switch_flow may leave Opus active)
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'clearChat', args: [], wait: 500 },

    // Ask agent to render HTML
    { action: 'sendMessageAsync', args: ['Display an HTML page with a blue heading that says "Simi Test" using display_html'], timeout: 60000, wait: 500 },

    // Wait for HTML to appear
    { waitFor: 'state.htmlDisplay.length > 0', timeout: 15000 },

    // Assert HTML was rendered
    { assert: 'state.htmlDisplay.includes("Simi Test") || state.htmlDisplay.length > 50', message: 'HTML should contain test content or be substantial' },
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should have responded' },
  ],
});
