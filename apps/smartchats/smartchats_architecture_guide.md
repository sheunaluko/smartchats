# SmartChats Architecture Guide

## Overview

SmartChats is a standalone production voice-first AI agent application with billing, authentication, and sandboxed code execution. It was forked from the Cortex prototype (`apps/ts_next_app/app/laboratory/cortex_0/`) and elevated to a standalone Next.js app with its own deployment pipeline.

**Deployment model**: Next.js on Vercel + Firebase Cloud Functions (LLM calls, TTS, billing, auth, storage)

**Key differentiators from Cortex prototype**:
- Standalone Next.js app with its own `package.json`, `tsconfig.json`, `next.config.mjs`
- Firebase-based billing system with Stripe integration (subscriptions + one-time credit packs)
- Cloud LLM calls via Firebase Cloud Functions (no Vercel proxy)
- Firebase TTS bridge for OpenAI TTS via Cloud Functions
- Firebase auth with email/Google/anonymous sign-in
- BYO API keys support
- Knowledge Graph visualization (sigma.js)
- 22 Simi test workflows (18 core + 4 billing)

## Directory Structure

```
apps/smartchats/
├── package.json                     # Standalone deps, scripts (dev/build/type-check)
├── tsconfig.json                    # Path aliases: @/*, @lab-components/*, @shared-lib/*
├── next.config.mjs                  # Webpack aliases, polyfills, ONNX externals
├── public/
│   └── onnx/                        # ONNX runtime + silero VAD model (copied at prebuild)
├── src/                             # Shared app-level code (aliased as @/)
│   ├── components/
│   │   ├── LoginModal.tsx           # Firebase auth modal (Google, email, anonymous)
│   │   └── Toast.tsx                # Notification toasts
│   ├── context/
│   │   └── InsightsContext.tsx       # InsightsProvider + useInsights hook
│   ├── firebase_utils.ts            # Firebase app init, all Cloud Function refs
│   ├── lib/
│   │   ├── llm_client.ts            # cloudLLMCall — Firebase llmCall CF wrapper
│   │   └── tts_bridge.ts            # firebaseTTSCallFn — Firebase ttsCall CF wrapper
│   └── stores/
│       └── billing_store.ts         # useBillingStore — Zustand via createInsightStore
├── app/                             # Next.js app directory
│   ├── page.tsx                     # Entry: InsightsProvider → dynamic App3
│   ├── layout.tsx                   # Root layout: NavBar, LoginModal, Toast, ThemeWrapper
│   ├── app3.tsx                     # Thin UI shell (432 lines)
│   ├── app.css                      # Global styles
│   ├── theme.ts / ThemeContext.tsx / ThemeWrapper.tsx  # MUI dark theme
│   ├── cortex_agent_web.ts          # Agent config, all agent functions, cloudLLMCall injection
│   ├── fn_utils.ts                  # Function utility helpers
│   ├── graph_utils.ts               # Knowledge graph utilities
│   ├── disabled_functions.ts        # Reference implementations (not active)
│   ├── mcp_adapter.ts               # MCP server integration
│   ├── store/
│   │   └── useSmartChatsStore.ts    # Primary Zustand store via createInsightStore
│   ├── lib/
│   │   ├── storage.ts               # AppDataStore singleton (app_id='smartchats')
│   │   └── authCheck.ts             # Cloud auth detection, toast notifications
│   ├── hooks/
│   │   ├── useOrchestrator.ts       # Event dispatch, voice lifecycle, TTS telemetry (515 lines)
│   │   ├── useStreamBuffers.ts      # 3-tier throttled streaming buffers (178 lines)
│   │   ├── usePipelineTelemetry.ts  # Pipeline timestamps + voice_interaction_complete (95 lines)
│   │   ├── useChatMode.ts           # Text chat state + typing indicator (63 lines)
│   │   ├── useCortexAgent.ts        # Agent initialization hook (48 lines)
│   │   └── useWidgetConfig.ts       # Widget persistence & layout presets (155 lines)
│   ├── components/
│   │   ├── TopBar.tsx               # Control bar (mode, model, voice controls, credits)
│   │   ├── SettingsPanel.tsx        # Drawer: widget toggles, tivi settings, calibration
│   │   ├── ChatModeView.tsx         # Text chat UI with message list + input
│   │   ├── FullscreenWidget.tsx     # Fullscreen overlay + renderWidget switch
│   │   ├── DraggableWidgetGrid.tsx  # react-grid-layout widget container
│   │   ├── SessionBrowser.tsx       # Session save/load browser
│   │   ├── VoiceStatusIndicator.tsx # Voice state display
│   │   └── AudioVisualization.tsx   # Audio level visualization
│   ├── widgets/                     # 13 modular visualization components
│   │   ├── ChatWidget.tsx
│   │   ├── ChatInputWidget.tsx
│   │   ├── ThoughtsWidget.tsx
│   │   ├── LogWidget.tsx
│   │   ├── CodeWidget.tsx
│   │   ├── HTMLWidget.tsx
│   │   ├── WorkspaceWidget.tsx
│   │   ├── CodeExecutionWidget.tsx
│   │   ├── FunctionCallsWidget.tsx
│   │   ├── VariableInspectorWidget.tsx
│   │   ├── SandboxLogsWidget.tsx
│   │   ├── HistoryWidget.tsx
│   │   └── KnowledgeGraphWidget.tsx
│   ├── src/
│   │   ├── IframeSandbox.ts         # Secure iframe sandbox with proxy membrane
│   │   ├── sandbox.ts              # Sandbox wrapper API
│   │   └── fps_monitor.ts          # FPS monitoring utility
│   ├── types/
│   │   └── execution.ts            # ExecutionSnapshot type definitions
│   ├── utils/
│   │   ├── eventListenerTracker.ts  # DOM event listener tracking
│   │   └── observerTracker.ts       # MutationObserver/ResizeObserver tracking
│   ├── simi/
│   │   ├── index.ts                 # cortexWorkflows export (merges core + billing)
│   │   ├── workflows/               # 18 core test workflows
│   │   └── billing_workflows/       # 4 billing test workflows
│   └── settings/
│       ├── layout.tsx               # Settings layout wrapper
│       └── billing/
│           ├── page.tsx             # Billing management page
│           ├── CreditBalance.tsx    # Balance display component
│           ├── CreditPacks.tsx      # One-time credit pack purchase
│           ├── TierCards.tsx        # Subscription tier selection
│           ├── BYOKeysSection.tsx   # BYO API key management
│           └── UsageTable.tsx       # Usage history table
```

