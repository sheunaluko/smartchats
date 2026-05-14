# Pulse Stream — Event-Driven Mobile Voice Visualization

## Context

The `MobileVoiceShell` is state-snapshot oriented — it shows where things are *right now* but not the flow of what's happening. With 32 event types firing during an interaction (thoughts, response chunks, code execution, function calls, process spawns, context status), the user sees almost none of that activity. The `VoiceMoment` abstraction exists but only 3-4 event types create moments, and only 1 renders at a time.

Goal: make the AI's work visible as a real-time animated stream so users see the engine thinking, calling tools, executing code, and getting results — not just a spinner.

## Architecture

```
useOrchestrator handleEvent(evt)
        ↓
   existing store handlers (unchanged)
        +
   useMomentStream(evt)  ← NEW HOOK
        ↓
   MobileVoiceViewModel extended:
     .moments[]    → rolling buffer of 8 (was: max 1)
     .pulses[]     → event category pulses for orb ring
     .activity     → { contextPercent, latencyMs, loopIndex }
```

### Data flow

Events reach the shell the same way they always have — via `COR.on('event', handleEvent)` in `useOrchestrator`. The new `useMomentStream` hook taps into the same event stream (registered as a second listener or called from `handleEvent`). It maintains a rolling buffer of `VoiceMoment` entries with lifecycle states, event pulse timestamps, and activity metrics. All animation state managed via refs + rAF (no excessive re-renders).

## Changes

### 1. Extend `VoiceMoment` type

**`apps/smartchats/app/types/mobileVoice.ts`**

```typescript
// Extend VoiceMomentKind
export type VoiceMomentKind =
  | 'result'
  | 'confirmation'
  | 'media'
  | 'action'
  | 'info'
  | 'thinking'      // NEW
  | 'response'      // NEW
  | 'process';      // NEW

// Add lifecycle + timestamp to VoiceMoment
export type VoiceMoment = {
  id: string;
  kind: VoiceMomentKind;
  title?: string;
  body?: string;
  meta?: string;
  status?: 'running' | 'success' | 'error';   // NEW: for updatable moments
  lifecycle: 'active' | 'compact' | 'exiting'; // NEW: animation state
  ts: number;                                   // NEW: for ordering + age cleanup
};

// NEW: Event pulse for orb ring
export type EventPulse = {
  category: 'thinking' | 'responding' | 'executing' | 'tools' | 'process';
  ts: number;
};

// NEW: Activity metrics
export type ActivityMetrics = {
  contextPercent: number;
  latencyMs: number;    // time since turn_start
  loopIndex: number;    // which agentic loop iteration
  visible: boolean;     // only during active processing
};
```

### 2. Create `useMomentStream` hook

**`apps/smartchats/app/hooks/useMomentStream.ts`** (NEW FILE)

Responsibilities:
- Receives events via a `pushEvent(evt)` function (called from `handleEvent` in useOrchestrator)
- Maps events to `VoiceMoment` entries (see mapping table below)
- Manages moment lifecycle transitions (active → compact → exiting → removed)
- Tracks event pulses as `EventPulse[]` (trimmed to last 2s)
- Tracks activity metrics (context %, latency timer via rAF, loop count)
- Updates moments in-place for paired events (e.g. `code_execution_start` creates moment, `code_execution_complete` updates its status)
- Exposes: `{ moments, pulses, activity, pushEvent }`

**Event → Moment mapping:**

