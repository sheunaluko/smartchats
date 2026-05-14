import { defineWorkflow } from 'simi';

/**
 * Auto Todo Manager — zero-LLM test flow.
 * Uses callFunction + seedAndLoadApps for direct invocation.
 * Tests: seeding, activation, on_activate, DOM rendering, create, complete, form, deactivate.
 */
export const autoTodoFlow = defineWorkflow({
  id: 'auto_todo_flow',
  app: 'smartchats',
  tags: ['e2e', 'app_platform', 'todo', 'auto'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // ── Setup: seed apps ──
    { waitFor: 'state.agent !== null', timeout: 15000 },
    { action: 'seedAndLoadApps', args: [], timeout: 30000 },
    { waitFor: 'state.installedApps.length > 0', timeout: 5000 },

    // ── Activate todo app ──
    { action: 'callFunction', args: ['activate_app', { app_id: 'todo' }], id: 'activate', timeout: 15000, wait: 1000 },
    { assert: 'state.activeAppId === "todo"', message: 'Should be active' },

    // ── Seed test todos (via app function inside iframe) ──
    { action: 'callFunction', args: ['todo_seed_test_todos', {}], id: 'seed', timeout: 15000, wait: 500 },
    { assert: 'results.seed.seeded === true', message: 'Should seed test todos' },
    { assert: 'results.seed.count > 0', message: 'Should have seeded at least one todo' },

    // ── Reload data after seeding ──
    { action: 'callFunction', args: ['todo_load_todos', {}], id: 'reload', timeout: 10000, wait: 500 },

    // ── DOM check after load ──
    { action: 'callFunction', args: ['todo_dom_check', {}], id: 'dom_init', timeout: 10000, wait: 500 },
    { assert: 'results.dom_init.total_in_state > 0', message: 'Should have todos in state' },
    { assert: 'results.dom_init.total_match === true', message: 'DOM todo count should match state' },
    { assert: 'results.dom_init.loading === false', message: 'Should not be loading' },
    { assert: 'results.dom_init.overdue_in_state > 0', message: 'Should have overdue todos from seed' },

    // ── Create a new todo ──
    { action: 'callFunction', args: ['todo_create_todo', { title: '__simi_auto_new', priority: 'high', category: 'test' }], id: 'create', timeout: 10000, wait: 500 },
    { assert: 'results.create.ok === true', message: 'Create should succeed' },
    { action: 'callFunction', args: ['todo_dom_check', {}], id: 'dom_create', timeout: 10000 },
    { assert: 'results.dom_create.total_match === true', message: 'DOM should match after create' },

    // ── Complete a todo (first visible) ──
    { action: 'callFunction', args: ['todo_complete_todo', {}], id: 'complete', timeout: 10000, wait: 500 },
    { assert: 'results.complete.ok === true', message: 'Complete should succeed' },
    { action: 'callFunction', args: ['todo_dom_check', {}], id: 'dom_compl', timeout: 10000 },
    { assert: 'results.dom_compl.total_match === true', message: 'DOM should match after complete' },

    // ── Open create form ──
    { action: 'callFunction', args: ['todo_open_create_form', {}], timeout: 5000, wait: 500 },
    { action: 'callFunction', args: ['todo_dom_check', {}], id: 'dom_form', timeout: 10000 },
    { assert: 'results.dom_form.create_form_visible === true', message: 'Create form should be visible' },

    // ── Deactivate ──
    { action: 'callFunction', args: ['deactivate_app', {}], timeout: 10000, wait: 500 },
    { assert: 'state.activeAppId === null', message: 'Should be deactivated' },
  ],
});
