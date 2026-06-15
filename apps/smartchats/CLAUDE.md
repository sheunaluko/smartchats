# SmartChats - Standalone Voice AI Agent with Billing

## Quick Orientation
- Entry: `app/page.tsx` → `InsightsProvider(appName="smartchats")` → dynamic import of `app3.tsx` (SSR disabled)
- Main component: `app/app3.tsx` — thin UI shell: auth, tivi wiring, widget grid, settings auto-save (432 lines)
- Store: Zustand store in `app/store/useSmartChatsStore.ts` via `createInsightStore` — key state lives here
- Billing store: `src/stores/billing_store.ts` via `createInsightStore` — credit balance, tiers, BYO keys
- Agent config: `app/cortex_agent_web.ts` — `get_agent()`, SystemContextManager (SCM) wiring of all module factories from `app/modules/`
- Agent engine: `packages/cortex/src/cortex.ts` — LLM loop, function execution, provider routing
- Agent modules (tools + system-prompt fragments): `app/modules/*.ts` — see `app/modules/tool_creation_skill.md` for how to add one
- Orchestrator: `app/hooks/useOrchestrator.ts` — event dispatch, voice lifecycle, TTS telemetry (515 lines)
- Hooks: `app/hooks/` — useOrchestrator, useStreamBuffers, usePipelineTelemetry, useChatMode, useCortexAgent, useWidgetConfig
- Components: `app/components/` — TopBar, SettingsPanel, ChatModeView, FullscreenWidget, DraggableWidgetGrid, SessionBrowser, AudioVisualization, VoiceStatusIndicator
- Storage: `app/lib/storage.ts` — AppDataStore singleton (`getCortexStore()`, app_id='smartchats')
- Auth: `app/lib/authCheck.ts` — Firebase auth with email/Google/anonymous, cloud auth checks
- Billing pages: `app/settings/billing/` — tier cards, credit packs, BYO keys, usage table
- Simi workflows: `app/simi/` — 18 core workflows + 4 billing workflows
- Background loaders: `app/lib/background_loaders/` — generic prefetch-with-shared-promise pattern for 7 startup items
- Greeting service: `app/lib/greeting/` — 15 time-aware templated variants for the LLM-bypass first-audio path (see `app/lib/greeting/README.md`)
- **Startup + first-turn flow (read for any init/TTFA work):** `apps/smartchats/startup_reference.md` — full timeline (page-load → boot → click → first audio), event flow, "what to grep for if you need to extend X"
- Full architecture: `smartchats_architecture_guide.md`

## Commands
- Dev server: `npm run dev` (port 3000) — requires Node 24+
- Type check: `npm run type-check`
- Build: `npm run build` (prebuild via `scripts/prebuild.mjs` — cross-platform Node, replaces the old Bash-flavored npm scripts so Windows CI works. Subcommands: `site`, `assets`, `cleanup-onnx`, `all`)
- E2E: `bin/test-e2e` from repo root — boots bin/test-bun-deploy, auto-bootstraps `.auth/test-profile/` via `setup-test-profile.spec.ts` if missing, runs the simi suite in parallel against the bun stack, tears down cleanly. bin/test-bun-deploy auto-detects stale builds (any source under `apps/smartchats` or `packages/*/src` newer than `apps/smartchats/out/app.html` triggers a rebuild); pass `--no-rebuild` to skip the check, `--rebuild` to force one.

## Key Patterns

### Initialization Order (matters)

> Full chronological timeline with telemetry events at each step: `apps/smartchats/startup_reference.md`.

1. `InsightsProvider` wraps everything (from `page.tsx`); opens `boot_start` chain on isReady
2. `app3.tsx` mounts, gets `insightsClient` via `useInsights()`; stamps `app3_mounted`
3. `useSmartChatsStore.setInsights(insightsClient)` — late-binding (also useBillingStore, classifier)
4. `store.loadSettings()` — resolves storage backend, runs auth check, migration
5. `useCortexAgent()` creates agent (with USE_STREAMING flag); emits `agent_init_success` with `duration_ms`
6. `useTivi()` initializes voice (ref-based telemetry callbacks); ONNX VAD model not loaded yet
7. `useOrchestrator()` wires: `COR.on('event', handleEvent)`, `COR.configure_user_output(addAiMessage)`, `store.setAgent(COR)`
8. `useEffect` wires orchestrator telemetry callbacks to tivi refs
9. Once `authUser && COR` ready: `createStartupLoaders()` + `prefetchAll()` — fires 7 background prefetches (see "Background Loaders" pattern below)
10. Warmup useEffect: `runner.warmup()` + `warmupBackendTts()` + `tivi.warmupVAD()` in parallel; closes `boot_start` chain after Promise.allSettled → `boot_complete`
11. `useBillingStore.fetchBalance()`
12. Window globals exposed (`window.COR`, `window.tsw`, `window.__smartchats__`, `window.cortexInsights`)

