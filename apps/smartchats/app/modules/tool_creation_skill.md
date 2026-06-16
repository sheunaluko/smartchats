# Adding a tool to the smartchats agent

How to add a new function the agent can call. Verified against the current code (cortex SCM-based architecture).

## TL;DR

1. Create a module factory in `apps/smartchats/app/modules/<feature>.ts` that returns a `ContextModule` containing a `functions: [...]` array.
2. Import and register it in `apps/smartchats/app/cortex_agent_web.ts` via `scm.add_module(createMyFeatureModule())`.
3. Done — no manifest, no decorator, no separate registry. The function appears in the system prompt automatically and is dispatchable by the LLM.

## Architecture in one paragraph

The agent runtime is in `packages/cortex/`. Tools are registered with a `SystemContextManager` (SCM) — a module bag. Each module contributes any of: `system_msg` (prose injected into system prompt), `functions[]` (callable tools), `output_instructions`, `output_structure`, `state`. On every turn, Cortex calls `scm.build()` which flattens all modules' functions into one array, renders an "AVAILABLE FUNCTIONS" section of the system prompt from their info-only shape (`{name, description, parameters, return_type}`), and builds a `function_dictionary` keyed by name. When the LLM emits code that calls a function (the sandbox injects every function as a top-level async global), Cortex looks it up in the dictionary, builds the `ops` object, and runs `fn(ops)`. See `packages/cortex/src/system_context_manager.ts` and `packages/cortex/src/cortex.ts:1474` (`handle_function_call`).

## Tool shape

The `Function` type is in `packages/cortex/src/types.ts:16`:

```ts
export interface Function {
  description: string
  name: string
  parameters: FunctionParameters       // Record<string, any> | null
  return_type: FunctionReturnType      // any
  fn: (p: FunctionParameters) => FunctionReturnType
  enabled?: boolean
}
```

The `parameters` field is **NOT** JSON Schema. It's a plain `{ name: 'type-as-string' }` map, serialized verbatim into the prompt so the LLM can read it. Conventional values:

```ts
parameters: { query: 'string' }
parameters: { url: 'string', max_chars: 'number (optional, default ~7500)' }
parameters: { a: 'array', n: 'number' }
parameters: null   // for parameterless tools
```

There is no runtime validation. The handler trusts the LLM and does its own checks if needed.

## The `ops` argument

Every handler is called with one argument shaped `{ params, util }`. `util` is built in `packages/cortex/src/cortex.ts:1027` (`build_function_util`) and exposes:

- `log(msg)` — append to log widget
- `event({ type, data })` — emit a runtime event (telemetry, UI)
- `user_output(text)` — speak/print to user
- `get_user_data()` — async, pulls next user message
- `get_var(id)` / `set_var(id, val)` — CortexRAM (cross-turn key/value)
- `get_embedding(text)` — vector embedding
- `handle_function_call({ name, parameters })` — recursive dispatch
- `run_cortex_output(output)` — execute a call chain
- `run_structured_completion({...})` — invoke the LLM directly
- `rerun_llm_with_output_format(...)`
- `build_system_message()`
- `cortex_functions` — all currently registered functions
- `get_context_status()` — tokens used/remaining
- `get_workspace()` / `update_workspace(patch)` — persisted workspace blob
- `feedback` — sounds (`error`, `activated`, `ok`, `success`)
- `collect_args(...)` / `resolve_args(...)` — `$N` and `@id` ref resolution

## Module shape

Type in `packages/cortex/src/system_context_manager.ts:17`. A typical functions-only module looks like:

```ts
export function createWebSearchModule() {
  return {
    id: 'search_functions',         // unique
    name: 'Search Functions',       // human label
    position: 45,                   // 0–100, ordering within the prompt
    functions: [
      {
        enabled: true,
        description: 'Searches the web via Google...',
        name: 'web_search',
        parameters: { query: 'string' },
        fn: async (ops: any) => {
          const { query } = ops.params
          const { log, event } = ops.util
          log(`Web search: "${query}"`)
          const { results } = await getBackend().tools.search({ query })
          event({ type: 'web_search', data: { query, result_count: results.length } })
          return results
        },
        return_type: 'object',
      },
    ],
  }
}
```

A module that also injects guidance into the system prompt adds a `system_msg` string — see `apps/smartchats/app/modules/data.ts:12` for an example (database access conventions).

### `position` convention

Roughly: 0–9 framing (intro, scoping), 10–29 core/data/logging, 30–49 mid-tier features (process, KG, todos, metrics, sessions), 50–69 UI/launchers, 70–99 conversational/onboarding. Look at the values used in sibling modules and pick a neighbor; nothing enforces this — it just controls prompt ordering.

## Registration

`apps/smartchats/app/cortex_agent_web.ts` is the agent's entry point. The pattern is:

```ts
import { createMyFeatureModule } from "./modules/my_feature"
// ...
scm.add_module(createMyFeatureModule())
```

That's all that wires a new tool in. The function shows up in the LLM's system prompt on the next `scm.build()` call (every turn).

If your module needs to know about Cortex or trigger a rebuild (rare — used by `app_launcher`), pass a late-bound ref; see `cortex_agent_web.ts:117–146`.

