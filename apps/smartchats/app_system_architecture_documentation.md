# SmartChats App Platform — System Architecture

## Overview

The SmartChats app platform allows mini-apps to compose into the voice AI agent. An "app" is not a standalone program — it is a set of capabilities (UI, functions, state, permissions) that the agent gains when the app activates. The user talks to one agent that becomes smarter with each app.

The platform runs on existing SmartChats primitives (SCM, IframeSandbox, workspace, SurrealDB, tivi) with a composition layer that provides packaging, identity, lifecycle, and discovery.

---

## System Diagram

```
                    ┌─────────────────────────────────────────────────────┐
                    │                  MOBILE SHELL                        │
                    │  ┌───────────────────────────────────────────────┐  │
                    │  │ SessionMiniHeader  [SmartChats.AI › AppName]  │  │
                    │  └───────────────────────────────────────────────┘  │
                    │  ┌───────────────────────────────────────────────┐  │
                    │  │           AppContainer (flex:1)                │  │
                    │  │  ┌─────────────────────────────────────────┐  │  │
                    │  │  │         APP IFRAME (sandbox)            │  │  │
                    │  │  │                                         │  │  │
                    │  │  │   SmartChats.app  (DOM, state, fns)    │  │  │
                    │  │  │   SmartChats.util (permission-gated)   │  │  │
                    │  │  │                                         │  │  │
                    │  │  │   ┌──── Bridge (postMessage) ────┐     │  │  │
                    │  │  └───┼─────────────────────────────┼─────┘  │  │
                    │  └──────┼─────────────────────────────┼────────┘  │
                    └─────────┼─────────────────────────────┼──────────┘
                              │                             │
                    ┌─────────▼─────────────────────────────▼──────────┐
                    │                  APP SANDBOX (host)                │
                    │                                                    │
                    │   Permission enforcement                          │
                    │   Util call routing                               │
                    │   Function call proxying                         │
                    │   Theme sync                                      │
                    └────────────────────┬─────────────────────────────┘
                                         │
                    ┌────────────────────▼─────────────────────────────┐
                    │              APP LAUNCHER MODULE                   │
                    │                                                    │
                    │   activate / deactivate / create / install         │
                    │   Proxy SCM module (agent-callable functions)     │
                    │   Workspace prefixing                             │
                    │   State persistence                               │
                    └────────────────────┬─────────────────────────────┘
                                         │
              ┌──────────────────────────▼──────────────────────────────┐
              │                    CORTEX ENGINE                          │
              │                                                          │
              │   SCM (SystemContextManager)                             │
              │   IframeSandbox (code execution — separate iframe)       │
              │   Workspace                                              │
              │   EventEmitter → Orchestrator → Zustand Store           │
              └──────────────────────────────────────────────────────────┘
```

---

## Two Iframes

When an app is active, two iframes exist simultaneously:

| | Cortex IframeSandbox (iframe #1) | App Iframe (iframe #2) |
|---|---|---|
| **Purpose** | Executes agent-generated code | Runs app UI + functions |
| **Created by** | `IframeSandboxExecutor` at agent init | `AppSandbox.mount()` on activation |
| **Sandbox attr** | `allow-scripts` | `allow-scripts` |
| **Persistent** | Yes (reused across executions) | Yes (lives until deactivation) |
| **Has bridge** | No (has context injection) | Yes (`SmartChats.*` API) |
| **Workspace** | Injected as snapshot, synced via `workspaceSync` | Via `util.update_workspace` bridge calls |

When the agent calls an app function (e.g. `counter_increment`), the call flows through both iframes:

```
Agent generates code: "await counter_increment({})"
  → iframe #1 executes code
    → counter_increment is a proxy function injected into context
      → proxy calls AppSandbox.callFunction('increment', {})
        → postMessage to iframe #2
          → bridge dispatches to SmartChats.app.fns['increment']
            → function runs with (fnArgs, app, util)
            → direct DOM manipulation, state updates
            → may call util.update_workspace() → bridge → host
          → result posted back
        → proxy resolves
      → result returned to iframe #1
    → code execution completes
```

---

## The Bridge Protocol

All communication between the host and app iframe goes through `postMessage`. The bridge library is host-injected JavaScript (not agent-authored) that provides the `SmartChats.*` API inside the iframe.

### Iframe → Host

| Message Type | Payload | Purpose |
|---|---|---|
| `app_bridge_ready` | — | Bridge loaded, ready for init |
| `app_util_call` | `{ method, args, callId }` | App calls a Util method |
| `app_function_result` | `{ callId, result }` | App returns function call result |
| `app_function_error` | `{ callId, error }` | App function threw |
| `app_log` | `{ message }` | Logging (always available) |
| `app_feedback` | `{ feedbackType }` | Sound feedback (always available) |

### Host → Iframe

| Message Type | Payload | Purpose |
|---|---|---|
| `app_init` | `{ config }` | Initialize bridge: manifest, state, permissions |
| `call_function` | `{ name, args, callId }` | Host calls an app function |
| `util_result` | `{ callId, result }` | Response to a Util call |
| `util_error` | `{ callId, error }` | Error response to a Util call |
| `user_input` | `{ text }` | Deliver voice/text input to app |
| `workspace_sync` | `{ state }` | Push workspace state into app |
| `theme_update` | `{ tokens }` | Push CSS variable updates |

### RPC Pattern

Every Util call and function call uses a `callId` for request-response pairing:

```
Iframe:  postMessage({ type: 'app_util_call', method: 'get_workspace', callId: 7 })
Host:    validates permission → executes → postMessage({ type: 'util_result', callId: 7, result: {...} })
Iframe:  pending promise for callId 7 resolves with result
```

Function calls from host to iframe follow the same pattern in reverse.

---

## The App Function Signature

Every app function receives three arguments:

```javascript
(fnArgs, app, util) => { ... }
```

### `fnArgs`
Parameters passed by the caller (agent or another function).

### `app` (AppHandle)
The app's own context with direct access:
```javascript
app.dom        // document — direct DOM manipulation
app.state      // {} — in-memory app state (reactive via setState)
app.fns        // {} — other registered app functions (callable directly)
app.manifest   // {} — app metadata (id, name, version, etc.)
app.el(sel)    // document.querySelector shorthand
app.setState(patch)   // merge patch into state + schedule render
app.onRender(fn)      // register render callback: fn(state, changedKeys)
```

### `util` (Util)
Permission-gated platform utilities. Only methods the app has been granted appear:

```javascript
// Tier 0 — always available
util.log(msg)
util.feedback(type)

// Requires workspace:write / workspace:read
util.update_workspace(patch)
util.get_workspace()

// Requires voice:tts / voice:mic
util.user_output(text)
util.get_user_input()       // returns Promise, blocks until user speaks/types

// Requires data:read
util.get_embedding(text)

// Requires llm:call
util.call_llm(params)       // NOT YET IMPLEMENTED

// Requires data:raw_query
util.query(sql, vars)

// Granted cortex functions (per requested_functions + permissions)
util.smartchats.get_metrics(params)
util.smartchats.search_logs(params)
util.smartchats.retrieve_declarative_knowledge(params)
// ... only functions explicitly requested and permission-granted
```

Methods not granted simply **do not exist** on the `util` object. There is nothing to call, nothing to bypass.

---

## Permission System

### Tiers

| Tier | Risk | Permissions |
|---|---|---|
| 0 | Safe | `display`, `workspace:read`, `workspace:write` |
| 1 | Read | `data:read`, `voice:tts`, `voice:mic`, `search:web` |
| 2 | Write | `data:write`, `functions:dynamic`, `process:spawn`, `system:appearance`, `llm:call` |
| 3 | Dangerous | `data:raw_query` |

### Default Grants by Source

| Source | Auto-granted | Explicit consent needed for |
|---|---|---|
| `builtin` | All | None |
| `agent` | `display`, `workspace:read`, `workspace:write` | Everything else |
| `community` | `display` | Everything else |

### Enforcement Points

1. **Bridge construction** — `_initUtil()` only creates methods for granted permissions
2. **Host validation** — `AppSandbox.handleUtilCall()` checks permission before every call
3. **Function filtering** — `filterGrantedFunctions()` only bridges requested + granted cortex functions
4. **No raw event access** — apps cannot emit into the Cortex EventEmitter

### Cortex Function Access

Apps declare `requested_functions` in the manifest (e.g. `['get_metrics', 'search_logs']`). Each function maps to a required permission:

```
get_metrics         → data:read
save_metric         → data:write
query_db            → data:raw_query
fork_process        → process:spawn
search_web          → search:web
set_design_pack     → system:appearance
```

Only functions in the intersection of `requested_functions` AND `granted_permissions` appear in `util.smartchats`.

---

## Lifecycle

### States

```
[not installed] ──install──→ [installed] ──activate──→ [active]
       ↑                                                  │
    uninstall                                       deactivate
       ↑                                                  │
       └──────────────── [installed] ←────────────────────┘
```

### Activation Flow

```
activate_app(app_id)
  1. Load install + manifest from SurrealDB
  2. If another app active → deactivate it first
  3. Create AppSandbox with host handlers
  4. Build proxy SCM module (wraps each app function as agent-callable)
  5. Add proxy module to SCM, rebuild agent function dictionary
  6. Initialize workspace with state_schema defaults (prefixed with app_id)
  7. Restore persisted app_state from install record
  8. Emit app_activated event → store + orchestrator
  9. React AppContainer renders → calls sandbox.mount(container)
  10. Iframe created in container, bridge loaded, app_init sent
  11. Agent now has proxy functions (e.g. counter_increment, counter_set_count)
```

### Deactivation Flow

```
deactivate_app()
  1. Read workspace state, filter by app prefix → persist to install record
  2. Destroy AppSandbox (removes iframe, cleans up listeners)
  3. Remove proxy SCM module from agent
  4. Rebuild agent function dictionary
  5. Emit app_deactivated event → store clears activeApp
  6. React AppContainer unmounts
```

### One App at a Time

Only one foreground app can be active. This is driven by context window economics — each active app's proxy module adds system messages and functions to the prompt. Multiple apps would consume tokens and degrade reasoning.

The app launcher module's `beforeBuild` hook maintains awareness:

```
[App Platform]
Currently active: Guided Breathing
Installed: counter, guided_breathing, workspace_echo_test
```

---

## State Management

### Three State Locations

| Location | Scope | Persists | Accessed by |
|---|---|---|---|
| `SmartChats.app.state` | App iframe only | Session only | App functions, `get_app_state` via `__get_state` |
| Workspace (prefixed) | Cortex + Store | Session (auto-saved) | Agent code, `get_app_state` fallback |
| `smartchats_app_installs.app_state` | SurrealDB | Across sessions | Restored on activation |

### State Read Path

When the agent calls `get_app_state({key: "saved_text"})`:

```
1. Calls sandbox.callFunction('__get_state', {key: "saved_text"})
   → postMessage to app iframe
   → reads SmartChats.app.state["saved_text"]
   → safeSerialize() for postMessage safety
   → returns result
2. If sandbox unavailable, falls back to workspace:
   → ops.util.get_workspace()["app_id.saved_text"]
```

The `__get_state` and `__set_state` functions are built into the bridge (registered automatically during `_init`). They support reading a single key or the full state object.

### State Write Path

When app code calls `util.update_workspace({count: 5})`:

```
1. Bridge posts app_util_call to host
2. AppSandbox validates workspace:write permission
3. Host handler prefixes key: { "counter.count": 5 }
4. Calls ops.util.update_workspace(prefixed)
5. Cortex.workspace updated
6. Cortex.sandbox.syncWorkspace(workspace) → pushes to iframe #1
7. Event emitted → orchestrator → store.updateWorkspace()
8. Store merges into Zustand state
```

### Workspace Sync (iframe #1)

The Cortex execution sandbox (iframe #1) receives workspace updates mid-execution via `workspaceSync` messages. This prevents the post-execution workspace return from overwriting updates that arrived during execution:

```
Cortex.update_workspace(patch)
  → this.workspace = {...this.workspace, ...patch}
  → this.sandbox.syncWorkspace(this.workspace)
    → postMessage({ type: 'workspaceSync', workspace }) to iframe #1
      → listener: Object.assign(allowedGlobals.workspace, incoming)
```

Without this, the sandbox would return a stale workspace snapshot that overwrites live updates from app bridge calls.

### State Persistence

On deactivation, app workspace state (filtered by prefix) is saved to `smartchats_app_installs.app_state`. On re-activation, it's restored to workspace. This allows apps to resume where they left off across sessions.

### Selective Persistence (`persist` flag)

Each `state_schema` field can declare `persist: boolean` (default `true`):

```javascript
state_schema: {
    health:     { type: 'string', default: 'idle', persist: false },  // resets each session
    total_runs: { type: 'number', default: 0,      persist: true },   // survives across sessions
}
```

On deactivation, only fields with `persist !== false` are saved to `app_state`. On activation, persisted fields are restored and non-persisted fields reset to their schema defaults. Unknown fields (not in schema) are always persisted for backward compatibility.

### Fullscreen Remount

When the Display widget toggles fullscreen, the React tree unmounts and remounts — destroying and recreating the app iframe. The sandbox handles this via state snapshotting:

```
1. User clicks fullscreen → VisualizationWidget calls sandbox.snapshotState()
2. snapshotState() calls __get_state via bridge → stores full app.state as lastState
3. React unmounts old container (iframe destroyed)
4. React mounts new container → AppContainer calls sandbox.mount(container)
5. mount() detects iframe.isConnected === false → resets, creates fresh iframe
6. sendInit() merges: schema defaults → install.app_state → lastState snapshot
7. App restarts with full state restored
```

### Reactive State Model (`setState` + `onRender`)

Apps use a lightweight reactive pattern for DOM rendering. Instead of manually querying and mutating DOM elements, app code declares a render function and drives all UI through state changes.

#### API

```javascript
// Register a render callback (call once, typically at script load time)
SmartChats.app.onRender(function(state, changedKeys) {
    if (changedKeys.has('tracked_metrics')) renderMetricList(state);
    if (changedKeys.has('loading'))         renderSpinner(state);
});

// Update state — triggers render on next microtask
SmartChats.app.setState({ loading: true, tracked_metrics: data });
```

#### How It Works

1. **`app.setState(patch)`** — merges `patch` into `app.state`, records changed keys, and schedules a single render via `Promise.resolve().then(...)` (microtask). Multiple `setState` calls within the same synchronous block coalesce into one render.

2. **`app.onRender(fn)`** — registers the render callback. `fn` receives `(state, changedKeys)` where `changedKeys` is a `Set<string>` of all keys modified since the last render. The callback can branch on `changedKeys.has('field')` to do selective DOM updates.

3. **Pre-init stubs** — `onRender` and `setState` exist as stubs on `SmartChats.app` from the moment the bridge source is evaluated (before `_init`). This allows HTML `<script>` blocks to call `SmartChats.app.onRender(fn)` at load time. The stub stores the function as `_pendingRenderFn`, which `_init` picks up and wires into the real reactive system.

4. **State object identity** — `_init` merges initial state INTO the existing `app.state` object rather than replacing it. This preserves references captured by app scripts at load time (e.g. `var state = SmartChats.app.state`).

#### Initialization Order

```
Bridge source evaluated
  → SmartChats.app created with stub setState/onRender
  → SmartChats.app.state = {} (empty object)

App HTML <script> blocks run
  → SmartChats.app.onRender(renderFn) → stored as _pendingRenderFn
  → SmartChats.registerFunction('my_fn', ...) → stored in app.fns

Host sends app_init message
  → _init(config):
    1. Merge config.initialState INTO existing app.state (preserves references)
    2. Wire real setState/onRender (picks up _pendingRenderFn)
    3. Register __get_state / __set_state built-in functions
    4. Call on_activate hook (via Promise.resolve().then() for async visibility)
```

#### Pattern: App Function Triggering Render

App functions set state, which drives the UI — the function never touches the DOM directly:

```javascript
SmartChats.registerFunction('load_context', async function(fnArgs, app, util) {
    app.setState({ loading: true });
    var data = await util.smartchats.get_metrics_context();
    app.setState({
        loading: false,
        tracked_metrics: data.metrics || [],
    });
    return { ok: true, count: (data.metrics || []).length };
});
```

### `dom_check` — Iframe Self-Inspection

`dom_check` is a convention for app functions that inspect the iframe's own DOM and report whether rendered elements match the current state. It is the primary mechanism for verifying that the reactive render pipeline is working correctly.

#### Why It Exists

Apps run in sandboxed iframes (`sandbox="allow-scripts"`, no `allow-same-origin`). The host cannot reach into the iframe's DOM. The only way to verify what the user sees is to ask the iframe to inspect itself. `dom_check` bridges this gap — it runs inside the iframe, queries the DOM, compares against `app.state`, and returns a structured report via the normal function-call bridge.

#### Convention

Every app that has meaningful UI should include a `dom_check` function in its modules. The function:

1. Queries DOM elements (counts, visibility, text content)
2. Reads corresponding values from `app.state`
3. Returns an object with both actual and expected values, plus `*_match` booleans

```javascript
SmartChats.registerFunction('dom_check', async function(fnArgs, app, util) {
    var metricItems = app.dom.querySelectorAll('.metric-item').length;
    var expectedMetrics = (app.state.tracked_metrics || []).length;
    var spinnerVisible = app.dom.getElementById('spinner').style.display !== 'none';

    return {
        metrics_rendered: metricItems,
        metrics_in_state: expectedMetrics,
        metrics_match: metricItems === expectedMetrics,
        spinner_visible: spinnerVisible,
        loading: !!app.state.loading,
    };
});
```

#### Usage in Headless Testing (Simi)

`dom_check` enables zero-LLM automated testing. The Simi workflow calls app functions via `callFunction` (no agent round-trip), then calls `dom_check` to verify the DOM updated correctly:

```javascript
// Simi workflow steps:
{ action: 'callFunction', args: ['activate_app', { app_id: 'metrics_explorer' }], wait: 1000 },
{ action: 'callFunction', args: ['metrics_explorer_dom_check', {}], id: 'dom_check' },
{ assert: 'results.dom_check.metrics_match === true', message: 'DOM should match state' },
{ assert: 'results.dom_check.loading === false', message: 'Should not be loading' },
```

This closes the agentic debug loop: `seedAndLoadApps` → `callFunction` (activate) → `callFunction` (trigger action) → `dom_check` (verify UI) — all without LLM calls, completing in ~7 seconds.

#### Apps with `dom_check`

| App | What it checks |
|-----|----------------|
| Canary | suite rows, log entries, health label, call count, suite dots |
| Metrics Explorer | metric items, detail/spinner/form visibility, table rows, habit section |

---

## Theme System

Apps receive SmartChats design pack tokens as CSS variables. Two mechanisms:

### Snapshot (no flash of unstyled content)

`AppSandbox.buildSrcdoc()` reads current `--sc-*` CSS variables from `document.documentElement.style` and injects them as a `<style>:root { ... }</style>` block in the iframe's srcdoc. The app renders with correct theme from the first frame.

### Live Updates (theme changes)

```
DesignPackBridge re-renders (pack changed)
  → injectCssVars(pack) updates host :root
  → buildThemeTokens(pack) creates token map
  → dispatches CustomEvent('smartchats:theme_change', { detail: { tokens } })
    → AppSandbox.themeHandler receives
      → postMessage({ type: 'theme_update', tokens }) to app iframe
        → bridge applies each token: document.documentElement.style.setProperty(key, value)
```

Apps use `var(--sc-background)`, `var(--sc-accent)`, `var(--sc-text)`, etc. in their CSS. Theme changes propagate automatically.

### Available Tokens

Colors: `--sc-background`, `--sc-surface`, `--sc-surface-alt`, `--sc-text`, `--sc-text-muted`, `--sc-primary`, `--sc-accent`, `--sc-border`, `--sc-danger`, `--sc-success`, `--sc-warning`

Typography: `--sc-font-sans`, `--sc-font-mono`, `--sc-text-xs` through `--sc-text-2xl`, font weights, line heights

Layout: `--sc-radius-sm/md/lg`, `--sc-space-*` scale, `--sc-shadow-sm/md/lg/xl`

Motion: `--sc-motion-fast`, `--sc-motion-base`, `--sc-motion-easing`

Derived semantic: `--sc-surface-secondary`, `--sc-accent-soft`, `--sc-field-*`, `--sc-overlay`, etc.

## External Scripts & CSP

Apps may declare external CDN scripts in their manifest via `external_scripts`. The platform enforces these declarations using Content-Security-Policy, preventing unauthorized script loads.

### Manifest Declaration

```typescript
external_scripts?: string[]  // Full CDN URLs

// Example:
external_scripts: [
    'https://cdn.jsdelivr.net/npm/graphology@0.25/dist/graphology.umd.min.js',
    'https://cdn.jsdelivr.net/npm/sigma@2/build/sigma.min.js',
]
```

### How It Works

`AppSandbox.buildSrcdoc()` does two things based on the manifest:

1. **Injects a CSP meta tag** as the first element in `<head>`:
   - No `external_scripts` declared → `script-src 'unsafe-inline'` — blocks all external script loads
   - Scripts declared → `script-src 'unsafe-inline' <url1> <url2> ...` — only declared URLs allowed

2. **Auto-injects `<script src="...">` tags** in `<head>` before the bridge and app HTML — apps don't need manual script tags in their templates.

### Security Model

| App Source | Effect |
|---|---|
| `builtin` | Declares trusted CDN scripts; CSP allows only those URLs |
| `agent` | Typically no external scripts; CSP blocks all external loads |
| `community` | External scripts visible in manifest for review; CSP enforces |

The CSP is browser-enforced — even if malicious HTML contains undeclared `<script src>` tags, the browser blocks them. Combined with `sandbox="allow-scripts"` (no `allow-same-origin`), external scripts cannot access parent cookies, storage, or origin.

### Content Hash

`external_scripts` is included in the content hash computation (`hashManifest`), so changes to declared scripts trigger automatic re-seeding.

---

## Rendering

### Mobile Shell Integration

When an app activates:

1. Store sets `activeAppId` + `activeAppSandbox`
2. Orb auto-minimizes to icon mode (maximum screen space)
3. Header title becomes `SmartChats.AI › AppName`
4. `<main>` switches from normal content (transcript, moments, visualizations) to `AppContainer`
5. `AppContainer` calls `sandbox.mount(containerRef)` — iframe created in the right DOM position (never reparented)
6. Close button (X) in top-right sends "Deactivate the app" to the agent

The app fills all available vertical space via `flex: 1`. No width constraints (unlike the normal `max-w-[28rem]` content column).

### Display Modes (declared in manifest)

| Mode | Description | Status |
|---|---|---|
| `panel` | Fills available space in `<main>` | Implemented |
| `overlay` | Full-screen above shell | Not yet implemented |
| `inline` | Small element in chat stream | Not yet implemented |

---

## Data Storage

### SurrealDB Tables

**`smartchats_apps`** — Global app definitions (one record per app)

| Field | Type | Purpose |
|---|---|---|
| `app_id` | string | Unique identifier (snake_case) |
| `name` | string | Display name |
| `version` | string | Semver |
| `description` | string | 1-2 sentence summary |
| `author` | object | `{ uid, name, url? }` |
| `source` | string | `builtin`, `agent`, or `community` |
| `modules` | array | `SerializedAppModule[]` with function code strings |
| `html_templates` | object | `{ main: "<div>..." }` |
| `state_schema` | object | Declared state shape with defaults |
| `permissions` | array | Required permission scopes |
| `requested_functions` | array | Cortex function names to bridge |
| `embedding` | vector | For semantic search |
| `install_count` | number | Ecosystem metric |
| `version_history` | array | `[{ version, published_at, changelog }]` |
| `forked_from` | string | Parent app ID for remixes |

**`smartchats_app_installs`** — Per-user install records

| Field | Type | Purpose |
|---|---|---|
| `app_id` | string | References `smartchats_apps.app_id` |
| `installed_version` | string | Pinned version |
| `granted_permissions` | array | User-approved subset of requested |
| `app_state` | object | Persisted state (saved on deactivate) |
| `config` | object | User overrides |
| `activation_count` | number | Usage metric |

### Built-in App Seeding

Built-in apps are defined in code (`app/apps/builtin_apps.ts`) and seeded into SurrealDB on startup via `seedBuiltinApps()`. The seeder is idempotent — it computes a djb2 content hash of each manifest's fields (HTML, modules, state_schema, permissions, etc.) and stores it as `_content_hash` in SurrealDB. On each run it compares hashes and only updates records whose content has actually changed. No manual version bumps needed.

---

## Event System

App lifecycle events flow through the standard Cortex EventEmitter → Orchestrator → Store pattern.

### Events

| Event | Payload | Emitted by |
|---|---|---|
| `app_activated` | `{ manifest, install, sandbox }` | `doActivate()` |
| `app_deactivated` | `{ app_id }` | `doDeactivate()` |
| `app_installed` | `{ manifest, install }` | `install_app()`, `create_app()` |
| `app_uninstalled` | `{ app_id }` | `uninstall_app()` |
| `app_updated` | `{ manifest }` | `update_app()` |

### Insights Telemetry

Each store handler emits a rich insights event for post-session analysis:

```javascript
insights.emit('app_activated', {
  app_id, app_name, source, version, interaction_mode,
  permissions, requested_functions, granted_permissions,
  has_html, function_count
})
```

Retrievable via `bin/save_session smartchats` → JSON export → `events_by_type.app_activated`.

---

## Agent-Generated Apps

The agent can create apps via `create_app()`:

```
User: "Make me a Spanish vocabulary trainer"
Agent:
  1. Generates HTML with flashcard UI
  2. Defines functions: show_card, check_answer, advance
  3. Defines state_schema: { deck: [], current_index: 0, score: 0 }
  4. Calls create_app({ name, description, html, functions, state_schema, ... })
  5. Manifest saved to smartchats_apps with embedding
  6. Install record created with agent-default permissions
  7. App activated immediately
```

Agent-generated app functions are stored as code strings in the manifest and run inside the app iframe. The agent can iterate on apps via `update_app()` which bumps the version and hot-reloads if active.

### Preview Apps (In-Memory Iteration)

The agent can develop apps without persisting to the database using `preview_app()`:

```
preview_app(params) → build manifest in memory → store in workspace.__preview_app → activate
update_preview(params) → read/modify definition → deactivate → re-activate with new definition
save_preview() → promote to permanent installed app (writes to SurrealDB)
```

Preview apps:
- Use the same sandbox, bridge, and rendering as installed apps
- Get `builtin`-level permissions for full development access
- Store their manifest definition in `workspace.__preview_app` (agent can read/modify it)
- Skip DB persistence on deactivate (`activeApp.preview === true`)
- Are tagged with `preview: true` on the `LoadedApp` record

The agent iteration loop:
```javascript
// Create
await preview_app({ name: 'My App', html: '...', functions: [...] });

// Read + modify
var def = workspace.__preview_app;
def.html = '<div>new design</div>';
def.functions[0].code = 'async function(fnArgs, app, util) { ... }';

// Hot-reload
await update_preview(def);

// Happy? Save permanently
await save_preview();
```

---

## Interaction Modes

### Agent-Driven (default)

The agent controls the conversation. App functions appear as tools the agent can call. The user talks to the agent, the agent decides when to invoke app functions.

```
User: "What's the current count?"
Agent: calls get_app_state({key: "count"}) → reads from iframe → "The count is 42."
User: "Increment it"
Agent: calls counter_increment({}) → proxy → iframe → result
```

### App-Driven

The app takes over the input stream. It calls `util.get_user_input()` in a loop, handling all interaction directly. The agent is sidelined until the app releases control.

```javascript
async function gameLoop() {
  while (app.state.active) {
    render(app.state)
    const input = await util.get_user_input()     // blocks until user speaks
    const correct = check_answer(input, app.state.deck[idx])
    if (correct) await util.user_output("Correct!")
    else {
      const hint = await util.call_llm([...])     // optional LLM reasoning
      await util.user_output(hint)
    }
  }
}
```

When `appOwnsInput` is true, the orchestrator's `transcriptionCb` routes voice transcripts to the app via `sandbox.deliverUserInput()` instead of to the agent.

### Hybrid

The app handles tap events directly (iframe JS), voice goes through the agent. Both touch and voice work with different latency profiles. Declared via `interaction_mode: 'hybrid'` in the manifest.

---

## File Map

### New Files

| File | Purpose | Lines |
|---|---|---|
| `core/types/app.ts` | TypeScript type definitions | ~160 |
| `app/lib/permissions.ts` | Permission tiers, mappings, helpers | ~95 |
| `app/lib/app_bridge.ts` | Bridge JS source (injected into app iframes) | ~215 |
| `app/lib/app_sandbox.ts` | AppSandbox class (iframe lifecycle + postMessage) | ~340 |
| `app/modules/app_registry.ts` | SurrealDB CRUD for apps + installs | ~240 |
| `app/modules/app_launcher.ts` | SCM module with 13 agent functions (incl. preview_app, update_preview, save_preview) | ~780 |
| `app/apps/builtin_apps.ts` | Built-in app registry + content-hash seeder | ~130 |
| `app/apps/counter/index.ts` | Counter app — minimal platform test | ~200 |
| `app/apps/guided_breathing/index.ts` | Guided breathing pacer — square path animation | ~400 |
| `app/apps/onboarding/index.ts` | Onboarding experience — feature intro + user preferences | ~500 |
| `app/apps/canary/index.ts` | Canary devops dashboard: 8 test suites, 30 tests, dom_check | ~1030 |
| `app/apps/log_explorer/index.ts` | Log explorer — browse, search, edit, create journal entries | ~700 |
| `app/apps/metrics_explorer/index.ts` | Metrics explorer — browse metrics, trends, habits, dom_check | ~725 |
| `app/apps/todo/index.ts` | Todo manager — CRUD, categorized sections, dom_check | ~800 |
| `app/apps/kg_explorer/index.ts` | KG explorer — browse/search/add/delete triples, sigma.js graph viz, dom_check | ~650 |
| `app/components/AppContainer.tsx` | Shared AppContainer component (used by all shells) | ~70 |

### Modified Files

| File | Changes |
|---|---|
| `core/types/index.ts` | Re-export app types |
| `app/store/useSmartChatsStore.ts` | App state fields + 5 event handlers + insights telemetry |
| `app/hooks/useOrchestrator.ts` | 5 event cases + input stream routing |
| `app/cortex_agent_web.ts` | Register app launcher module + rebuild callback |
| `app/modules/initialization.ts` | Prefetch installed apps + seed built-in apps |
| `app/shells/ClaudeMobileShellV2.tsx` | Imports shared AppContainer, orb auto-minimize, header title |
| `app/widgets/VisualizationWidget.tsx` | AppContainer in Display widget, fullscreen state snapshot |
| `app/visualizations/HTMLViewer.tsx` | Skip rendering for `__app__` placeholder |
| `core/DesignPackBridge.tsx` | `buildThemeTokens()`, `themeTokensToCss()`, theme change event |
| `packages/ts_common/.../sandbox_interface.ts` | `syncWorkspace?()` on SandboxExecutor |
| `packages/ts_common/.../cortex.ts` | `syncWorkspace` call in `update_workspace` |
| `app/src/IframeSandbox.ts` | `syncWorkspace()` method + `workspaceSync` listener in sandbox code |

### Test Files

| File | Purpose |
|---|---|
| `app/simi/workflows/app_lifecycle_flow.ts` | Counter app: seed → activate → increment → set → deactivate → re-activate |
| `app/simi/workflows/breathing_app_flow.ts` | Breathing app: seed → activate → start → pause → resume → stop → deactivate |
| `app/simi/workflows/canary_sweep_flow.ts` | Canary: seed → activate → run all suites → orchestration → deactivate → re-activate (persistence) |
| `app/simi/workflows/log_explorer_flow.ts` | Log explorer: seed → activate → browse → search → edit → create |
| `app/simi/workflows/metrics_explorer_flow.ts` | Metrics explorer: seed → activate → browse → view metric → log entry |
| `app/simi/workflows/auto_metrics_explorer_flow.ts` | Zero-LLM metrics test: callFunction + dom_check assertions (~7s) |
| `app/simi/workflows/auto_todo_flow.ts` | Zero-LLM todo test: seed → activate → create → complete → dom_check |
| `app/simi/workflows/auto_onboarding_flow.ts` | Zero-LLM onboarding test: section navigation, progress, dom_check |
| `app/simi/workflows/auto_kg_explorer_flow.ts` | Zero-LLM KG test: seed triples → browse → select → delete → add → cleanup |
| `app/simi/workflows/seed_test_data_flow.ts` | Populates realistic metrics + logs test data |
| `tests/e2e/simi.spec.ts` | Playwright runner for all workflows |