## Configuration

### package.json
**Key scripts:**
- `dev`: `next dev -p 3000`
- `build`: `next build` (with `prebuild` that copies ONNX runtime files from ts_next_app)
- `type-check`: `tsc --noEmit --project tsconfig.json`

**Key dependencies:**
- `next` 14.2.3, `react` 18, `zustand` 5.0.9
- `firebase` 10.12.4, `react-firebase-hooks` 5.1.1
- `@mui/material` 6.4.7 (main UI), `@chakra-ui/react` 2.10.6 (LoginModal/Toast only)
- `onnxruntime-web` 1.23.2, `@ricky0123/vad-react` 0.0.36 (VAD)
- `@react-sigma/core`, `graphology`, `sigma` (knowledge graph)
- `react-grid-layout` 2.2.2 (widget layout)
- `@modelcontextprotocol/sdk` 1.22.0 (MCP)
- `@stripe/stripe-js` (Stripe client)

### tsconfig.json Path Aliases
```json
{
  "@/*":              ["./src/*"],
  "@lab-components/*": ["../ts_next_app/app/laboratory/components/*"],
  "@shared-lib/*":    ["../ts_next_app/src/lib/*"]
}
```

### next.config.mjs
- Webpack aliases mirror tsconfig paths (`@lab-components`, `@shared-lib`)
- Client-side externals: `onnxruntime-web` → `ort` (loaded from `public/onnx/`)
- `NodePolyfillPlugin` for Node.js polyfills in browser
- `fs: false` fallback for client builds

## Routing & Pages

| Route | Source | Purpose |
|-------|--------|---------|
| `/` | `app/page.tsx` | Main app — InsightsProvider + App3 |
| `/settings/billing` | `app/settings/billing/page.tsx` | Billing management (tiers, credits, BYO keys, usage) |

## Backend Architecture

### Firebase Cloud Functions
All called via `firebase/functions` `httpsCallable`. Defined in `src/firebase_utils.ts`:

| Function | Purpose |
|----------|---------|
| `llmCall` | LLM inference — routes to OpenAI/Anthropic/Google via `ts_node/apis/llm_service` |
| `ttsCall` | Text-to-speech — OpenAI TTS API |
| `getBalance` | Fetch current credit balance and tier info |
| `getUsage` | Fetch usage records (paginated, period-filtered) |
| `purchaseCredits` | Initiate Stripe checkout for credit pack |
| `createSubscription` | Initiate Stripe checkout for subscription tier |
| `manageSubscription` | Get Stripe customer portal URL |
| `saveBYOKeys` | Save user's own API keys (encrypted server-side) |
| `deleteBYOKey` | Delete a BYO key for a specific provider |
| `storeEmbedding` | Store vector embedding for knowledge graph |
| `retrieveEmbedding` | Semantic search of stored embeddings |
| `surrealQuery` | Generic SurrealDB query gateway |
| `newUserTable` | Initialize user tables |
| `testAuth` | Verify authentication status |

