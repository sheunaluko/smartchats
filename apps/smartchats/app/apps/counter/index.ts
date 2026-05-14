/**
 * Counter — minimal test app for the app platform.
 * Increment, decrement, reset, or set to a specific value.
 */

import type { AppManifest, AppPermission } from '../../../core/types/app'
import { DEFAULT_GRANTS } from '../../lib/permissions'

const HTML = `
<style>
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; gap: 16px; }
  .count { font-size: 72px; font-weight: 700; color: #58a6ff; }
  .label { font-size: 14px; color: #8b949e; text-transform: uppercase; letter-spacing: 2px; }
  .buttons { display: flex; gap: 12px; }
  .btn { padding: 12px 28px; border-radius: 8px; border: 1px solid #30363d;
         background: #21262d; color: #e6edf3; font-size: 18px; cursor: pointer;
         transition: background 0.15s; min-width: 60px; }
  .btn:hover { background: #30363d; }
  .btn:active { background: #3d444d; }
  .btn.primary { background: #238636; border-color: #2ea043; }
  .btn.primary:hover { background: #2ea043; }
  .btn.danger { background: #da3633; border-color: #f85149; }
  .btn.danger:hover { background: #f85149; }
  .status { font-size: 13px; color: #484f58; margin-top: 8px; }
</style>

<div class="label">Counter</div>
<div class="count" id="count">0</div>
<div class="buttons">
  <button class="btn danger" onclick="handleDecrement()">-</button>
  <button class="btn" onclick="handleReset()">Reset</button>
  <button class="btn primary" onclick="handleIncrement()">+</button>
</div>
<div class="status" id="status">Ready</div>

<script>
  var countEl = document.getElementById('count');
  var statusEl = document.getElementById('status');

  function render() {
    countEl.textContent = SmartChats.app.state.count || 0;
  }

  function handleIncrement() {
    SmartChats.app.fns.increment({}, SmartChats.app, SmartChats.util);
  }

  function handleDecrement() {
    SmartChats.app.fns.decrement({}, SmartChats.app, SmartChats.util);
  }

  function handleReset() {
    SmartChats.app.fns.reset_counter({}, SmartChats.app, SmartChats.util);
  }

  render();
</script>
`

export const counterApp: AppManifest = {
    id: 'counter',
    name: 'Counter',
    version: '1.0.0',
    description: 'A simple counter app. Increment, decrement, or reset. Tests the app platform plumbing: iframe sandbox, bridge communication, state persistence, and agent function proxying.',
    icon: '🔢',
    source: 'builtin',
    categories: ['utility', 'test'],
    tags: ['counter', 'test', 'builtin'],
    interaction_mode: 'agent_driven',
    display_mode: 'panel',
    permissions: DEFAULT_GRANTS.builtin as AppPermission[],
    requested_functions: [],

    html_templates: { main: HTML },

    state_schema: {
        count: { type: 'number', default: 0, description: 'The current count value' },
    },

    modules: [{
        id: 'main',
        name: 'Counter',
        position: 60,
        system_msg: 'A counter app is active. The user can tap +/- buttons or ask you to increment/decrement/reset. Use the counter_ prefixed functions.',
        functions: [
            {
                name: 'increment',
                description: 'Increment the counter by 1',
                parameters: null,
                return_type: 'object',
                code: `async function(fnArgs, app, util) {
    app.state.count = (app.state.count || 0) + 1;
    app.dom.getElementById('count').textContent = app.state.count;
    app.dom.getElementById('status').textContent = 'Incremented to ' + app.state.count;
    await util.update_workspace({ count: app.state.count });
    return { count: app.state.count };
}`,
            },
            {
                name: 'decrement',
                description: 'Decrement the counter by 1',
                parameters: null,
                return_type: 'object',
                code: `async function(fnArgs, app, util) {
    app.state.count = (app.state.count || 0) - 1;
    app.dom.getElementById('count').textContent = app.state.count;
    app.dom.getElementById('status').textContent = 'Decremented to ' + app.state.count;
    await util.update_workspace({ count: app.state.count });
    return { count: app.state.count };
}`,
            },
            {
                name: 'reset_counter',
                description: 'Reset the counter to 0',
                parameters: null,
                return_type: 'object',
                code: `async function(fnArgs, app, util) {
    app.state.count = 0;
    app.dom.getElementById('count').textContent = '0';
    app.dom.getElementById('status').textContent = 'Reset';
    await util.update_workspace({ count: 0 });
    return { count: 0 };
}`,
            },
            {
                name: 'set_count',
                description: 'Set the counter to a specific value',
                parameters: { value: 'number' },
                return_type: 'object',
                code: `async function(fnArgs, app, util) {
    var val = Number(fnArgs.value) || 0;
    app.state.count = val;
    app.dom.getElementById('count').textContent = val;
    app.dom.getElementById('status').textContent = 'Set to ' + val;
    await util.update_workspace({ count: val });
    return { count: val };
}`,
            },
        ],
    }],

    version_history: [{ version: '1.0.0', published_at: new Date().toISOString() }],
}
