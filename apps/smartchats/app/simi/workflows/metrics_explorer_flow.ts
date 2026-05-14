import { defineWorkflow } from 'simi';

export const metricsExplorerFlow = defineWorkflow({
  id: 'metrics_explorer_flow',
  app: 'smartchats',
  tags: ['e2e', 'app_platform', 'metrics'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // ── Setup ──
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'clearChat', args: [], wait: 500 },

    // ── Step 1: Trigger seeding ──
    { action: 'sendMessageAsync', args: ['Hello'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },

    // ── Step 2: Create test metric data before activating ──
    { action: 'sendMessageAsync', args: ['Save a metric with name "__simi_test_metric" value 42 unit "test" and category "simi"'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },

    // ── Step 3: Activate metrics explorer ──
    { action: 'sendMessageAsync', args: ['Open the metrics explorer'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeAppId === "metrics_explorer"', timeout: 15000 },

    // ── Step 4: Verify on_activate loaded metrics (filter_recency written to workspace) ──
    { waitFor: 'state.workspace["metrics_explorer.filter_recency"] !== undefined', timeout: 10000 },

    // ── Step 5: View the test metric ──
    { action: 'sendMessageAsync', args: ['View the __simi_test_metric metric'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },

    // ── Step 6: Log a new entry through the app ──
    { action: 'sendMessageAsync', args: ['Log a new entry for __simi_test_metric with value 99'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },

    // ── Step 7: Deactivate ──
    { action: 'sendMessageAsync', args: ['Close the app'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp === null', timeout: 15000 },

    // ── Step 8: Re-activate — verify filter prefs persisted ──
    { action: 'sendMessageAsync', args: ['Open metrics explorer again'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeAppId === "metrics_explorer"', timeout: 15000 },
    { waitFor: 'state.workspace["metrics_explorer.filter_recency"] !== undefined', timeout: 10000 },

    // ── Step 9: Clean up ──
    { action: 'sendMessageAsync', args: ['Close the app'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp === null', timeout: 15000 },
  ],
});