> **Note**: this section describes the cloud-flavored variant of the app, which is built and deployed from a separate downstream repo. In *this* open repo, the default bootstrap is local-only (`LocalAuthProvider` + `LocalBackend`) — no Firebase, no Cloud Functions, no Stripe.

### Provider Routing (Server-Side)
The `llmCall` Cloud Function routes to providers via `ts_node/apis/llm_service`:
- **OpenAI**: `gpt-5-mini`, `gpt-5.2`, `gpt-4o-mini-*`
- **Anthropic**: `claude-sonnet-4-5-*`
- **Google Gemini**: `gemini-3-flash-preview`, `gemini-3-pro-preview`

## Billing System

### Tier Structure

| Tier | Price | Monthly Credits | Discount |
|------|-------|----------------|----------|
| `free` | $0/mo | 1,000 | 0% |
| `intro` | $10/mo | 7,500 | 0% |
| `basic` | $20/mo | 16,000 | 20% |
| `pro` | $50/mo | 42,500 | 40% |
| `max` | $100/mo | 90,000 | 60% |

### Credit Packs (One-Time Purchase)

| Pack | Price | Credits |
|------|-------|---------|
| `pack_5` | $5 | 2,500 |
| `pack_10` | $10 | 5,000 |
| `pack_20` | $20 | 10,000 |
| `pack_50` | $50 | 25,000 |

### Credit System
- Each LLM call consumes credits based on token usage
- `periodCredits` — monthly subscription allocation (refills each period)
- `purchasedCredits` — one-time pack credits (never expire)
- `totalAvailable = periodCredits + purchasedCredits`
- NavBar shows credit chip; turns red when `< 100`

### Stripe Checkout Flow
1. User selects tier or credit pack
2. Client calls `createSubscription({ tier })` or `purchaseCredits({ packId })`
3. Firebase CF creates Stripe checkout session, returns URL
4. User redirected to Stripe for payment
5. On success, redirected back with `?subscription=success` or `?purchase=success` URL param
6. Billing page detects param, shows success toast, refetches balance

### BYO API Keys
- Users can provide their own OpenAI, Anthropic, or Google API keys
- Keys stored server-side (encrypted), only masked previews shown in UI
- When BYO key is active for a provider, usage is tagged `chargedFrom: 'byo_key'` (no credit deduction)
- UI: `BYOKeysSection.tsx` in billing settings

### Billing Store (`src/stores/billing_store.ts`)
- Built with `createInsightStore({ appName: 'smartchats_billing' })`
- Real-time update: listens for `smartchats:billing_update` window event dispatched by `cloudLLMCall`
- `updateFromLLMResponse(billing)` updates `periodCredits`, `purchasedCredits`, `totalAvailable` without full refetch
- Silent actions: `updateFromLLMResponse` (too noisy to instrument)

## State Management

### Primary Store (`useSmartChatsStore`)
- Location: `app/store/useSmartChatsStore.ts`
- Factory: `createInsightStore<SmartChatsState>({ appName: 'smartchats', ... })`
- All actions auto-instrumented with insight events (except `silent` list)
- Playwright bridge: `window.__smartchats__` with `dispatch()`, `getState()`, `simi`

**State categories:**
- **Auth**: `isAuthenticated`
- **Settings** (persisted in AppDataStore `'settings'` key): `aiModel`, `speechCooldownMs`, `soundFeedback`
- **Chat** (persisted in `'conversations'` key): `chatHistory`, `lastAiMessage`, `workspace`
- **Observables**: `thoughtHistory`, `logHistory`, `htmlDisplay`, `codeParams`, `contextUsage`
- **Execution**: `currentCode`, `executionId`, `executionStatus`, `executionError`, `executionDuration`, `executionResult`, `functionCalls`, `variableAssignments`, `sandboxLogs`, `executionHistory` (max 100), `selectedIndex`, `isPinned`
- **Knowledge Graph**: `kgGraphData`, `kgAutoDisplay`, `kgMode`, `kgDepth`, `kgVisibleRelationKinds`, `kgAvailableRelationKinds`, `kgIsSearching`
- **Voice state** (not persisted, set by orchestrator): `started`, `transcribe`, `interimResult`, `voiceStatus`
- **Background Processes**: `processes`, `processOutputs`, `agentMonitorStates`
- **Stream Viewer**: `streamChunks`
- **Agent + LLM**: `agent`, `llmRunning`, `_pendingRerun` + key actions: `sendMessageSync`, `sendMessageAsync`, `runLlm`, `triggerParentRerun`

