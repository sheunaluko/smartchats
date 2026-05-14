import { defineWorkflow } from 'simi';

export const appLifecycleFlow = defineWorkflow({
  id: 'app_lifecycle_flow',
  app: 'smartchats',
  tags: ['e2e', 'app_platform'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // ── Setup ──
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'clearChat', args: [], wait: 500 },

    // ── Step 1: Trigger first LLM turn to run prefetch + seeding ──
    { action: 'sendMessageAsync', args: ['Hello'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },

    // ── Step 2: Verify built-in app was seeded ──
    { waitFor: 'state.installedApps.length > 0', timeout: 20000 },
    { assert: 'state.installedApps.some(i => i.app_id === "counter")', message: 'Counter app should be installed via seeding' },
    { assert: 'state.appManifestCache["counter"] !== undefined', message: 'Counter manifest should be cached' },
    { assert: 'state.activeApp === null', message: 'No app should be active initially' },

    // ── Step 3: Activate the counter app via agent ──
    { action: 'sendMessageAsync', args: ['Activate the counter app'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp !== null', timeout: 15000 },
    { assert: 'state.activeAppId === "counter"', message: 'Counter app should be active' },
    { assert: 'state.activeApp.name === "Counter"', message: 'Active app name should be Counter' },

    // ── Step 4: Ask agent to increment (also verifies workspace state works) ──
    { action: 'sendMessageAsync', args: ['Increment the counter 3 times'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },
    { waitFor: 'state.workspace["counter.count"] >= 1', timeout: 10000 },

    // ── Step 6: Ask agent to set a specific value ──
    { action: 'sendMessageAsync', args: ['Set the counter to 42'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },
    { assert: 'state.workspace["counter.count"] === 42', message: 'Counter should be 42' },

    // ── Step 7: Deactivate ──
    { action: 'sendMessageAsync', args: ['Deactivate the app'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp === null', timeout: 15000 },
    { assert: 'state.activeAppId === null', message: 'No app should be active after deactivation' },

    // ── Step 8: Re-activate and verify state persisted ──
    { action: 'sendMessageAsync', args: ['Open the counter app again'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp !== null', timeout: 15000 },
    { assert: 'state.activeAppId === "counter"', message: 'Counter should be re-activated' },
    { waitFor: 'state.workspace["counter.count"] === 42', timeout: 10000 },

    // ── Step 9: Deactivate to clean up ──
    { action: 'sendMessageAsync', args: ['Close the app'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp === null', timeout: 15000 },
  ],
});
