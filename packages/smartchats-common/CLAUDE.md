# smartchats-common — shared utilities

Small toolbox package imported by everything else in the monorepo. Contains:

- `src/insights/` — OTel-shaped telemetry (events, traces, chains, scopes). **The main thing in here.**
- `src/logger.ts` — namespaced console logger (`get_logger({ id })`)
- `src/fp.ts`, `src/debug.ts`, `src/sounds.ts`, `src/is_browser.ts`, `src/m2f.ts` — single-purpose utilities

Most consumers reach in via `import { logger, insights } from 'smartchats-common'`.

---

# Insights — the telemetry API

OTel-shaped event tracking. Every event is a span: identity (`event_id`, `event_type`), context (`user_id`, `session_id`, `timestamp`), optional chain pointers (`parent_event_id`, `trace_id`), free-form `payload`, optional `tags[]` and `duration_ms`. Auto-batched, async-flushed, crash-safe.

## Files

| File | Contents |
|---|---|
| `src/insights/types.ts` | `InsightsEvent`, `InsightsConfig`, `AddEventOptions`, convenience data interfaces |
| `src/insights/client.ts` | `InsightsClient` (main class), `InsightsScope` (parallel-safe scoped tracer), id generators |
| `src/insights/createInsightStore.ts` | Zustand factory that auto-instruments every store action as an `action` event |
| `src/insights/index.ts` | Re-exports `./client` (which already re-exports `./types`) |

## Consumers

- **App-level provider**: `apps/smartchats/src/context/InsightsContext.tsx` — instantiates `InsightsClient`, wires it to `SmartChatsBackend.insights.emit` / `terminalEmit`, exposes `useInsights() → { client, sessionId, isReady }`, installs `window` error + unload listeners.
- **Stores**: `apps/smartchats/app/store/useSmartChatsStore.ts`, `apps/smartchats/src/stores/billing_store.ts` — built with `createInsightStore`. Each action auto-emits an `action` event with `duration_ms`, `args`, `result`, `status`.
- **Direct emits**: `app/lib/storage.ts`, `app/hooks/useOrchestrator.ts`, `app/hooks/usePipelineTelemetry.ts`, `packages/simi/src/runner.ts`, `packages/smartchats-common/src/app_data_store.ts`.

## Event shape

```ts
{
  event_id: 'evt_<timestamp36>_<rand>',
  event_type: 'cortex_settings_loaded',          // snake_case, free-form
  app_name: 'smartchats',
  app_version: '1.0.0',
  user_id: 'smartchats_user' | '<uid>|<email>|<name>',
  session_id: 'ses_<...>',
  timestamp: 1717966823000,                       // Date.now()
  parent_event_id?: '<event_id>',                 // chain parent (auto from stack)
  trace_id?: 'trc_<...>',                         // groups one logical interaction
  payload: { ...arbitrary },
  tags?: ['latency', 'pipeline'],                 // free-form strings
  duration_ms?: 142,
  client_info?: { user_agent, viewport_size, firebase_uid?, firebase_email?, firebase_display_name? }
}
```

## Public API surface

### `InsightsClient`

```ts
new InsightsClient({
  app_name, app_version, user_id,
  session_id?,           // generated if omitted
  emit?,                 // (events) => Promise<{success, events_received, events_stored, errors?}>
  terminalEmit?,         // sync, fire-and-forget (fetch+keepalive / sendBeacon)
  endpoint?,             // fallback URL when `emit` not injected (POST {events})
  batch_size?,           // default 50 — auto-flush when reached
  batch_interval_ms?,    // default 5000 — auto-flush timer
  enabled?,              // default true
  manual_flush?,         // default false; smartchats-app sets TRUE
})

addEvent(type, payload, { tags?, parent_event_id?, trace_id?, duration_ms? }) → Promise<event_id>
startChain(type, payload) → Promise<event_id>          // sets trace_id; pushes onto chain stack
endChain()                                              // pops
addInChain(type, payload, options)                      // = addEvent (auto-uses chain stack)
addLLMInvocation(data)                                  // auto-tags 'error' / 'slow' (latency_ms > 5000)
addExecution(data)                                      // auto-tags 'error' / 'slow' (duration_ms > 10000)
addUserInput(data)
addSessionTags(tags[])                                  // tags the whole session
flushBatch() → Promise<void>                            // drains in-memory batch via injected emit
flushTerminal()                                         // SYNC — for unload/crash; do not await
shutdown() → Promise<void>                              // stop timer + final flush
exportSession() → { session_id, app_name, tags, events, exported_at }
setEnabled(boolean)
createScope({ name, metadata?, tags? }) → InsightsScope
```

### `InsightsScope` — parallel-safe child tracer

Owns its own `trace_id` + chain stack, writes to the parent's shared batch. Use when you fan out (e.g., a workflow that spawns sub-tasks you want independently traced). Emits `scope_start` on construction; call `.end()` to emit `scope_end` with `duration_ms`.

```ts
const scope = client.createScope({ name: 'boot_sequence', tags: ['boot'] });
await scope.addEvent('phase_start', { phase: 'auth' });
// ...
scope.end();
```

### `createInsightStore<T>({ appName, silent?, workflows?, creator })`

Zustand wrapper. Pass actions in `creator(set, get, api, insights)`. Every function-valued returned field is wrapped:

- Sync actions emit `action` synchronously after the call returns
- Async actions emit `action` after the promise settles
- Payload: `{ app, action, kind: 'sync'|'async', args, result, duration_ms, status: 'ok'|'error', error? }`
- `silent: ['actionName']` opts an action out of instrumentation (use for hot-path or noisy actions: `checkAuth`, `handleStreamChunk`, etc.)
- `insights.emit(type, payload)` inside the creator → direct event (auto-prefixed with `app: appName`)
- `insights.getClient()` → raw `InsightsClient` (use for `addEvent` with `tags` or `duration_ms`)
- Late-binding: `useStore.setInsights(client)` after `InsightsClient` mounts
- Bridges to `window.__${appName}__` with `getState`, `dispatch`, and compiled `simi.workflows` for Playwright

## Conventions

**Event names** — `snake_case`. Lifecycle markers in past tense (`settings_loaded`, `agent_init_success`); operational events in present tense or noun-form (`tts_playback_timing`, `runtime_error`). Prefix by subsystem when names could collide (`cortex_settings_loaded`, `tts_stream_first_chunk`).

**Standard payload fields** — reuse names that already exist so dashboards aggregate cleanly:

| Field | Meaning |
|---|---|
| `duration_ms` | Elapsed time for the event (also accepted in `options` and surfaced to the top-level event) |
| `ok` | boolean — operation success |
| `status` | `'success' \| 'error' \| 'idle' \| 'running' \| ...` (free-form) |
| `mode` | `'voice' \| 'text' \| 'cloud' \| 'local' \| ...` |
| `source` | who/what triggered it (`'cloud'`, `'local'`, `'user'`) |
| `error` / `error_message` / `error_code` | error details |
| `phase` | sub-step inside a chain (`'auth_wait'`, `'agent_init'`, `'warmup'`) |

**Tags in use** (free-form, no enum):

- `'latency'`, `'pipeline'`, `'tts'`, `'voice'`, `'speech_recognition'`, `'experiment'`, `'boot'`
- `'error'` — auto-applied by `addLLMInvocation`/`addExecution` on error status
- `'slow'` — auto-applied when `latency_ms > 5000` (LLM) or `duration_ms > 10000` (exec)
- `'simi'`, `<workflow.app>`, `<workflow.id>` — auto-applied by simi runner

**Duration idiom**:

```ts
const start = performance.now();             // or Date.now() for >ms accuracy needs
try {
  const result = await op();
  client.addEvent('op_complete', { ok: true, /* ... */ }, {
    duration_ms: Math.round(performance.now() - start),
  });
} catch (err: any) {
  client.addEvent('op_complete', { ok: false, error: err?.message }, {
    duration_ms: Math.round(performance.now() - start),
    tags: ['error'],
  });
  throw err;
}
```

For a paired start/end with a chain, prefer `startChain` → emit child events → `endChain`. The `trace_id` lets the backend stitch them into a flame graph.

## Lifecycle & batching

- Default mode: auto-flush every `batch_interval_ms` (5 s) or when `batch_size` (50) is reached.
- `smartchats` app sets `manual_flush: true` and flushes explicitly:
  - after each Simi workflow run (in `createInsightStore`)
  - on TTS queue drain (`useOrchestrator.onQueueDrain`)
  - on `pagehide` / `visibilitychange='hidden'` → `flushTerminal()` (sync, keepalive transport)
  - on global `error` / `unhandledrejection` → emit `runtime_error` + immediate `flushTerminal()`
- `flushBatch()` is silent on failure — events go back into the queue (capped at 2× batch_size).
- `flushTerminal()` MUST NOT be awaited. It hands the batch to the backend's keepalive emitter and returns synchronously.

## Backend routing

`InsightsContext.tsx` injects `emit` and `terminalEmit` that go through `getBackend().insights.*`. The client itself stays backend-agnostic. The default backend POSTs `{ events }` to `/api/insights/batch` (or whatever the local server / cloud routes to).

## Where events land for analysis

Two stores:

1. **Server-side**: whatever the backend's `insights.emit` writes to (Surreal `events` table for the cloud backend; same shape locally).
2. **Client-side cumulative log**: `sessionEvents[]` inside `InsightsClient` — never cleared by `flushBatch`. Pull via `client.exportSession()` or `window.smartchatsInsights.exportSession()`. Used by `bin/save_session` to bundle a full session for offline triage in `packages/smartchats-sessions/`.

## Debugging from the console

```js
window.smartchatsInsights                            // the InsightsClient
window.smartchatsInsights.getSessionId()
window.smartchatsInsights.exportSession()            // all events this session
window.smartchatsInsights.addEvent('manual_marker', { note: 'hi' })
window.smartchatsInsights.flushBatch()
```

## Adding a new event — checklist

1. Pick a name: `subsystem_action_outcome` in `snake_case`.
2. Decide payload — reuse `duration_ms`, `ok`, `status`, `mode`, `source` where they fit.
3. If it's part of a logical flow, wrap it in `startChain`/`endChain` (or a `Scope`) so it joins a `trace_id`.
4. If it's a paired start/end, stamp the start time once and emit `*_complete` with `duration_ms`.
5. If it's user-perceivable latency, tag it `['latency', '<subsystem>']`.
6. Register it in `apps/smartchats/CLAUDE.md` § Telemetry so future readers can find it.

## What NOT to do

- Don't await `flushTerminal()` — it returns void by contract.
- Don't `addEvent` with PII unless you've checked the backend pipeline. `user_id` and `client_info.firebase_*` are already attached automatically.
- Don't truncate stack traces inside payload to 0 bytes — the `runtime_error` path caps at 4 KB for a reason; copy that pattern.
- Don't create a new client per component. There's one per `InsightsProvider`, exposed via `useInsights()` and `window.smartchatsInsights`.
- Don't emit inside a tight loop without batching — every event is a network event eventually. Aggregate first, emit once.