### Billing Store (`useBillingStore`)
- Location: `src/stores/billing_store.ts`
- Factory: `createInsightStore<BillingState>({ appName: 'smartchats_billing', ... })`
- Manages: tier, credits (period + purchased), BYO keys, usage records

### Hooks Architecture

**useOrchestrator** (`app/hooks/useOrchestrator.ts`, 515 lines):
- Params: `{ tivi, tiviSettings, agent, insightsClient, fpsMonitor, sessionStartTime }`
- Returns: `{ handleStartStop, transcriptionCb, setTranscribe, handleEvent, onQueueFirstUtterance, onQueueDrain }`
- Composes `usePipelineTelemetry()` + `useStreamBuffers()` internally
- Event dispatch (`handleEvent` switch) — categorized events:
  - *Store delegation*: `thought`, `workspace_update`, `log`, `code_update`, `html_update`, `context_status`, `knowledge_graph_update`
  - *Execution*: `code_execution_start`, `code_execution_complete`, `sandbox_log`, `sandbox_event`
  - *HTML interaction*: `html_form_data`, `html_interaction_complete`
  - *Process*: `process_idle`, `process_spawned`, `process_output`, `process_agent_event`, `process_needs_input`, `process_complete`
  - *Streaming → TTS*: `streaming_ack`, `thought_chunk`, `response_chunk`, `text_stream_done`, `response_complete`
  - *Stream viewer*: `stream_chunk`, `stream_end`
  - *Lifecycle*: `turn_start`, `response_ready`, `turn_complete`, `process_idle_batch`
- `transcriptionCb` flow: cooldown check → cancel detection (explicit "cancel" or supersede) → `sendMessageSync` or `handle_function_input`

**useStreamBuffers** (`app/hooks/useStreamBuffers.ts`, 178 lines):
- 3 parallel buffer systems with throttled flush to store:
  - Response buffer: 100ms throttle, `response_chunk` → appends to last assistant message in `chatHistory`
  - Thought buffer: 100ms throttle, `thought_chunk` → appends to streaming thought entry in `thoughtHistory`
  - Stream buffer: 200ms throttle, `stream_chunk` → `streamChunks` (debug viewer)
- Finalize methods: `finalizeResponse(fullResponse)`, `finalizeThoughts()`, `finalizeStream()`

**usePipelineTelemetry** (`app/hooks/usePipelineTelemetry.ts`, 95 lines):
- `pipelineTs` ref — timestamp bag: `transcription_received`, `llm_call_start`, `first_ack_received`, `first_response_chunk`, `response_complete`, `first_tts_utterance`, `tts_queue_drain`, `llm_call_end`
- `emitVoiceComplete` — emits `voice_interaction_complete` with computed durations (e.g. `transcription_to_llm_start`, `first_response_latency`, `end_to_end_with_speech`)

**useChatMode** (`app/hooks/useChatMode.ts`, 63 lines):
- Manages `chatInput`, `isAiTyping`, `handleChatSend`, `handleChatKeyPress`
- Sends via `transcriptionCb` — shared input path with voice

**useCortexAgent** (`app/hooks/useCortexAgent.ts`, 48 lines):
- Wraps `cortex_agent.get_agent(model, insightsClient, authInfo, useStreaming)`
- Returns `{ agent, isLoading, error }`

**useWidgetConfig** (`app/hooks/useWidgetConfig.ts`, 155 lines):
- Widget visibility, layout persistence via AppDataStore `'widget_layout'` key
- Presets: default, focus, development, debug, minimal

### createInsightStore Pattern
Both stores use the shared `createInsightStore` from `@shared-lib/createInsightStore`:
- Wraps Zustand's `create()` with auto-instrumentation
- Every action emits `action` events with timing, args, result, status
- Supports `silent` list for noisy actions
- Late-binding: `useStore.setInsights(client)` after React mount
- Playwright bridge: `window.__${appName}__` with `dispatch()`, `getState()`, `simi`

## Storage Layer

### AppDataStore (`app/lib/storage.ts`)
- Imported from `@shared-lib/app_data_store`
- Singleton: `getCortexStore(insights?, cloudQueryFn?)` — scoped to `app_id='smartchats'`
- Two backends: `LocalStorageBackend` (localStorage with key registry) and `SurrealBackend` (SurrealDB via Firebase `surrealQuery` CF)