| Event | Moment kind | Title | Icon | Notes |
|-------|-------------|-------|------|-------|
| `thought` | `thinking` | truncated thought (80 chars) | Brain | Replaces previous thinking moment |
| `response_complete` | `response` | first sentence of response | Volume2 | |
| `code_execution_start` | `action` | "Running code" | Play | `status: 'running'` |
| `code_execution_complete` | — | updates above moment | — | `status: 'success'/'error'`, adds duration to meta |
| `sandbox_event:function_start` | `action` | "Using {name}" | Wrench | `status: 'running'` |
| `sandbox_event:function_end` | — | updates above moment | — | `status: 'success'`, adds duration |
| `sandbox_event:function_error` | — | updates above moment | — | `status: 'error'` |
| `process_spawned` | `process` | "{name} started" | Terminal | `status: 'running'` |
| `process_complete` | — | updates above moment | — | `status` from exit code |
| `context_status` (>80%) | `info` | "Context {n}%" | Gauge | Only when approaching limit |
| `workspace_update` | `info` | "Workspace updated" | Database | Fades fast |
| `turn_start` | — | — | — | Resets latency timer, increments loop on subsequent calls |
| `turn_complete` | — | — | — | Stops latency timer, hides activity band after 3s |

**Event → Pulse mapping:**

| Event | Pulse category |
|-------|---------------|
| `thought_chunk`, `thought` | `thinking` |
| `response_chunk`, `response_complete` | `responding` |
| `code_execution_start`, `code_execution_complete`, `sandbox_log` | `executing` |
| `sandbox_event:function_start`, `sandbox_event:function_end` | `tools` |
| `process_spawned`, `process_output`, `process_complete` | `process` |

**Lifecycle management (runs on 1s interval):**
- Moments older than 5s in `active` state → transition to `compact`
- Moments with `status: 'running'` stay `active` regardless of age
- Moments older than 15s in `compact` state → transition to `exiting`
- Moments in `exiting` state → removed after 500ms (exit animation duration)
- Max 8 moments in buffer; oldest `compact` moments evicted first
- Pulses older than 2s → removed

### 3. Wire `useMomentStream` into `useOrchestrator`

**`apps/smartchats/app/hooks/useOrchestrator.ts`**

- Import and call `useMomentStream()`
- In `handleEvent` switch, add `momentStream.pushEvent(evt)` call at the top (before the existing switch cases — all events flow through, the hook decides what to visualize)
- Return `momentStream` from the hook so `app3.tsx` can pass it to the shell

### 4. Extend `ShellProps` and `MobileVoiceViewModel`

**`apps/smartchats/core/types/shell.ts`**

Add to `ShellProps`:
```typescript
momentStream?: {
  moments: VoiceMoment[];
  pulses: EventPulse[];
  activity: ActivityMetrics;
};
```

### 5. Update `MobileVoiceShell` to consume moment stream

**`apps/smartchats/app/shells/MobileVoiceShell.tsx`**

- Accept `momentStream` from props (fallback to existing `vm.moments` derivation if not provided)
- Replace single `<ResultCard moment={vm.moments[0]} />` with `<MomentStream moments={momentStream.moments} />`
- Pass `pulses` to `<VoiceStage>` wrapper
- Render `<ActivityBand>` between orb and moment stream (conditionally visible)

### 6. Create `MomentStream` component

**`apps/smartchats/app/ui/recipes/MomentStream.tsx`** (NEW FILE)

Renders a vertical list of moments with lifecycle-based animation classes:
- `active` → full height (icon + title + body + meta), `animate-sc-slide-in-up`
- `compact` → single-line pill (icon + title, 28px), transition via `max-height` + opacity
- `exiting` → fade out + slide down, `animate-sc-fade-out`
- Moments with `status` show a small status indicator (spinner/check/x)
- Uses existing `DataCard` component for structure, `SurfacePanel` for background
- Max visible: 4-5 moments, scrollable if more

### 7. Create `EventPulseRing` component

**`apps/smartchats/app/ui/recipes/EventPulseRing.tsx`** (NEW FILE)

Thin wrapper rendered around `VoiceStage` children. 5 small dots positioned around the orb perimeter:
- 12 o'clock: thinking (amber/`--sc-warning`)
- 3 o'clock: responding (blue/`--sc-primary`)
- 6 o'clock: executing (green/`--sc-success`)
- 9 o'clock: tools (purple/`--sc-accent`)
- scattered: process (muted)

