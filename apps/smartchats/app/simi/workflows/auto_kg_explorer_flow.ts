import { defineWorkflow } from 'simi';

/**
 * Auto KG Explorer — zero-LLM test flow.
 * Uses callFunction for direct invocation.
 * Tests: activation, entity list, detail view, delete triple,
 *        back to list, add form, add triple, cleanup, deactivate.
 */
export const autoKgExplorerFlow = defineWorkflow({
  id: 'auto_kg_explorer_flow',
  app: 'smartchats',
  tags: ['e2e', 'app_platform', 'kg_explorer', 'auto'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // ── Setup ──
    { waitFor: 'state.agent !== null', timeout: 15000 },
    { action: 'seedAndLoadApps', args: [], timeout: 30000 },
    { waitFor: 'state.installedApps.length > 0', timeout: 5000 },

    // ── Activate ──
    { action: 'callFunction', args: ['activate_app', { app_id: 'kg_explorer' }], id: 'activate', timeout: 15000, wait: 1000 },
    { assert: 'state.activeAppId === "kg_explorer"', message: 'Should be active' },

    // ── DOM check initial ──
    { action: 'callFunction', args: ['kg_explorer_dom_check', {}], id: 'dom_init', timeout: 10000, wait: 500 },
    { assert: 'results.dom_init.view === "list"', message: 'Should start in list view' },

    // ── Seed test triples ──
    { action: 'callFunction', args: ['kg_explorer_seed_test_data', {}], id: 'seed', timeout: 15000, wait: 500 },
    { assert: 'results.seed.seeded === true', message: 'Should seed test data' },

    // ── Reload + verify entities appear ──
    { action: 'callFunction', args: ['kg_explorer_load_entities', {}], id: 'reload', timeout: 10000, wait: 500 },
    { action: 'callFunction', args: ['kg_explorer_dom_check', {}], id: 'dom_load', timeout: 10000 },
    { assert: 'results.dom_load.entity_count > 0', message: 'Should have entities' },
    { assert: 'results.dom_load.entities_match === true', message: 'DOM should match state' },

    // ── Select entity ──
    { action: 'callFunction', args: ['kg_explorer_select_entity', { entity: '__simi_alice' }], id: 'select', timeout: 10000, wait: 1500 },
    { assert: 'results.select.ok === true', message: 'Select should succeed' },
    { action: 'callFunction', args: ['kg_explorer_dom_check', {}], id: 'dom_det', timeout: 10000 },
    { assert: 'results.dom_det.view === "detail"', message: 'Should be in detail view' },
    { assert: 'results.dom_det.detail_entity === "__simi_alice"', message: 'Detail should show alice' },
    { assert: 'results.dom_det.detail_relations > 0', message: 'Should have relations' },
    { assert: 'results.dom_det.graph_visible === true', message: 'Graph should be visible in detail view' },

    // ── Delete a triple ──
    { action: 'callFunction', args: ['kg_explorer_delete_triple', { source: '__simi_alice', relation: 'knows', target: '__simi_bob' }], id: 'del', timeout: 10000, wait: 500 },
    { assert: 'results.del.ok === true', message: 'Delete should succeed' },

    // ── Back to list ──
    { action: 'callFunction', args: ['kg_explorer_back_to_list', {}], timeout: 5000, wait: 500 },
    { action: 'callFunction', args: ['kg_explorer_dom_check', {}], id: 'dom_back', timeout: 10000 },
    { assert: 'results.dom_back.view === "list"', message: 'Should be back in list view' },

    // ── Open add form ──
    { action: 'callFunction', args: ['kg_explorer_open_add_form', {}], timeout: 5000, wait: 500 },
    { action: 'callFunction', args: ['kg_explorer_dom_check', {}], id: 'dom_form', timeout: 10000 },
    { assert: 'results.dom_form.add_form_visible === true', message: 'Add form should be visible' },

    // ── Add a triple ──
    { action: 'callFunction', args: ['kg_explorer_add_triple', { subject: '__simi_alice', relation: 'likes', object: '__simi_jazz' }], id: 'add', timeout: 10000, wait: 500 },
    { assert: 'results.add.ok === true', message: 'Add should succeed' },

    // ── Cleanup test data ──
    { action: 'callFunction', args: ['kg_explorer_cleanup_test_data', {}], id: 'cleanup', timeout: 15000, wait: 500 },
    { assert: 'results.cleanup.ok === true', message: 'Cleanup should succeed' },

    // ── Deactivate ──
    { action: 'callFunction', args: ['deactivate_app', {}], timeout: 10000, wait: 500 },
    { assert: 'state.activeAppId === null', message: 'Should be deactivated' },
  ],
});