**Data keys** (`CORTEX_DATA_KEYS`):
| Key | Content |
|-----|---------|
| `settings` | `{ aiModel, speechCooldownMs, soundFeedback }` |
| `conversations` | `{ chat_history, workspace }` |
| `widget_layout` | `{ widgets, layout }` |
| `sessions` | Array of full session snapshots (max 50) |

**Backend mode**: persisted in `appdata::smartchats::__backend_mode__` localStorage flag
**Default**: cloud — new users start in cloud mode

**Legacy migration**: One-time migration of `cortex_widget_config` / `cortex_widget_layout` keys, gated by `appdata::smartchats::__legacy_migrated__` flag.

**Local-to-cloud migration**: Sessions merged by `id`; object keys (settings) — cloud wins. Emits `appdata_migrate_to_cloud` event.

## Authentication

### Firebase Auth Methods
- **Google popup** — primary sign-in method
- **Email/password** — sign-in and sign-up
- **Anonymous** — guest access with limited functionality

### Auth Flow
1. App boots in cloud mode by default
2. `loadSettings()` calls `waitForFirebaseAuth()` — waits for `onAuthStateChanged`
3. If no auth in cloud mode, `notifyCloudAuthRequired()` shows toast with LOG IN / USE LOCAL / Dismiss
4. LOG IN opens `LoginModal` (or falls back to Google popup)
5. On success, `loadSettings()` and `loadConversation()` re-run to fetch cloud data
6. Agent receives `authInfo` — system prompt adapts based on login state

### LoginModal (`src/components/LoginModal.tsx`)
- Chakra UI modal (not MUI — separate component library for this)
- Exposed globally via `window.openLoginModal()`
- On success dispatches `window.dispatchEvent(new Event('loginSuccess'))`
- Mounted in `layout.tsx` inside `<ChakraProvider>`

### Auth Check (`app/lib/authCheck.ts`)
- `isFirebaseAuthenticated()` — sync check via `getAuth().currentUser`
- `waitForFirebaseAuth(timeoutMs = 2000)` — async wait for auth state
- `checkCloudAuth()` — returns `{ isCloudMode, isAuthenticated, needsAttention }`
- `notifyCloudAuthRequired(context, emitFn)` — debounced toast (30s), displayed for 15s

## AI Agent

### Agent Configuration (`app/cortex_agent_web.ts`)
- `get_agent(modelName, insightsClient, authInfo)` — creates Cortex instance
- `llmCallFn: cloudLLMCall` — all LLM calls go through Firebase CF
- `sandbox: getExecutor()` — IframeSandboxExecutor singleton
- Default model: `"gpt-5-mini"` (param default); store default: `"gpt-5.2"`

### Agent Functions (all enabled)

| Function | Purpose |
|----------|---------|
| `format_string` | String template formatting |
| `respond_to_user` | Main response delivery |
| `compute_embedding` | Cloud embedding computation |
| `array_nth_value` | Array access helper |
| `store_declarative_knowledge` | Store KG triples |
| `retrieve_declarative_knowledge` | Semantic KG search |
| `display_code` | Emit code to Code widget |
| `display_html` | Emit HTML to HTML widget |
| `accumulate_text` | Multi-turn text collection |
| `console_log` | Debug logging |
| `initialize` | DB initialization |
| `access_database_with_surreal_ql` | Generic SurrealQL gateway |
| `create_dynamic_function` | Save JS function to DB |
| `load_dynamic_function` | Load function from DB |
| `list_dynamic_functions` | List all dynamic functions |
| `update_dynamic_function` | Update function in DB |
| `delete_dynamic_function` | Delete function from DB |
| `reset_sandbox` | Reset iframe sandbox |
| `speak_conversational_acknowledgement` | Play preloaded audio ack |
| `check_login_status` | Report auth status to user |

### Agent Loop
**Streaming path** (default, `USE_STREAMING=true`):
```
sendMessageSync(text) → addUserMessage + runLlm → StreamingRunner streams → orchestrator.handleEvent dispatches → buffers + TTS queue → voice_interaction_complete
```

**Non-streaming fallback**:
```
runLlm → user_output callback → addAiMessage → tivi.speak(content, playbackRate)
```

**Dispatch path** (Simi/Playwright):
```
dispatch('sendMessageSync', content) → addUserMessage + runLlm
dispatch('sendMessageAsync', content) → addUserMessage (no LLM run)
```

### LLM Client (`src/lib/llm_client.ts`)
```
cloudLLMCall(args) → Firebase httpsCallable("llmCall")(args)
  → response includes { output_text, usage, billing }
  → dispatches 'smartchats:billing_update' event with billing data
```

## Voice System

### Tivi Integration
- Imported from `@lab-components/tivi` (shared component in ts_next_app)
- `useTivi` hook initialized with `ttsCallFn: firebaseTTSCallFn`
- Handles: voice activity detection, speech recognition, text-to-speech