### First-Turn Flow (changed 2026-06-11)

The agent's first audible message is now LLM-bypassed — a templated string +
direct TTS. See `apps/smartchats/startup_reference.md` for the full
timeline. Summary:

- **Page load → app mount**: boot chain opens, loaders + warmup probes fire in parallel.
- **User clicks Start**: `useOrchestrator.handleStartStop` peeks `loaders.user_kg_shallow` for the name, picks a template via `lib/greeting/getGreeting()`, pushes to `tivi.ttsQueue.speakText()`, and injects the spoken text as an `assistant` message in `agent.messages`. `runLlm()` is NOT called here.
- **User speaks**: `sendMessageSync(text)` adds the user message and fires `runLlm()` — that's the first actual LLM call. The agent sees `[assistant: <greeting>, user: <text>]` and responds.
- **If KG hasn't resolved by click time**: the no-name greeting variant is used. Never falls back to the old LLM-on-Start path.

### Background Loaders (`app/lib/background_loaders/`)

Generic prefetch-with-shared-promise-memoization primitive for everything
that used to be in the old `prefetchStartup()`. Each loader exposes:

- `prefetch()` — fire-and-forget, idempotent
- `get()` — returns the in-flight promise (agent function calls share the prefetch)
- `peek()` — synchronous read; `undefined` if not yet resolved
- `reset()` — for tests
- `onResolve(value, { fromPrefetch })` — auto-injects into agent context

Seven loaders, all wired in `createStartupLoaders()`:
`user_kg_shallow` (depth-1), `todos_context`, `metrics_context`,
`log_categories`, `init_instructions`, `procedural_instructions`,
`installed_apps`. Each emits `bg_load_start` / `bg_load_complete`
insights events with `id` + `duration_ms` + `source: 'prefetch' | 'on_demand'`.

The first turn does **not block** on any loader. Whatever's resolved at
LLM-call time is in context; the rest streams in via `onResolve` between
turns. Module function fns (`get_metrics_context`, `initialize`, etc.)
route through `getStartupLoaders()?.X.get()` so they share the prefetch
promise — no duplicate roundtrip.

### Templated Greeting (`app/lib/greeting/`)

15 time-aware template variants (3 per bucket: morning/afternoon/evening/night/neutral),
each with both name and no-name forms. Pure functions (`getGreeting(ctx)`).
Used by `useOrchestrator.handleStartStop` to produce the first audible
line without an LLM call. `lib/greeting/README.md` documents adding
variants. Anti-repeat memory in localStorage (`smartchats.greeting.last_template_ids`).

### Store Architecture (useSmartChatsStore)
- Built with `createInsightStore` — auto-instruments all actions with insight events
- Config: `{ appName: 'smartchats', silent: ['checkAuth', 'captureExecutionSnapshot', 'setAgent', 'handleStreamChunk', 'handleStreamEnd', 'handleProcessOutput'], workflows: cortexWorkflows }`
- **Auth state**: `isAuthenticated`
- **Settings** (persisted): `aiModel` (default `'gpt-5.5'`), `speechCooldownMs`, `soundFeedback`
- **Chat**: `chatHistory`, `lastAiMessage`
- **Workspace**: `workspace` (Record<string, any>)
- **Observables** (not persisted): `thoughtHistory`, `logHistory`, `htmlDisplay`, `codeParams`, `contextUsage`
- **Execution state**: `currentCode`, `executionId`, `executionStatus`, `executionError`, `executionDuration`, `executionResult`, `functionCalls`, `variableAssignments`, `sandboxLogs`, `executionHistory` (max 100), `selectedIndex`, `isPinned`
- **Knowledge Graph**: `kgGraphData`, `kgAutoDisplay`, `kgMode` ('accumulate'|'replace'), `kgDepth`, `kgVisibleRelationKinds`, `kgAvailableRelationKinds`, `kgIsSearching`
- **Voice state** (not persisted, set by orchestrator): `started`, `transcribe`, `interimResult`, `voiceStatus`
- **Background Processes**: `processes`, `processOutputs`, `agentMonitorStates`
- **Stream Viewer**: `streamChunks`
- **Agent + LLM**: `agent`, `llmRunning`, `_pendingRerun` + key actions: `sendMessageSync`, `sendMessageAsync`, `runLlm`, `triggerParentRerun`
- **UI state in app3.tsx** (useState): `mode`, `settingsOpen`, `sessionsOpen`, `focusedWidget`, `speechQueueState`
- Auto-save: debounced 2s after `chatHistory`, `workspace`, or settings changes

