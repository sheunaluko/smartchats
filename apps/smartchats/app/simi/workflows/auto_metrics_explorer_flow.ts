import { defineWorkflow } from 'simi';

/**
 * Auto Metrics Explorer — zero-LLM test flow.
 * Uses callFunction + seedAndLoadApps for direct invocation.
 * Tests: seeding, activation, on_activate, DOM rendering, refresh, entry form.
 */
export const autoMetricsExplorerFlow = defineWorkflow({
  id: 'auto_metrics_explorer_flow',
  app: 'smartchats',
  tags: ['e2e', 'app_platform', 'metrics', 'auto'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // ── Setup: seed apps + test data ──
    { waitFor: 'state.agent !== null', timeout: 15000 },
    { action: 'seedAndLoadApps', args: [], timeout: 30000 },
    { waitFor: 'state.installedApps.length > 0', timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: '__simi_auto_test', value: 42, unit: 'test', metric_type: 'numeric', category: 'simi' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: '__simi_auto_habit', value: 1, unit: 'done', metric_type: 'boolean', category: 'simi' }], timeout: 5000 },

    // ── Activate ──
    { action: 'callFunction', args: ['activate_app', { app_id: 'metrics_explorer' }], id: 'activate', timeout: 15000, wait: 1000 },
    { assert: 'state.activeAppId === "metrics_explorer"', message: 'Should be active' },

    // ── Verify on_activate loaded data ──
    { waitFor: 'state.workspace["metrics_explorer.filter_recency"] !== undefined', timeout: 10000 },

    // ── DOM check after on_activate ──
    { action: 'callFunction', args: ['metrics_explorer_dom_check', {}], id: 'dom_after_activate', timeout: 10000, wait: 500 },
    { assert: 'results.dom_after_activate.metrics_in_state > 0', message: 'Should have metrics in state after on_activate' },
    { assert: 'results.dom_after_activate.metrics_match === true', message: 'DOM metric count should match state' },
    { assert: 'results.dom_after_activate.loading === false', message: 'Should not be loading' },

    // ── Simulate Refresh click ──
    { action: 'callFunction', args: ['metrics_explorer_load_context', {}], id: 'refresh', timeout: 10000, wait: 500 },
    { action: 'callFunction', args: ['metrics_explorer_dom_check', {}], id: 'dom_after_refresh', timeout: 10000 },
    { assert: 'results.dom_after_refresh.metrics_match === true', message: 'DOM should match after refresh' },

    // ── Open entry form ──
    { action: 'callFunction', args: ['metrics_explorer_new_entry', {}], timeout: 5000, wait: 500 },
    { action: 'callFunction', args: ['metrics_explorer_dom_check', {}], id: 'dom_entry_form', timeout: 10000 },
    { assert: 'results.dom_entry_form.entry_form_visible === true', message: 'Entry form should be visible' },

    // ── Deactivate ──
    { action: 'callFunction', args: ['deactivate_app', {}], timeout: 10000, wait: 500 },
    { assert: 'state.activeAppId === null', message: 'Should be deactivated' },
  ],
});