### TTS Bridge (`src/lib/tts_bridge.ts`)
- `firebaseTTSCallFn` wraps Firebase `ttsCall` Cloud Function
- Routes to OpenAI TTS API server-side
- Returns audio data for playback

### VAD (Voice Activity Detection)
- ONNX silero model (`silero_vad_v5.onnx`) loaded from `public/onnx/`
- `onnxruntime-web` loaded as external (`ort` global)
- ONNX files copied from ts_next_app at prebuild time

### Conversational Acknowledgements
- Preloaded audio buffers for fast responses (`sure`, `ok`, `got_it`, `one_moment`, etc.)
- Agent function `speak_conversational_acknowledgement` plays them via `tivi.speakCached()`
- 21 acknowledgement types available

### Pipeline
**Streaming pipeline** (default):
```
Mic → VAD → Speech Recognition → orchestrator.transcriptionCb
  → cooldown check → cancel detection (explicit "cancel" or supersede with new input)
  → sendMessageSync → runLlm → StreamingRunner streams
  → orchestrator.handleEvent dispatches to:
    - streaming_ack → tivi.ttsQueue.speakText (preloaded audio)
    - response_chunk → buffers.feedResponseChunk + tivi.ttsQueue.feedChunk
    - text_stream_done → tivi.ttsQueue.flushStream
    - response_complete → buffers.finalizeResponse + telemetry stamps
  → voice_interaction_complete
```

**Non-streaming fallback**:
```
Same input path → runLlm → user_output callback → addAiMessage → tivi.speak(content, playbackRate)
```

**Process idle flow**:
```
process_idle → processManager.queueIdle → batched flush on code_execution_complete / turn_complete
```

## Widget System

### All 13 Widgets

| Widget | File | Data Source |
|--------|------|-------------|
| Chat | `ChatWidget.tsx` | `chatHistory` array |
| Text Input | `ChatInputWidget.tsx` | Calls `transcription_cb()` |
| Thoughts | `ThoughtsWidget.tsx` | `thoughtHistory` array |
| Log | `LogWidget.tsx` | `logHistory` array |
| Code | `CodeWidget.tsx` | `codeParams: { code, mode }` |
| HTML | `HTMLWidget.tsx` | `htmlDisplay` string |
| Workspace | `WorkspaceWidget.tsx` | `workspace` object |
| Code Execution | `CodeExecutionWidget.tsx` | `currentExecution?.code` |
| Function Calls | `FunctionCallsWidget.tsx` | `currentExecution?.functionCalls` |
| Variables | `VariableInspectorWidget.tsx` | `currentExecution?.variableAssignments` |
| Sandbox Logs | `SandboxLogsWidget.tsx` | `currentExecution?.sandboxLogs` |
| Execution History | `HistoryWidget.tsx` | `executionHistory[]`, `selectedIndex`, `isPinned` |
| Knowledge Graph | `KnowledgeGraphWidget.tsx` | `kgGraphData` (sigma.js) |

### DraggableWidgetGrid (`components/DraggableWidgetGrid.tsx`)
- Uses `react-grid-layout` for drag/drop/resize
- 12-column grid layout
- Fullscreen mode: click widget → `setFocusedWidget(id)` → `FullscreenWidget` component renders fullscreen overlay

### Layout Presets
- **default**: 2-column layout with all widgets
- **focus**: Single large chat widget (full width)
- **development**: Chat + Code side-by-side + Workspace below
- **debug**: 3x4 grid with execution, function calls, logs, variables
- **minimal**: Chat + Thoughts only

### Widget Configuration (`hooks/useWidgetConfig.ts`)
- Widget config + layout persisted via AppDataStore `'widget_layout'` key
- `toggleWidget(id)`, `saveLayout(layout)`, `resetLayout()`, `applyPreset(name)`

## Knowledge Graph

### Architecture
- Entity-relation-entity triples stored via agent functions (`store_declarative_knowledge`)
- Semantic search via `retrieve_declarative_knowledge` (uses cloud embeddings)
- Visualization via `@lab-components/graph_viz` (sigma.js + graphology from ts_next_app)

### Graph Utilities (`app/graph_utils.ts`)
- Triple parsing and normalization
- Graph data conversion (triples → sigma.js format)

### Graph State
- `kgGraphData: { nodes: [], edges: [] }` — current graph data
- `kgMode`: `'accumulate'` (merge new data into existing) or `'replace'` (clear + set)
- `kgAutoDisplay`: auto-show graph on KG updates
- `kgDepth`: search depth for retrieval
- `kgVisibleRelationKinds`: filter which relation types are displayed
- `kgIsSearching`: loading state for KG queries