### Hooks Architecture
- **useOrchestrator** (`hooks/useOrchestrator.ts`, 515 lines) — event dispatch hub via `handleEvent` switch, voice lifecycle (`handleStartStop`), transcription routing (`transcriptionCb`), TTS telemetry callbacks (`onQueueFirstUtterance`, `onQueueDrain`). Composes `usePipelineTelemetry` + `useStreamBuffers` internally.
- **useStreamBuffers** (`hooks/useStreamBuffers.ts`, 178 lines) — 3-tier throttled buffering: response chunks (100ms) → chatHistory, thought chunks (100ms) → thoughtHistory, stream chunks (200ms) → streamChunks
- **usePipelineTelemetry** (`hooks/usePipelineTelemetry.ts`, 95 lines) — pipeline timestamp bag (`pipelineTs` ref), `stamp`/`stampFirst`/`resetTimestamps`, `emitVoiceComplete` with duration calculations
- **useChatMode** (`hooks/useChatMode.ts`, 63 lines) — text chat input state, typing indicator, routes sends through `transcriptionCb` (shared path with voice)
- **useCortexAgent** (`hooks/useCortexAgent.ts`, 48 lines) — agent init wrapper, creates Cortex agent via `cortex_agent.get_agent()`
- **useWidgetConfig** (`hooks/useWidgetConfig.ts`, 155 lines) — widget visibility, layout persistence, presets (default/focus/development/debug/minimal)

### Components Architecture
8 extracted components in `app/components/`:
- **TopBar** — control bar: mode toggle, model selector, voice controls, session save, credits
- **SettingsPanel** — Drawer with widget toggles, tivi settings, calibration, voice selector
- **ChatModeView** — text chat UI with message list, input, typing indicator
- **FullscreenWidget** — fullscreen overlay + `renderWidget()` switch for all 13 widget types
- **DraggableWidgetGrid** — react-grid-layout container for widget drag/drop/resize
- **SessionBrowser** — session save/load browser drawer
- **AudioVisualization** — audio level visualization bar
- **VoiceStatusIndicator** — voice state display (idle/listening/processing/speaking)

### Billing (useBillingStore)
- Built with `createInsightStore({ appName: 'smartchats_billing' })`
- **State**: `tier` (free/intro/basic/pro/max), `tierName`, `periodCredits`, `purchasedCredits`, `totalAvailable`, `monthlyCredits`, `periodStart`, `periodEnd`, `discountPercent`, `byoKeys` (openai/anthropic/google), `usageRecords`, `isLoading`, `error`
- **Actions**: `fetchBalance()`, `fetchUsage()`, `updateFromLLMResponse(billing)`, `saveBYOKeys(keys)`, `deleteBYOKey(provider)`
- **Firebase Cloud Functions**: `getBalance`, `getUsage`, `purchaseCredits`, `createSubscription`, `manageSubscription`, `saveBYOKeys`, `deleteBYOKey`
- **Real-time updates**: `cloudLLMCall` dispatches `smartchats:billing_update` custom event after each LLM call; billing store listens and updates credits without full refetch
- **Tiers**: free ($0, 1K credits), intro ($10/mo, 7.5K), basic ($20/mo, 16K), pro ($50/mo, 42.5K), max ($100/mo, 90K)
- **Credit packs**: $5 (2.5K), $10 (5K), $20 (10K), $50 (25K)
- **BYO keys**: openai, anthropic, google — stored server-side, masked preview shown to user

### Storage (AppDataStore Integration)
- Singleton: `getCortexStore()` in `app/lib/storage.ts` — scoped to `app_id='smartchats'`
- Data keys: `settings`, `conversations`, `widget_layout`, `sessions` (defined in `CORTEX_DATA_KEYS`)
- Backend mode: persisted in `appdata::smartchats::__backend_mode__` localStorage flag
- **Default mode: cloud** — new users start in cloud mode so auth check prompts them to log in or switch to local
- Legacy migration from `cortex_widget_config` / `cortex_widget_layout` keys (flag-gated)

### Auth (lib/authCheck.ts)
- `isFirebaseAuthenticated()` — sync check via `getAuth().currentUser`
- `waitForFirebaseAuth(timeoutMs)` — awaits `onAuthStateChanged` before cloud queries
- `checkCloudAuth()` — returns `{ isCloudMode, isAuthenticated, needsAttention }`
- `notifyCloudAuthRequired(context, emitFn)` — debounced toast (30s) with LOG IN / USE LOCAL / Dismiss
- `LoginModal` (`src/components/LoginModal.tsx`) — Google popup, email/password sign-in/up, anonymous. Exposed via `window.openLoginModal()`
- Agent receives `authInfo` — system message changes based on login state

### LLM Integration
- `cloudLLMCall()` (`src/lib/llm_client.ts`) — calls Firebase `llmCall` Cloud Function directly (no Vercel proxy)
- Response includes `billing` sub-object → dispatched as `smartchats:billing_update` event
- Injected into Cortex engine as `llmCallFn` in `get_agent()`
- Provider routing handled server-side by `ts_node/apis/llm_service`