## Adding to an existing module vs. a new module

- **Tightly related to an existing feature area?** Add to that module's `functions[]`. Example: another search variant goes in `web_search.ts`.
- **New surface area?** New file. One module per conceptual feature keeps `position` and `system_msg` coherent. The 20+ existing modules in `apps/smartchats/app/modules/` are the model.

## Walkthrough: adding `get_weather`

1. Create `apps/smartchats/app/modules/weather.ts`:

   ```ts
   import { getBackend } from "@/lib/backend"

   export function createWeatherModule() {
     return {
       id: 'weather_functions',
       name: 'Weather Functions',
       position: 46,
       functions: [
         {
           enabled: true,
           description: 'Get current weather for a city. Returns temperature (C), conditions, humidity.',
           name: 'get_weather',
           parameters: { city: 'string' },
           fn: async (ops: any) => {
             const { city } = ops.params
             const { log, event } = ops.util
             log(`Weather lookup: "${city}"`)
             const data = await getBackend().tools.weather({ city })
             event({ type: 'weather_lookup', data: { city } })
             return data
           },
           return_type: 'object',
         },
       ],
     }
   }
   ```

2. In `apps/smartchats/app/cortex_agent_web.ts`, add the import (~line 34) and the registration (~line 106, near other function modules):

   ```ts
   import { createWeatherModule } from "./modules/weather"
   // ...
   scm.add_module(createWeatherModule())
   ```

3. Type-check: `npx smartchats-test build` (or `cd apps/smartchats && npm run type-check`).

4. Smoke-test in the running app: open the chat, ask "what's the weather in Berlin", confirm the function is invoked. Console: `window.COR.functions.map(f => f.name)` lists all registered tools and should include `get_weather`.

## Testing

There are **no unit tests** for tools in `packages/cortex/`. The convention is end-to-end via Simi workflows in `apps/smartchats/app/simi/workflows/`. If the tool is critical, add a workflow that prompts the agent to use it and asserts on the result (see `code_execution_flow`, `workspace_update_flow` for examples). For pure-logic helpers, regular unit tests in `__tests__/` next to the module work too — but most tools are I/O-bound and Simi is the better fit.

## Common patterns observed in existing modules

- **Backend calls**: `await getBackend().tools.<name>({...})` / `getBackend().data.query(...)` — never call Firebase or HTTP directly from a tool.
- **Telemetry — two distinct buses**:
  - `ops.util.addInsightEvent('<type>', { ...payload })` — writes directly to `insights_events`. Use for **session-analyzer / monitoring** signals (e.g. `voice_memo_saved`, `issue`, custom audit events). Silently no-ops if `insights` isn't configured.
  - `ops.util.event({ type, ... })` — fires on cortex's EventEmitter, picked up by `useOrchestrator.handleEvent`. Use for **UI state updates** the orchestrator + store need to react to (workspace_update, visualization_update, etc.). These ONLY land in insights if `handleEvent` has an explicit `case <type>:` that forwards via `insightsClient.addEvent(...)` OR a `store.handle<X>(evt)` action (the store is auto-instrumented).
  - **Anti-pattern**: using `ops.util.event` for telemetry that no orchestrator case handles → silent drop. Caught for `report_issue` (commit `bbbded8`) and `voice_memo_saved`.
- **Billing**: when a backend call returns a `billing` object, dispatch `new CustomEvent('smartchats:billing_update', { detail: billing })` on `window` (see `web_search.ts:19–23`).
- **Validation**: do it inline in the handler; return `{ error: '...' }` rather than throwing if the LLM is likely to recover.
- **UI side-effects**: read/write `window.__smartchats_<feature>__` bridges (see `appearance.ts:64` for the design-pack pattern).
- **Persistence across turns**: `ops.util.get_var/set_var` for KV, `ops.util.update_workspace(patch)` for structured.

## What NOT to do

- Don't add tools to `cortex_agent_web.ts` directly — there is no longer a `functions` array there. Use a module.
- Don't import the `Function` type and annotate the module return — the existing convention is plain object literals.
- Don't add JSON Schema to `parameters` — it's a prose-readable map for the LLM, not validation input.
- Don't call `scm.build()` yourself — Cortex calls it each turn.
- Don't mutate `coer.functions` after construction unless you're also rebuilding `function_dictionary` (see the `app_launcher` rebuild pattern if you genuinely need dynamic re-registration).

## File index

- `packages/cortex/src/types.ts:16` — `Function` interface
- `packages/cortex/src/system_context_manager.ts:17` — `ContextModule` interface
- `packages/cortex/src/system_context_manager.ts:145` — `build()` (how functions reach the prompt)
- `packages/cortex/src/cortex.ts:1027` — `build_function_util` (the `util` object)
- `packages/cortex/src/cortex.ts:1069` — `build_sandbox_context` (how tools become global async fns)
- `packages/cortex/src/cortex.ts:1474` — `handle_function_call` (dispatch)
- `apps/smartchats/app/cortex_agent_web.ts:81` — registration site
- `apps/smartchats/app/modules/` — every existing tool module
