import { defineWorkflow } from 'simi';

export const logExplorerFlow = defineWorkflow({
  id: 'log_explorer_flow',
  app: 'smartchats',
  tags: ['e2e', 'app_platform', 'logs'],
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

    // ── Step 2: Create test data BEFORE activating the app (user says something that gets logged) ──
    { action: 'sendMessageAsync', args: ['Save a log with text "Log explorer simi test entry" and category "simi_test"'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },

    // ── Step 3: Activate — on_activate should auto-load categories + logs ──
    { action: 'sendMessageAsync', args: ['Open the log explorer'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeAppId === "log_explorer"', timeout: 15000 },

    // ── Step 4: Verify on_activate populated data (workspace should have filter_recency from load_logs) ──
    { waitFor: 'state.workspace["log_explorer.filter_recency"] !== undefined', timeout: 10000 },

    // ── Step 5: User asks to search — natural voice-like interaction ──
    { action: 'sendMessageAsync', args: ['Search for "simi test"'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },

    // ── Step 6: User asks to create a new log through the app ──
    { action: 'sendMessageAsync', args: ['Create a new log entry saying "Another test from simi flow" in category "simi_test"'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },

    // ── Step 7: User asks to edit the log they just created ──
    { action: 'sendMessageAsync', args: ['Edit that log entry to say "Edited test from simi flow"'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },

    // ── Step 8: Deactivate ──
    { action: 'sendMessageAsync', args: ['Close the app'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp === null', timeout: 15000 },

    // ── Step 9: Re-activate — verify filter prefs persisted ──
    { action: 'sendMessageAsync', args: ['Open log explorer again'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeAppId === "log_explorer"', timeout: 15000 },
    { waitFor: 'state.workspace["log_explorer.filter_recency"] !== undefined', timeout: 10000 },

    // ── Step 10: Clean up ──
    { action: 'sendMessageAsync', args: ['Close the app'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp === null', timeout: 15000 },
  ],
});