### Voice Pipeline (Tivi)
- Imported from `@lab-components/tivi` (shared ts_next_app component)
- `useTivi` hook with `ttsCallFn: firebaseTTSCallFn` — TTS via Firebase `ttsCall` Cloud Function (OpenAI TTS)
- TTS bridge: `src/lib/tts_bridge.ts` — wraps Firebase `ttsCall` httpsCallable
- VAD: ONNX silero model (`silero_vad_v5.onnx`) loaded from `public/onnx/`
- Preloaded acknowledgement audio buffers for fast conversational responses
- **Streaming pipeline**: Mic → VAD → Speech Recognition → `orchestrator.transcriptionCb` → cooldown + cancel detection → `sendMessageSync` → LLM streams → orchestrator dispatches to buffers + TTS queue → telemetry stamps → `voice_interaction_complete`
- **Non-streaming fallback**: same input path → `runLlm` → `user_output` callback → `addAiMessage` → `tivi.speak`
- **Process idle flow**: `process_idle` → `processManager.queueIdle` → batched flush on `code_execution_complete`/`turn_complete`

### Sandbox (Secure JS Execution)
- `app/src/IframeSandbox.ts` — iframe-based isolation with proxy membrane
- Persistent iframe reused across executions, `sandbox="allow-scripts"` (no `allow-same-origin`)
- Tracks: function calls, variable assignments, console output
- API: `evaluateJavaScriptSandboxed()`, `resetSandbox()`, `destroySandbox()`
- Singleton via `getExecutor()`

### Widget System
13 draggable widgets in `app/widgets/`, rendered via `DraggableWidgetGrid` (react-grid-layout):

| Widget | File | Purpose |
|--------|------|---------|
| Chat | `ChatWidget.tsx` | Message display (`chatHistory`) |
| Text Input | `ChatInputWidget.tsx` | Text/voice input |
| Thoughts | `ThoughtsWidget.tsx` | Agent reasoning (`thoughtHistory`) |
| Log | `LogWidget.tsx` | System logging (`logHistory`) |
| Code | `CodeWidget.tsx` | Display generated code (`codeParams`) |
| HTML | `HTMLWidget.tsx` | Render HTML output (`htmlDisplay`) |
| Workspace | `WorkspaceWidget.tsx` | Object inspector (`workspace`) |
| Code Execution | `CodeExecutionWidget.tsx` | Running code state |
| Function Calls | `FunctionCallsWidget.tsx` | Function invocation tracking |
| Variables | `VariableInspectorWidget.tsx` | Variable assignment tracking |
| Sandbox Logs | `SandboxLogsWidget.tsx` | Console output tracking |
| Execution History | `HistoryWidget.tsx` | Time-travel through past executions |
| Knowledge Graph | `KnowledgeGraphWidget.tsx` | sigma.js graph visualization |

Layout presets: `default`, `focus`, `development`, `debug`, `minimal`

### Knowledge Graph
- `app/graph_utils.ts` — entity-relation-entity triples, semantic search
- Visualization via `@lab-components/graph_viz` (sigma.js + graphology)
- Modes: `accumulate` (merge new data) or `replace` (clear + set)
- Configurable depth and relation kind filtering

### Simi Workflows
18 core workflows + 4 billing workflows, wired into store via `createInsightStore` config.

**Core workflows** (`app/simi/workflows/`):
- `basic_chat_flow` — sends message, waits for AI response (tags: `smoke`, `chat`)
- `full_conversation_flow` — multi-turn chat, saves/lists sessions (tags: `e2e`, `chat`, `session`)
- `settings_persistence_flow` — update → save → overwrite → reload → assert originals (tags: `smoke`, `settings`, `persistence`)
- `session_save_load_flow` — send → save → clear → load → assert restored (tags: `e2e`, `session`, `persistence`)
- `code_execution_flow` — prompt agent to write + run code → assert results (tags: `e2e`, `code`, `sandbox`, `execution`)
- `multi_turn_context_flow` — 4-turn conversation verifying context retention (tags: `e2e`, `chat`, `context`)
- `workspace_update_flow` — prompt agent to store workspace data (tags: `e2e`, `workspace`)
- `html_display_flow` — prompt agent to render HTML (tags: `e2e`, `html`)
- `stress_conversation_flow` — rapid multi-message stress test
- `auth_guard_flow` — auth state detection and guard behavior
- `storage_mode_switch_flow` — switch between local/cloud storage modes
- `model_switch_flow` — switch AI model during session
- `knowledge_graph_flow` — store + retrieve knowledge graph data
- `kg_settings_flow` — knowledge graph settings (mode, depth, filters)
- `clear_and_resume_flow` — clear chat and resume
- `session_management_flow` — full session save/load/list lifecycle
- `rapid_message_flow` — rapid-fire message sending
- `execution_history_nav_flow` — navigate execution history (pin, select, unpin)