## Sandbox Execution

### IframeSandbox (`app/src/IframeSandbox.ts`)
- **Isolation**: `<iframe sandbox="allow-scripts">` (no `allow-same-origin`)
- **Persistence**: Single iframe reused across executions to preserve JS state
- **Proxy membrane**: `with (this)` + Proxy with `has()` trap → tracks all property access and variable assignments
- **Communication**: postMessage between iframe and parent, multiplexed by `executionId`
- **Code sanitization**: Replaces Unicode smart quotes and em/en dashes
- **Observability**: Captures `SandboxLog[]` (console), `SandboxEvent[]` (function_start/end/error, variable_set, property_access)
- **Dynamic functions**: `run_dynamic_function` auto-injected for DB-loaded function execution
- **Singleton**: `getExecutor()` returns shared `IframeSandboxExecutor` instance

### Sandbox API (`app/src/sandbox.ts`)
- `initializeSandbox()` — one-time warm-up
- `evaluateJavaScriptSandboxed(code, options)` — execute code in sandbox
- `updateWorkspaceSandboxed(code, workspace)` — update workspace object
- `resetSandbox()` — clear variables, keep iframe alive
- `destroySandbox()` — remove iframe completely

## Testing (Simi Workflows)

### Core Workflows (18)

| Workflow | Tags | Purpose |
|----------|------|---------|
| `basic_chat_flow` | smoke, chat | Send message, verify AI response |
| `full_conversation_flow` | e2e, chat, session | Multi-turn chat + session save/list |
| `settings_persistence_flow` | smoke, settings, persistence | Settings update → save → reload → assert |
| `session_save_load_flow` | e2e, session, persistence | Save → clear → load → assert restored |
| `code_execution_flow` | e2e, code, sandbox, execution | Prompt code → execute → assert results |
| `multi_turn_context_flow` | e2e, chat, context | 4-turn conversation context retention |
| `workspace_update_flow` | e2e, workspace | Store workspace data via agent |
| `html_display_flow` | e2e, html | Render HTML via agent |
| `stress_conversation_flow` | stress | Rapid multi-message stress test |
| `auth_guard_flow` | auth | Auth state detection and guards |
| `storage_mode_switch_flow` | storage | Switch local/cloud storage modes |
| `model_switch_flow` | model | Switch AI model during session |
| `knowledge_graph_flow` | kg | Store + retrieve KG data |
| `kg_settings_flow` | kg, settings | KG settings (mode, depth, filters) |
| `clear_and_resume_flow` | chat | Clear chat and resume |
| `session_management_flow` | session | Full session save/load/list lifecycle |
| `rapid_message_flow` | stress, chat | Rapid-fire message sending |
| `execution_history_nav_flow` | execution, history | Navigate execution history (pin/select/unpin) |

### Billing Workflows (4)

| Workflow | Tags | Purpose |
|----------|------|---------|
| `balance_fetch_flow` | billing, balance | Fetch and verify credit balance |
| `usage_fetch_flow` | billing, usage | Fetch and verify usage records |
| `byo_key_lifecycle_flow` | billing, byo | Save, verify, delete BYO API key |
| `byo_key_multi_provider_flow` | billing, byo | Multi-provider BYO key management |

### Running Workflows
```javascript
// Browser console:
window.__smartchats__.simi.list()                                        // List all workflows
await window.__smartchats__.simi.workflows.basic_chat_flow()             // Run single workflow
await window.__smartchats__.simi.workflows.basic_chat_flow({ speed: 5 }) // Run 5x faster
```

### Simi Architecture
- Workflows defined using `defineWorkflow({ id, app, tags?, steps })` from `@shared-lib/simi`
- Compiled by `createInsightStore` and mounted on `window.__smartchats__.simi`
- Each step emits telemetry: `simi_workflow_start`, `simi_step`, `simi_workflow_complete`
- Sessions auto-tagged: `['simi', app, workflow_id, ...workflow.tags]`

## Telemetry & Insights

### InsightsProvider (`src/context/InsightsContext.tsx`)
- Wraps the entire app, initializes `InsightsClient` with `appName='smartchats'`, `appVersion='1.0.0'`
- `useInsights()` hook provides `insightsClient` to components
- Late-binding: stores call `setInsights(client)` after mount

### Session Export
```bash
bin/save_session smartchats                          # Export latest session
bin/save_session smartchats --tag simi               # Filter by simi tag
bin/save_session smartchats --tag billing --last 5   # Last 5 billing-tagged sessions
```

### Event Reference