Each dot: 6px circle, resting opacity 0.15. When a pulse fires for that category, scales to 1.4x + opacity 1.0, then decays back over 600ms. Animation via rAF + refs (reads `pulses[]` array, no re-render per pulse).

### 8. Create `ActivityBand` component

**`apps/smartchats/app/ui/recipes/ActivityBand.tsx`** (NEW FILE)

Horizontal strip with 3 micro-indicators:
```
[  ◉ 43%  |  ⚡ 1.2s  |  ⟳ 2  ]
   context    latency   loop#
```
- Context %: color shifts green→amber→red based on thresholds (60/80/95%)
- Latency: live timer counting up from `turn_start`, formatted as "0.0s" / "1.2s" / "12s"
- Loop #: agentic loop iteration count
- Entire band fades in on `activity.visible=true`, fades out 3s after `turn_complete`
- Compact: 28px height, `text-[0.65rem]`, muted colors

### 9. Add CSS animations

**`apps/smartchats/app/globals.css`**

```css
@keyframes sc-fade-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(8px); }
}
.animate-sc-fade-out {
  animation: sc-fade-out 0.4s ease-out forwards;
}

@keyframes sc-pulse-dot {
  0% { transform: scale(1); opacity: 0.15; }
  20% { transform: scale(1.4); opacity: 1; }
  100% { transform: scale(1); opacity: 0.15; }
}
.animate-sc-pulse-dot {
  animation: sc-pulse-dot 0.6s ease-out;
}
```

### 10. Export new recipes

**`apps/smartchats/app/ui/recipes/index.ts`**

Add exports for `MomentStream`, `EventPulseRing`, `ActivityBand`.

## Files Modified

| File | Change |
|------|--------|
| `app/types/mobileVoice.ts` | Extend types |
| `app/hooks/useMomentStream.ts` | **NEW** — core hook |
| `app/hooks/useOrchestrator.ts` | Wire `pushEvent` call |
| `core/types/shell.ts` | Add `momentStream` to `ShellProps` |
| `app/shells/MobileVoiceShell.tsx` | Consume moment stream, replace single ResultCard |
| `app/ui/recipes/MomentStream.tsx` | **NEW** — moment list component |
| `app/ui/recipes/EventPulseRing.tsx` | **NEW** — orb pulse ring |
| `app/ui/recipes/ActivityBand.tsx` | **NEW** — live metrics strip |
| `app/ui/recipes/index.ts` | Export new components |
| `app/globals.css` | Add animations |

## What stays unchanged

- `VoiceStage` / `OrbStage` — orb animation logic untouched, pulse ring wraps it
- `TranscriptLine`, `AssistantMoment` — user speech + assistant text display unchanged
- `InterruptBar`, `ActionRail`, `FallbackComposer` — interaction controls unchanged
- `SessionMiniHeader` — header unchanged
- `deriveState()` — voice state derivation unchanged
- All existing store handlers — moment stream is additive, doesn't replace anything
- `useOrchestrator` event routing — existing handlers stay, `pushEvent` is one line added at top of switch

## Verification

1. `cd apps/smartchats && npm run type-check`
2. Dev server: verify MobileVoiceShell renders without errors
3. Start voice session → speak → verify:
   - Orb pulse dots light up as events fire (thinking dot during LLM call, responding dot during response stream)
   - Moment stream shows "Thinking..." moment during LLM, replaced by response moment
   - Activity band appears with context % and latency timer
   - Moments transition from active → compact → exit gracefully
4. Trigger code execution (ask agent to run code) → verify:
   - "Running code" moment appears with spinner
   - Function call moments appear for tool uses
   - Completion updates moment status to success/error with duration
5. `await window.__smartchats__.simi.workflows.basic_chat_flow()` — normal flow still works
6. Check no performance regression: rAF-based animations shouldn't cause jank on mobile
