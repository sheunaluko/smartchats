import { defineWorkflow } from 'simi';

export const canarySweepFlow = defineWorkflow({
  id: 'canary_sweep_flow',
  app: 'smartchats',
  tags: ['e2e', 'canary', 'app_platform'],
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

    // ── Step 2: Verify canary app was seeded ──
    { waitFor: 'state.installedApps.length > 0', timeout: 20000 },
    { assert: 'state.installedApps.some(i => i.app_id === "canary")', message: 'Canary app should be installed via seeding' },
    { assert: 'state.appManifestCache["canary"] !== undefined', message: 'Canary manifest should be cached' },

    // ── Step 3: Activate canary ──
    { action: 'sendMessageAsync', args: ['Activate the canary app'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp !== null', timeout: 15000 },
    { assert: 'state.activeAppId === "canary"', message: 'Canary app should be active' },

    // ── Step 4: Run all test suites ──
    { action: 'sendMessageAsync', args: ['Run all canary test suites'], timeout: 120000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 60000 },
    { waitFor: 'state.workspace["canary.health"] !== undefined', timeout: 15000 },
    { assert: 'state.workspace["canary.health"] === "healthy"', message: 'All canary suites should pass (health should be healthy)' },

    // ── Step 5: Run orchestration test (agent chains echo calls) ──
    { action: 'sendMessageAsync', args: ['Run the canary orchestration test: chain 3 echo calls passing return values, then report with canary_run_suite orchestration_report'], timeout: 120000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 60000 },

    // ── Step 6: Deactivate ──
    { action: 'sendMessageAsync', args: ['Deactivate the app'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp === null', timeout: 15000 },
    { assert: 'state.activeAppId === null', message: 'No app should be active after deactivation' },

    // ── Step 7: Re-activate and verify state persisted ──
    { action: 'sendMessageAsync', args: ['Open the canary app again'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp !== null', timeout: 15000 },
    { assert: 'state.activeAppId === "canary"', message: 'Canary should be re-activated' },
    // Verify stats survived deactivate/reactivate (persisted via workspace → app_state → restore)
    { waitFor: 'state.workspace["canary.call_count"] > 0', timeout: 10000 },
    { assert: 'state.workspace["canary.call_count"] > 0', message: 'call_count should persist across deactivate/reactivate' },

    // ── Step 8: Clean up ──
    { action: 'sendMessageAsync', args: ['Close the app'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp === null', timeout: 15000 },
  ],
});