| Event | Source | Payload |
|-------|--------|---------|
| `cortex_store_init` | `storage.ts` | `bootstrap`, `resolved_mode`, `is_new_instance` |
| `cortex_legacy_migration` | `useSmartChatsStore.ts` | `migrated`, `skipped` |
| `cortex_settings_loaded` | `useSmartChatsStore.ts` | `source`, `had_migration`, `raw_stored`, `merged` |
| `cortex_settings_loaded_complete` | `useSmartChatsStore.ts` | `mode`, `isAuthenticated` |
| `cortex_settings_updated` | `useSmartChatsStore.ts` | `changed_keys`, `before`, `after` |
| `cortex_settings_saved` | `useSmartChatsStore.ts` | `ok`, `mode`, `settings` |
| `cortex_conversation_loaded` | `useSmartChatsStore.ts` | `chat_length`, `has_workspace` |
| `cortex_session_saved` | `useSmartChatsStore.ts` | `sessionId`, `label` |
| `cortex_session_loaded` | `useSmartChatsStore.ts` | `sessionId` |
| `cloud_auth_required` | `authCheck.ts` | `context` |
| `cloud_auth_action` | `authCheck.ts` | `action` |
| `storage_mode_changed` | `useSmartChatsStore.ts` | `mode`, `migrated?`, `merged?` |
| `performance_metrics` | `useOrchestrator.ts` | `fps_current`, `fps_avg_1min`, `memory_mb`, `dom_nodes` |
| `appdata_load/save` | `app_data_store.ts` | `data_key`, `ok`, `mode`, `duration_ms` |
| `simi_workflow_start` | `simi/runner.ts` | `workflow_id`, `app`, `step_count`, `tags` |
| `simi_step` | `simi/runner.ts` | `step`, `type`, `duration_ms`, `status` |
| `simi_workflow_complete` | `simi/runner.ts` | `total_ms`, `steps_passed`, `steps_failed` |
| `voice_interaction_complete` | `useOrchestrator.ts` | `runner_mode`, `timestamps`, `durations`, `response_length`, `mode` |
| `llm_cancel` | `useOrchestrator.ts` | `flow`, `transcript`, `was_running_function`, `cancel_ts`, `time_to_cancel_ms` |

## Shared Code Dependencies

SmartChats imports from ts_next_app via path aliases. Changes to these files affect SmartChats:

### From `@lab-components/*` (→ `ts_next_app/app/laboratory/components/`)
| Import | What |
|--------|------|
| `tivi/lib/index` | `useTivi` — voice input/output hook |
| `tivi/lib/useTiviSettings` | `useTiviSettings` — voice settings |
| `tivi/lib/tts_acknowledgements` | `preloadAcknowledgements`, `getAckBuffer`, `ACK_TYPES`, `AckType` |
| `tivi/VADMonitor` | VAD monitoring component |
| `tivi/CalibrationPanel` | Audio calibration UI |
| `tivi/VoiceSelector` | Voice selection component |
| `graph_viz` / `graph_viz/lib/types` | `KGGraphData`, `KGNode`, `GraphMode` types |
| `graph_viz/lib/graph-utils` | `mergeGraphData`, `extractRelationKinds` |
| `graph_viz/lib/adapter` | `searchResultToGraphData`, `flatSearchResultToGraphData`, `triplesToGraphData` |

### From `@shared-lib/*` (→ `ts_next_app/src/lib/`)
| Import | What |
|--------|------|
| `createInsightStore` | Zustand factory with auto-instrumentation + Playwright bridge |
| `app_data_store` | `AppDataStore`, `LocalStorageBackend`, `SurrealBackend`, `InsightsClient`, `SurrealQueryFn` |
| `simi` | `defineWorkflow` — workflow definition helper |

## Theme & Styling
- Dark theme by default via MUI `createTheme` (`app/theme.ts`)
- `ThemeWrapper` component applies MUI `ThemeProvider` + `CssBaseline`
- Chakra UI used only for `LoginModal` and `Toast` (separate provider in `layout.tsx`)
- Global styles in `app/app.css`

## Performance Monitoring
- **FPS Monitor** (`app/src/fps_monitor.ts`): Tracks frames per second, `performance_metrics` emitted from `useOrchestrator.ts` after AI responses
- **Observer Tracker** (`app/utils/observerTracker.ts`): Tracks active MutationObserver and ResizeObserver instances
- **Event Listener Tracker** (`app/utils/eventListenerTracker.ts`): Tracks DOM event listener registrations
- Performance metrics include: `fps_current`, `fps_avg_1min`, `fps_min_1min`, `fps_max_1min`, `memory_mb`, `dom_nodes`, `visible_nodes`, `session_uptime_ms`
