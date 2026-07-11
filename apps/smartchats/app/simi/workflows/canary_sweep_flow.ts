import { defineWorkflow } from 'simi';

/**
 * Canary Sweep — zero-LLM platform-integration test.
 *
 * The Canary app (apps/canary/index.ts) exists to validate every layer of
 * the app platform: bridge/RPC, state, permissions, three data layers
 * (metrics/logs/KG), DOM+theme, and serialization. Its `canary_run_suite`
 * function walks all 8 internal suites and reports a single health verdict
 * via `state.workspace["canary.health"]`.
 *
 * Historical shape: this flow used `sendMessageAsync` to prompt the LLM to
 * activate the app, run the suites, and orchestrate multi-call chaining.
 * That coupled two orthogonal things — platform health (real intent) and
 * LLM tool-picker reliability — so the test failed whenever any given
 * model happened to invoke a wrong function (grok non-reasoning fired
 * probe calls instead of `run_suite`; gpt-5.2's stream would occasionally
 * hang mid-response). Neither failure told us anything about the platform.
 *
 * Reshaped to `callFunction` invocations — the platform assertion is now
 * direct and deterministic, no LLM cost, no model-selection sensitivity.
 * The orchestration-chain-of-tool-calls check was dropped; that's an LLM
 * behavior gate and belongs in its own flow if we want to keep it.
 */
export const canarySweepFlow = defineWorkflow({
  id: 'canary_sweep_flow',
  app: 'smartchats',
  tags: ['e2e', 'canary', 'app_platform', 'auto'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // ── Setup: seed apps + assert canary is present ──
    { waitFor: 'state.agent !== null', timeout: 15000 },
    { action: 'seedAndLoadApps', args: [], timeout: 30000 },
    { waitFor: 'state.installedApps.length > 0', timeout: 10000 },
    { assert: 'state.installedApps.some(i => i.app_id === "canary")', message: 'Canary app should be installed via seeding' },
    { assert: 'state.appManifestCache["canary"] !== undefined', message: 'Canary manifest should be cached' },

    // ── Activate canary directly (no LLM) ──
    { action: 'callFunction', args: ['activate_app', { app_id: 'canary' }], id: 'activate', timeout: 15000, wait: 1000 },
    { assert: 'state.activeAppId === "canary"', message: 'Canary app should be active' },

    // ── Wait for on_activate to hydrate workspace ──
    { waitFor: 'state.workspace["canary.health"] !== undefined', timeout: 10000 },

    // ── Run all 8 internal suites (bridge / state / permissions /
    //     data_metrics / data_logs / data_kg / dom_theme / serialization)
    //     via direct call. Sole platform-health verdict. ──
    { action: 'callFunction', args: ['canary_run_suite', { suite: 'all' }], id: 'run_all', timeout: 60000, wait: 500 },
    { waitFor: 'state.workspace["canary.health"] === "healthy"', timeout: 15000 },
    { assert: 'state.workspace["canary.health"] === "healthy"', message: 'All canary suites should pass (health should be healthy)' },
    { assert: 'Object.keys(state.workspace["canary.suite_results"] || {}).length >= 8', message: 'All 8 canary suites should have reported' },

    // ── Deactivate directly ──
    { action: 'callFunction', args: ['deactivate_app', {}], id: 'deactivate', timeout: 10000, wait: 500 },
    { waitFor: 'state.activeApp === null', timeout: 10000 },
    { assert: 'state.activeAppId === null', message: 'No app should be active after deactivation' },

    // ── Re-activate + verify persisted state survived ──
    { action: 'callFunction', args: ['activate_app', { app_id: 'canary' }], id: 'reactivate', timeout: 15000, wait: 1000 },
    { assert: 'state.activeAppId === "canary"', message: 'Canary should be re-activated' },
    { waitFor: 'state.workspace["canary.call_count"] > 0', timeout: 10000 },
    { assert: 'state.workspace["canary.call_count"] > 0', message: 'call_count should persist across deactivate/reactivate' },

    // ── Clean up ──
    { action: 'callFunction', args: ['deactivate_app', {}], timeout: 10000, wait: 500 },
    { waitFor: 'state.activeApp === null', timeout: 10000 },
  ],
});
