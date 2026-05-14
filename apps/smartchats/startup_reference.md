# SmartChats Startup & Initialization Reference

## Timeline

```
APP MOUNT
├─ InsightsProvider ready → setInsights to store, billing, classifier
├─ FPS Monitor init
├─ useCortexAgent() → creates Cortex with SCM + 23 modules + ProcessManager
├─ useTivi() → voice + VAD + speech recognition
├─ useOrchestrator() → event dispatch + voice lifecycle
├─ Wire orchestrator TTS callbacks → tivi
├─ Register voice actions in store
└─ loadSettings() (awaited)
   ├─ Legacy migration
   ├─ Create/upgrade AppDataStore
   ├─ Wait for Firebase auth (cloud mode)
   ├─ Load persisted settings
   └─ checkAuth()

FIREBASE USER DETECTED
└─ Warmup (fire-and-forget, parallel)
   ├─ COR.runner.warmup() — warm streaming LLM container
   ├─ warmupTtsStreamHttp() — warm TTS Cloud Function
   └─ prefetchStartup() — parallel data fetch:
      ├─ fetchInitInstructions()
      ├─ fetchProceduralInstructions()
      ├─ fetchMetricsContext()
      ├─ fetchLogCategories()
      ├─ fetchTodosContext()
      ├─ search_knowledge_deep('current_user', depth=2)
      └─ seedBuiltinApps() → listInstalls() → getApp() for each

FIRST LLM TURN
└─ runLlm() (first-call guard)
   ├─ await prefetchStartup() (ensures completion)
   ├─ inject init data into agent
   ├─ set installedApps + appManifestCache in store
   └─ agent.run_llm(4)
```

## Key Init Functions

| Function | File | Trigger | Awaited | What |
|----------|------|---------|---------|------|
| `useCortexAgent()` | `hooks/useCortexAgent.ts` | Model/auth change | Async | Creates Cortex agent |
| `useTivi()` | `@lab-components/tivi` | App mount | Sync | Voice + VAD |
| `useOrchestrator()` | `hooks/useOrchestrator.ts` | Tivi/agent ready | Sync | Event dispatch |
| `loadSettings()` | `useSmartChatsStore.ts:308` | insightsReady | Yes | Settings + auth |
| `prefetchStartup()` | `modules/initialization.ts:41` | Firebase user | Fire-and-forget | All startup data |
| `COR.runner.warmup()` | via `app3.tsx:345` | Firebase user | Fire-and-forget | LLM container |
| `warmupTtsStreamHttp()` | via `app3.tsx:346` | Firebase user | Fire-and-forget | TTS container |
| `runLlm()` first-call | `useSmartChatsStore.ts:1225` | First user input | Yes | Inject init data |
| `seedAndLoadApps()` | `useSmartChatsStore.ts` | Manual / Simi | Yes | Seed + load apps |

## Notes

- `prefetchStartup()` is a singleton promise — multiple calls return the same promise
- `_initInjected` guard ensures startup data injected only once per session
- Seeding is inside `prefetchStartup` as one of 7 parallel tasks
- `seedAndLoadApps()` is an independent store action for direct seeding (used by Simi flows)
- Settings load blocks UI; everything else is fire-and-forget