**Billing workflows** (`app/simi/billing_workflows/`):
- `balance_fetch_flow` — fetch and verify credit balance
- `usage_fetch_flow` — fetch and verify usage records
- `byo_key_lifecycle_flow` — save, verify, delete BYO API key
- `byo_key_multi_provider_flow` — multi-provider BYO key management

Bridge: `window.__smartchats__.simi.workflows.NAME(opts?)`
List: `window.__smartchats__.simi.list()`
Speed: `{ speed: 5 }` runs 5x faster

## Schema: event-time convention (ts / local_date / local_tz)

Every event-time table carries two distinct timestamp concepts that must not be conflated:

- **`created_at` / `updated_at`** — physical row lifecycle in *this* database. DB-stamped via `VALUE time::now() READONLY`. Authoritative for audit, GC, debugging. **Never user-supplied. Never migrated across DBs.** The MCP import tool strips both fields unconditionally on every payload.

- **`ts` / `local_date` / `local_tz`** (event-time triple) — when the *thing this row represents* actually happened in the user's life:
  - `ts: datetime` — real-UTC instant (no timezone trickery)
  - `local_date: string` — `YYYY-MM-DD` as the user perceived it in their tz, precomputed so SurrealDB `GROUP BY local_date` does daily aggregation correctly with no tz logic at query time
  - `local_tz: string` — IANA zone the user was in when the event happened (e.g. `America/Chicago`)

  All three are app-stamped at write time via `nowEventTime()` in `app/modules/system.ts`. **Preserved across export, import, replication, migration.** UI sorts/filters by `ts` for "when did it happen" and `local_date` for "what day did the user think it was."

Strict event-time tables (`ts` REQUIRED): `logs`, `sessions`, `metrics`, `user_entities`, `user_relations`, `events`. `user_data` is mixed-shape — event-time triple is OPTIONAL because config rows (`metric_definition`, `log_category_definition`) don't have an event-time concept.

New writes use the canonical pattern:

```ts
const eventTime = nowEventTime()  // { ts, local_date, local_tz }
// ... INSERT INTO table { ..., ...eventTime }
```

Server-side writes (e.g. `usage_records` from the local server) stamp `ts = time::now()` with `local_tz = 'UTC'` since the server has no user-tz context. Acceptable because usage records aren't migrated cross-database.

Schema source-of-truth: `packages/smartchats-database/src/schema/local.ts`. Schema-change history: `HISTORY.md` at the repo root.

## Shared Code from ts_next_app
SmartChats imports from ts_next_app via path aliases configured in `tsconfig.json` and `next.config.mjs`:

**`@lab-components/*`** → `../ts_next_app/app/laboratory/components/*`:
- `tivi/lib/index` — `useTivi` voice hook
- `tivi/lib/useTiviSettings` — voice settings hook
- `tivi/lib/tts_acknowledgements` — `preloadAcknowledgements`, `getAckBuffer`, `ACK_TYPES`, `AckType`
- `tivi/VADMonitor` — VAD monitoring component
- `tivi/CalibrationPanel` — audio calibration UI
- `tivi/VoiceSelector` — voice selection UI
- `graph_viz` / `graph_viz/lib/types` — `KGGraphData`, `KGNode`, `GraphMode`
- `graph_viz/lib/graph-utils` — `mergeGraphData`, `extractRelationKinds`
- `graph_viz/lib/adapter` — `searchResultToGraphData`, `flatSearchResultToGraphData`, `triplesToGraphData`

**`@shared-lib/*`** → `../ts_next_app/src/lib/*`:
- `createInsightStore` — Zustand factory with auto-instrumentation
- `app_data_store` — `AppDataStore`, `LocalStorageBackend`, `SurrealBackend`
- `simi` — `defineWorkflow`

## Telemetry (Insight Events)

> The table below is a lookup keyed by event_type. For the same events
> shown in chronological flow order (page-load → boot → click → first
> audio → first turn complete), see `apps/smartchats/startup_reference.md`.

