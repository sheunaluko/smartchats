# SmartChats Startup & Initialization Reference

## Timeline

```
PAGE LOAD
└─ Next.js boots, app3.tsx dynamic-imported with SSR off

APP MOUNT (app3.tsx)
├─ InsightsProvider ready → setInsights to store, billing, classifier
│  └─ boot_start chain opened (every event below inherits trace_id)
├─ app3_mounted insights event
├─ FPS Monitor init
├─ loadSettings() (awaited)
│  ├─ migrateLegacyLocalStorage()                    (~0 ms)
│  ├─ getCortexStore()                               (~ms)
│  ├─ waitForAuthReady(2000) [cloud mode only]       (~30 ms warm; up to 2 s cold)
│  ├─ store.get(settings)                            (~ms localStorage / ~hundreds cloud)
│  └─ checkAuth() + settingsLoaded = true
├─ useCortexAgent() → cortex_agent.get_agent(...)    (~10 ms warm)
│  └─ agent_init_success / agent_init_error (with duration_ms)
├─ useTivi() → voice + VAD + speech recognition      (non-blocking — ONNX model loads on warmupVAD)
├─ useOrchestrator() → event dispatch + voice lifecycle
└─ Wire orchestrator TTS callbacks + register voice actions in store

FIREBASE USER DETECTED + agent created
├─ Background loaders useEffect (apps/smartchats/app/lib/background_loaders/)
│  └─ createStartupLoaders({ agent, insights }) + prefetchAll(loaders)
│     ├─ user_kg_shallow   (depth-1, ~500 ms)        → onResolve: inject + hydrate onboarding cache
│     ├─ todos_context                               → onResolve: inject into agent context
│     ├─ metrics_context                             → onResolve: inject into agent context
│     ├─ log_categories                              → onResolve: inject into agent context
│     ├─ init_instructions                           → onResolve: inject into agent context
│     ├─ procedural_instructions                     → onResolve: inject into agent context
│     └─ installed_apps (seed+list+manifest)         → onResolve: set store + hydrate launcher cache + inject summaries
│        Each emits bg_load_start / bg_load_complete (tags: boot, bg_load, latency)
│        NONE of these block the first turn. They auto-inject into agent
│        context as they resolve.
└─ Warmup useEffect (parallel)
   ├─ COR.runner.warmup()              (runner_warmup_complete)
   ├─ warmupBackendTts()                (tts_warmup_complete)
   ├─ tivi.warmupVAD()                  (vad_warmup_complete — Silero ONNX session cached)
   └─ startup_prefetch probe awaits user_kg_shallow only
      (the one input the templated greeting needs)
   After Promise.allSettled → boot_complete (closes boot chain)

USER CLICKS START (useOrchestrator.handleStartStop)
├─ sounds.ensureResumed()
├─ Capture click T0 + cold_start flag (from boot_snapshot.isColdStart())
├─ Open voice_session_start chain
├─ TEMPLATED GREETING (replaces the old runLlm-on-Start path):
│  ├─ name = extractNameFromKG(loaders.user_kg_shallow.peek())
│  ├─ greeting = getGreeting({ name })   (15 variants × 5 time buckets)
│  ├─ tivi.ttsQueue.speakText(greeting.text)
│  ├─ agent.messages.push({ role: 'assistant', content: greeting.text })
│  ├─ store.addAiMessage(greeting.text)
│  └─ voice_session_templated_greeting event (tags: latency, ttfa, templated)
├─ await onInitAudio()  → mic ready
│  └─ voice_session_audio_ready (click → mic, tags: latency, ttfa)
└─ runLlm() is NOT called here — first runLlm fires when the user speaks
   (via transcriptionCb → sendMessageSync → runLlm fire-and-forget)

USER SPEAKS (transcription resolved)
└─ sendMessageSync(text)
   ├─ addUserMessage + agent.add_user_text_input
   └─ runLlm() fire-and-forget
      ├─ (one-time) peek user_kg_shallow → conditionally inject
      │  onboarding-incomplete directive
      ├─ voice_first_llm_call_start  (tags: boot, latency, ttfa)
      ├─ agent.run_llm(4) → SSE stream
      │  Server emits llm_server_timing NDJSON (function_received,
      │  request_start, first_byte) — tags: latency, llm, ttfa
      │  Client emits client_stream_timing (request_dispatched,
      │  response_headers_received, first_event_received,
      │  first_text_pushed) — tags: latency, client, ttfa
      ├─ voice_first_llm_call_first_chunk
      ├─ TTS stream → tivi.ttsQueue
      │  voice_session_first_audio  (TTFA — click → first audio chunk)
      └─ voice_session_first_turn_complete (closes voice chain)
```

## Key startup components