| Event | Source | Payload | Tags |
|-------|--------|---------|------|
| `boot_start` (chain) | `InsightsContext.tsx` | `app_version`, `is_authenticated_at_start` | — |
| `app3_mounted` | `app3.tsx` | `time_since_boot_start_ms` | `boot` |
| `cortex_store_init` | `storage.ts` | `bootstrap`, `resolved_mode`, `is_new_instance`, `cloud_upgraded`, `duration_ms` | — |
| `cortex_legacy_migration` | `useSmartChatsStore.ts` | `migrated`, `skipped`, `duration_ms` | `boot` |
| `auth_ready_wait` | `useSmartChatsStore.ts` | `mode`, `resolved`, `timed_out`, `duration_ms` | `boot`, `latency` |
| `cortex_settings_loaded` | `useSmartChatsStore.ts` | `source`, `had_migration`, `raw_stored`, `merged` | — |
| `cortex_settings_loaded_complete` | `useSmartChatsStore.ts` | `mode`, `isAuthenticated`, `duration_ms` (whole loadSettings) | `boot` |
| `agent_init_success` / `agent_init_error` | `useCortexAgent.ts` | `model`, `useStreaming`, `duration_ms` | `boot`, `latency` |
| `runner_warmup_complete` | `app3.tsx` | `ok`, `duration_ms`, `error?` | `boot`, `warmup`, `latency` |
| `tts_warmup_complete` | `app3.tsx` | `ok`, `duration_ms`, `error?` | `boot`, `warmup`, `latency` |
| `vad_warmup_complete` | `app3.tsx` | `ok`, `duration_ms`, `cached`, `error?` | `boot`, `warmup`, `latency` |
| `startup_prefetch_complete` | `app3.tsx` | `ok`, `duration_ms` (= time-to-greeting-name-ready — only awaits `user_kg_shallow`) | `boot`, `warmup`, `latency` |
| `boot_complete` (closes chain) | `app3.tsx` | `total_duration_ms`, `phases: { runner_warmup_ms, tts_warmup_ms, vad_warmup_ms, prefetch_ms }`, `all_probes_ok` | `boot`, `latency` |
| `bg_load_start` | `lib/background_loaders/loader.ts` | `id` (one of: `user_kg_shallow`, `todos_context`, `metrics_context`, `log_categories`, `init_instructions`, `procedural_instructions`, `installed_apps`), `source` (`prefetch` \| `on_demand`) | `boot`, `bg_load` |
| `bg_load_complete` | `lib/background_loaders/loader.ts` | `id`, `ok`, `source`, `duration_ms`, `error?` | `boot`, `bg_load`, `latency` (or `error` on failure) |
| `voice_session_start` (chain) | `useOrchestrator.ts` | `cold_start`, `time_since_boot_complete_ms` | — |
| `voice_session_templated_greeting` | `useOrchestrator.ts` | `template_id`, `time_bucket` (`morning`\|`afternoon`\|`evening`\|`night`\|`neutral`), `has_name`, `duration_ms` (click → TTS-queue-push), `cold_start` | `latency`, `ttfa`, `templated` |
| `voice_first_llm_call_start` | `useSmartChatsStore.ts` | `chat_history_len`, `cold_start`, `duration_ms` (since voice_session_start — note: post-2026-06-11 this fires when the user speaks, not on Start click) | `boot`, `latency`, `ttfa` |
| `voice_first_llm_call_first_chunk` | `useOrchestrator.ts` | `cold_start`, `duration_ms` (click → first response_chunk emit) | `latency`, `ttfa` |
| `voice_session_audio_ready` | `useOrchestrator.ts` | `cold_start`, `duration_ms` (click → mic ready), `audio_init_ms` | `latency`, `ttfa` |
| `voice_session_first_audio` | `useOrchestrator.ts` | `cold_start`, `duration_ms` (click → first TTS chunk — TTFA) | `latency`, `ttfa` |
| `voice_session_first_turn_complete` (closes chain) | `useOrchestrator.ts` | `cold_start`, `time_to_first_turn_complete_ms` | `latency`, `ttfa` |
| `voice_session_stop` | `useOrchestrator.ts` | — | — |
| `llm_server_timing` (always-on) | `llm_tts_stream_http.ts` → `llm_caller.ts` → `useOrchestrator.ts` | `phase` (`llm_function_received` \| `llm_request_start` \| `llm_first_byte`), `ts` (Date.now() server-side), `ms_since_function_received`, `ms_since_request_start` | `latency`, `llm`, `ttfa` |
| `client_stream_timing` (always-on) | `llm_caller.ts` → `useOrchestrator.ts` | `phase` (`stream_request_dispatched` \| `stream_response_headers_received` \| `first_event_received` \| `first_text_pushed`), `ts` (performance.now() — monotonic, not wall clock), `ms_since_voice_session_start`, `cold_start` | `latency`, `client`, `ttfa` |
| `cortex_settings_updated` | `useSmartChatsStore.ts` | `changed_keys`, `before`, `after` | — |
| `cortex_settings_saved` | `useSmartChatsStore.ts` | `ok`, `mode`, `settings` | — |
| `cortex_conversation_loaded` | `useSmartChatsStore.ts` | `chat_length`, `has_workspace` | — |
| `cortex_session_saved` | `useSmartChatsStore.ts` | `sessionId`, `label` | — |
| `cortex_session_loaded` | `useSmartChatsStore.ts` | `sessionId` | — |
| `cloud_auth_required` | `authCheck.ts` | `context` | — |
| `cloud_auth_action` | `authCheck.ts` | `action` (`switch_to_local`, `dismissed`, `logged_in_via_popup`) | — |
| `storage_mode_changed` | `useSmartChatsStore.ts` | `mode`, `migrated?`, `merged?`, `skipped?`, `failed?` | — |
| `appdata_load/save` | `app_data_store.ts` | `data_key`, `ok`, `mode`, `duration_ms` | — |
| `performance_metrics` | `useOrchestrator.ts` | `fps_current`, `fps_avg_1min`, `memory_mb`, `dom_nodes` | — |
| `simi_workflow_start` | `simi/runner.ts` | `workflow_id`, `app`, `step_count`, `tags` | `simi`, … |
| `simi_step` | `simi/runner.ts` | `workflow_id`, `step`, `type`, `duration_ms`, `status` | — |
| `simi_workflow_complete` | `simi/runner.ts` | `workflow_id`, `total_ms`, `steps_passed`, `steps_failed` | — |
| `voice_interaction_complete` | `useOrchestrator.ts` | `runner_mode`, `timestamps`, `durations`, `response_length`, `mode` | `latency`, `pipeline` |
| `llm_cancel` | `useOrchestrator.ts` | `flow`, `transcript`, `was_running_function`, `cancel_ts`, `time_to_cancel_ms` | — |
| `issue` | `modules/issues.ts` (agent `report_issue` tool) | `kind` (free-form), `source` (e.g. `agent.report_issue`), `severity` (`info` \| `warning` \| `error`), `summary`, `detail?`, `triggering_event_id?` | — |

`issue` is the structured "a human should look at this" event. Schema lives in `smartchats-common/src/issues/types.ts`; emitted today by the `report_issue` agent tool (user-prompted or agent-initiated), readable via `audit:issues` / `monitor issues` in `smartchats-sessions/scripts/`. See `smartchats-sessions/src/analysis_db/README.md` § Issue event convention for the canonical schema + adding new emitters.

### Server-side TTFA breakdown — `llm_server_timing`

Three stamps emitted server-side per `llmTtsStreamHttp` call, always-on
(small payload, big diagnostic value):

| Phase | Stamped at | Used to derive |
|---|---|---|
| `llm_function_received` | First line of the function handler | `browser→function` = `funcReceivedMs − voice_session_start.timestamp` (cross-clock, ~tens of ms) |
| `llm_request_start` | Just before `llm_service.handleLLMStreamRequest(...)` | `function pre-LLM overhead` = `ms_since_function_received` |
| `llm_first_byte` | First chunk yielded by the LLM provider stream | `provider TTFT` = `ms_since_request_start` |

Combined with `voice_first_llm_call_first_chunk` (client receives first
token), the four spans cover the full Start-click → first-token path
and isolate where TTFA latency is actually being spent.

### Client-side TTFA breakdown — `client_stream_timing`

Four stamps emitted client-side per `streamWithTTS` call inside
`llm_caller.ts`. Always-on (4 events × small payload). `ts` values use
`performance.now()` so they're monotonic — pair with
`ms_since_voice_session_start` for absolute alignment against
`voice_session_start.timestamp` (`Date.now()`):

| Phase | Stamped at | Used to derive |
|---|---|---|
| `stream_request_dispatched` | Just before `getBackend().llm.streamWithTTS(...)` | `runLlm overhead` = `ms_since_voice_session_start − voice_first_llm_call_start.duration_ms` |
| `stream_response_headers_received` | When the stream object resolves (~ first byte at client) | `network return (CF → browser)` = this `ts − llm_first_byte.ts` (cross-clock caveat applies) |
| `first_event_received` | First iteration of the for-await consumer | `NDJSON-parse + first-event-yield` cost on the client |
| `first_text_pushed` | First `{kind:'text'}` reaches `textIterable` | Time until cortex can start emitting `response_chunk` |

Together with `llm_server_timing` (server-side, 3 phases) + `voice_first_llm_call_*` (client lifecycle events), the click → first-audio path now has ~8 named spans for attribution.

### Boot / Start-flow chains

Two distinct chains tie boot and the first session into single traces:

- **Boot chain** — opened by `InsightsContext` on `setIsReady(true)` (`boot_start`), closed in `app3.tsx` after `Promise.allSettled` of the four warmup probes (`boot_complete`). Every event emitted between those two — store init, settings load, auth wait, agent init, the four warmups — inherits the same `trace_id` via the chain stack.
- **Start-flow chain** — opened in `useOrchestrator.handleStartStop` on click (`voice_session_start`), closed in `onQueueDrain` on the first session-complete drain (`voice_session_first_turn_complete`). All events in between share one `trace_id`. `cold_start` is captured at click time from `lib/boot_snapshot.isColdStart()` and propagated on every Start-flow event so dashboards can split cold-vs-warm without post-hoc joining.