| Component | File | What it does |
|---|---|---|
| Settings load | `useSmartChatsStore.ts loadSettings()` | Legacy migration + auth wait + persisted settings + checkAuth |
| Cortex agent | `hooks/useCortexAgent.ts` | Builds the cortex agent with all module factories |
| Tivi | `@lab-components/tivi useTivi()` | Voice + VAD; `warmupVAD()` pre-loads Silero ONNX |
| Orchestrator | `hooks/useOrchestrator.ts` | Event dispatch + voice lifecycle + Start-click flow |
| Background loaders | `lib/background_loaders/` | Generic prefetch+memoize+auto-inject for the 7 prefetch items |
| Greeting service | `lib/greeting/` | 15 time-aware templated variants for the click→first-audio path |
| Insights chain | `InsightsContext.tsx` | Opens `boot_start` chain; emits `runtime_error` on global errors |

## Architectural patterns introduced 2026-06

### Background loaders (`lib/background_loaders/`)

Every prefetchable item runs through the same `createBackgroundLoader<T>` primitive:

- `prefetch()` — fire-and-forget, idempotent
- `get()` — returns the in-flight promise (agent function calls share the prefetch)
- `peek()` — synchronous read; `undefined` if not yet resolved
- `reset()` — for tests + forced re-fetch
- `onResolve(value, { fromPrefetch })` — auto-injects into agent context, populates store, etc.

The first turn does **not block** on any loader. Whatever's resolved at the moment the LLM call goes out is in context; the rest streams in via `onResolve` between turns. Module function calls (`get_metrics_context`, `initialize`, etc.) route through `getStartupLoaders()?.X.get()` so they share the prefetch's in-flight promise rather than firing a duplicate roundtrip.

### Templated greeting (`lib/greeting/`)

Bypasses the LLM entirely for the first audio out. On Start click:

1. Peek `user_kg_shallow` for the name (if resolved).
2. Pick a time-aware template (15 variants split 3-per-bucket: morning/afternoon/evening/night/neutral).
3. Push to `tivi.ttsQueue.speakText(text)` — direct TTS, no LLM.
4. Inject the spoken text as an `assistant` message in `agent.messages` so the LLM sees "I already greeted" on its next turn.

If KG hasn't resolved by click time, the no-name template variant is used ("Hi, what can I help with?"). The system never falls back to the old LLM-on-Start path.

## Telemetry shape

Two top-level chains per session:

- **Boot chain** — `boot_start` (opens at InsightsContext ready) → `boot_complete` (closes after Promise.allSettled of the 4 warmup probes). Inherited by every boot-tagged event in between.
- **Start-flow chain** — `voice_session_start` (opens on click) → `voice_session_first_turn_complete` (closes on first TTS drain). Inherited by `voice_first_llm_call_*`, `voice_session_audio_ready`, `voice_session_first_audio`, and the per-turn `agent_turn` chain that nests inside (trace_id propagated to the nested chain since 4b5d1f1).

Per-call timing breakdown for an LLM round-trip:

```
voice_first_llm_call_start          (client, click → before agent.run_llm)
  llm_function_received             (server, on CF entry)
  llm_request_start                 (server, before provider request)
  llm_first_byte                    (server, on first chunk from provider)
client_stream_timing                (client, 4 phases — see below)
voice_first_llm_call_first_chunk    (client, response_chunk emit)
voice_session_first_audio           (client, first TTS audio out — TTFA)
```

`client_stream_timing` phases (always-on, mirror of `llm_server_timing`):
- `stream_request_dispatched` — just before `fetch()` is dispatched
- `stream_response_headers_received` — when the stream object is available
- `first_event_received` — first iteration of the for-await consume loop
- `first_text_pushed` — first text event lands in textIterable (cortex can start emitting `response_chunk` after this)

## What's deliberately NOT in this doc

- **The legacy `prefetchStartup()` function.** Removed in commit `d42377e`; superseded by `lib/background_loaders/`.
- **`_initInjected` / `_firstLlmCallEmitted` flags.** Module-level guards in the store; useful for grepping but not architecturally interesting.
- **Per-module function fns.** Each module's agent-callable functions are documented in the module file and in `app/modules/tool_creation_skill.md`.

## What to grep for if you need to extend this

| To … | Start at |
|---|---|
| Add a new prefetched item | `lib/background_loaders/index.ts` — add a loader, the onResolve handles context injection. Then add a function fn that calls `loaders.X.get()` in the relevant module. |
| Add a new greeting template variant | `lib/greeting/templates.ts` — append to the matching bucket array. |
| Add a new TTFA span | Either `client_stream_timing` (client-side) or `llm_server_timing` (server-side) — both follow the same phase-tagged pattern. |
| Change first-turn behavior | `useOrchestrator.handleStartStop` (the click handler). The templated greeting block is right after `voice_session_start` is opened. |
| Change the first-LLM-call path | `useSmartChatsStore.runLlm()` — runs when the user speaks. Onboarding directive peek is the only first-call work it does now. |