### Tag vocabulary

- `boot` — emitted during the boot chain (from `boot_start` to `boot_complete`); also `bg_load_*`
- `warmup` — one of the four parallel warmup probes (runner, TTS, VAD, prefetch)
- `bg_load` — background_loaders system event (`bg_load_start` / `bg_load_complete` per loader id)
- `latency` — user-perceivable wall time being measured
- `ttfa` — time-to-first-audio: click → first TTS chunk reaching the user
- `templated` — first-audio came from the templated-greeting bypass (no LLM)
- `client` — client-side span (vs `llm` for server-side LLM stamps)
- `llm` — server-side LLM-pipeline span
- `pipeline` — per-turn pipeline timings (`voice_interaction_complete`)

### Removed events (post-2026-06-11)

- `voice_first_llm_call_init_complete` — the in-band init injection in `runLlm` was deleted; all init data now flows via `bg_load_complete` + onResolve auto-injection. Sessions saved before 2026-06-11 will still contain this event.

### Quick analysis cheatsheet

For "how long did boot take?":
- `boot_complete.total_duration_ms` (single number)
- Per phase: `bg_load_complete` rows grouped by `id`; also `runner_warmup_complete` / `tts_warmup_complete` / `vad_warmup_complete` / `startup_prefetch_complete`

For "how long did the user wait for the first audio?":
- `voice_session_first_audio.duration_ms` (TTFA — single number)
- Split by greeting path: filter `voice_session_templated_greeting` event presence (templated path → first-audio dominated by TTS latency, ~500-800 ms; absent → LLM-on-Start legacy path, ~5 s)

For "where did TTFA's time actually go?":
- Combine `voice_first_llm_call_start.duration_ms` (client → CF dispatch) with `llm_server_timing` phases (CF cold + provider TTFT) with `client_stream_timing` phases (network return + NDJSON + IIFE) with `voice_first_llm_call_first_chunk.duration_ms` (full click → first token)

For "did boot complete cleanly?":
- `boot_complete.all_probes_ok` (boolean)
- Errored: `bg_load_complete` rows where `ok: false`

For "was this session cold or warm?":
- Any `voice_session_*` event's `cold_start` field — `true` if any of {runner, tts, vad, prefetch} probe was missing or failed at click time

## Debugging
- `window.COR` — current Cortex agent instance
- `window.workspace` — workspace object (from store)
- `window.tivi` — voice interface
- `window.sandbox` — sandbox module
- `window.cortexInsights` — InsightsClient instance
- `window.__smartchats__.getState()` — current store snapshot
- `window.__smartchats__.dispatch('addUserMessage', 'test')` — dispatch action
- `window.__smartchats__.simi.list()` — list available Simi workflows
- `await window.__smartchats__.simi.workflows.basic_chat_flow()` — run smoke test
- `await window.__smartchats__.dispatch('saveSession', 'test-session')` — save session
- Billing store: `import { useBillingStore } from '@/stores/billing_store'` then `useBillingStore.getState()`
- `bin/save_session smartchats` — export session data for offline analysis

## Adding Things
- **New widget**: create in `app/widgets/`, register in `hooks/useWidgetConfig.ts`, add layout in `components/DraggableWidgetGrid.tsx`, render in `components/FullscreenWidget.tsx` (`renderWidget` switch)
- **New agent function (tool)**: create or extend a module factory in `app/modules/<feature>.ts`, register it in `app/cortex_agent_web.ts` via `scm.add_module(createMyFeatureModule())`. Full guide: `app/modules/tool_creation_skill.md`
- **New event**: emit via `ops.util.event()`, add handler in `handleEvent` switch in `hooks/useOrchestrator.ts` and/or store actions in `store/useSmartChatsStore.ts`
- **New store state**: add to `SmartChatsState` interface and `creator` in `store/useSmartChatsStore.ts`
- **New hook**: create in `app/hooks/`, import in app3 or useOrchestrator
- **New streaming event**: add case to `handleEvent` in `hooks/useOrchestrator.ts`
- **New Simi workflow**: create in `app/simi/workflows/`, export from `app/simi/index.ts` into `cortexWorkflows`
- **New billing workflow**: create in `app/simi/billing_workflows/`, export from `app/simi/index.ts` into `billingWorkflows` (merged into `cortexWorkflows`)
- **New data key**: add to `CORTEX_DATA_KEYS` in `app/lib/storage.ts`, use via `getCortexStore().get/set(key)`
- **New insight event**: use `insights.emit(type, payload)` in store creator, or `getCortexStore().emitEvent(type, payload)`
- **New billing feature**: add Cloud Function, add action to `src/stores/billing_store.ts`, wire UI in `app/settings/billing/`
