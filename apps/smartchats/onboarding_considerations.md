# SmartChats Onboarding — Considerations & Design

## Current Status (2026-04-05)

The existing onboarding is completely broken — wrong TTS voice, wrong UI for the mobile shell, needs a full redo. It will be rebuilt as a **mini-app** using the app platform, agent-driven (passive mode). The agent drives the conversation; the app provides UI, state tracking, and onboarding-specific functions.

## Revised Onboarding Flow

### Values System

SmartChats is imbued with a **sattvic value system** — the guiding principles that shape how SmartChats interacts:

- Compassion, Love, Joy
- Equality, Wisdom, Intelligence
- Growth, Holistic well-being

These values inform the tone, priorities, and recommendations throughout the onboarding and beyond.

### Flow Overview

**Step 1 — Welcome & Name**
- S: "What would you like me to call you?"
- User responds with name
- S: "Thanks so much for using SmartChats."

**Step 2 — Overview & Opt-In**
- S: "I'd like to tell you a little bit about SmartChats and what we can do. Is it okay if I do that now, or do you already know what you want to do? You can always come back to this onboarding later if you want."
- If user skips → go straight to normal app interface, onboarding state saved at current progress
- If user continues → proceed

**Step 3 — Brief Product Description**
- S gives a concise overview of what SmartChats is and can do

**Step 4 — Voice Interaction Tutorial** *(before metrics/logs)*
- S: "Before we get into personalizing things, let me give you a quick explanation of voice interaction."
- Explains: audio feedback tones, ability to interrupt, need to speak clear sentences and wait for the tone
- Explains: ability to switch voices by asking, and personalizing the interface
- Keeps it brief

**Step 5 — Metrics & Logs Showcase**
- S explains that SmartChats can:
  - Store **quantitative metrics** about things you care about
  - Store **log entries** about different categories in your life
  - "Once you've generated this data, we can review it together to motivate you and adjust your course to achieve your goals"
- **Shows example visualizations:**
  - Example running metric graph
  - Example dream log search result
  - Each example has a custom visualization inside the moment card — each function has its own interesting animation and resolves to its result before the moment card disappears

**Step 6 — Personalized Metrics & Logs Collection**
- S asks the user what metrics and log categories they're interested in keeping
- Extracts the user's current goals to identify relevant metrics and log categories
- Stores these for the user
- Checked off as completed in onboarding state

**Step 7 — Knowledge Graph & Personalization**
- S explains: "I have an advanced AI memory system capable of remembering facts about you and the relationships between different entities in your life"
- Offers to store the user's interests and priorities
- KG triples created from the conversation

**Step 8 — Apps & Todo**
- S explains the to-do list feature (voice-managed)
- S explains the app system — mini-apps that extend capabilities

**Step 9 — Interface Tour**
- Visual walkthrough of the mobile shell UI elements

### Navigation & Flexibility

At the beginning, after the brief overview, S presents all onboarding sections and asks:
- "Are there particular areas you're most interested in doing first, or do you want to take the whole tour? At any point you can skip if you want."
- User gets a big-picture view of all available onboarding sections
- Can jump to any section or go sequentially
- Can exit at any time — progress is saved

### Architecture: Modular Onboarding Sections

Each onboarding section is defined in its **own file** within the onboarding app directory. This makes it easy to:
- Edit individual section wording without touching other sections
- Add/remove sections from the flow
- Reorder sections
- A/B test different section content

Each section file exports:
- `id` — unique section identifier
- `name` — display name
- `description` — brief description for the overview menu
- `system_msg` — the exact wording S uses to introduce this section
- `prompts` — key phrases/scripts for the agent
- `functions` — section-specific app functions (e.g., `show_metric_example`, `collect_user_goals`)
- `completion_criteria` — what constitutes "done" for this section

The onboarding app's SCM module assembles the active section's system_msg dynamically based on which section the user is in.

```
app/apps/onboarding/
  index.ts                    — app manifest, state_schema, module assembly
  sections/
    welcome.ts                — name collection
    overview.ts               — product description + section menu
    voice_tutorial.ts         — voice interaction explanation
    metrics_showcase.ts       — metrics/logs explanation + example visualizations
    personalization.ts        — collect user goals, metrics, log categories
    knowledge_graph.ts        — KG explanation + interest/priority collection
    apps_and_todos.ts         — todo + app system explanation
    interface_tour.ts         — UI walkthrough
```

---

## Original Design (v1 — reference)

## The Problem

New users on the Claude Mobile V2 shell land on a cinematic voice-first interface with zero guidance — an idle orb on a dark screen with no explanation. There is no onboarding flow, no welcome message, and no progressive introduction to capabilities. The only "new user" behavior is a system message telling the LLM agent to ask for the user's name if the knowledge graph is empty.

## Design Direction: "Sentient Pulse"

The onboarding should feel indistinguishable from the product. No cards, no modals, no tutorial screens. The orb itself teaches the user how to interact with it.

Three layers, each independent:

### Layer 1 — The Pulse (Entry Hook)

App opens to a black screen with a small breathing orb (180px, scaled down from the normal 290px). One line of muted text: **"Tap to wake me up."**

After 3–4 seconds of no interaction, the keyboard icon in the bottom bar pulses once — a subtle signal that text input exists, without breaking the atmosphere.

The user's tap is a consent signal and a natural mic permission primer. iOS/Android permission dialogs feel earned after an intentional tap rather than demanded on cold launch.

### Layer 2 — The Handshake (Payload)

The moment the user taps:

1. Orb expands from 180px to 290px (CSS transition, 600ms)
2. Rings ignite, mic permission fires
3. Agent speaks first: **"Hey — I'm SmartChats. What should I call you?"**
4. User speaks their name → orb reacts to their voice (first magic moment)
5. Agent responds: **"Good to meet you, [Name]. What's on your mind?"**
6. Onboarding dissolves. The real session begins seamlessly — mic is already active.

The agent speaking first is the product's identity statement. A voice app that onboards with text cards is apologizing for being a voice app. This says: we speak first.

### Layer 3 — Ghost Guide (Persistent Safety Net)

Five contextual hints, each fires once in the user's lifetime:

| Hint | Trigger | Text |
|------|---------|------|
| Edge rail | First tool/action use | "I'll show what I'm doing over here" |
| Scroll | First visualization appears | "Scroll down to see what I built" |
| Hold to stop | First agent speaking state | "Tap to interrupt, hold to stop" |
| Keyboard | 8s silence (any session) | "Type here if you prefer text" |
| Settings | 3rd session | "Customize your experience" |

Hints are small frosted chips that appear near the relevant UI element, auto-dismiss after 5 seconds, and never return once seen. The UI whispers when the user looks lost. It never lectures.

## Layer 4 — Appearance Walkthrough

After the Handshake (name collection), the agent has access to three appearance functions: `set_design_pack`, `set_color_mode`, and `set_voice`. The onboarding can use these to give the user a personalized "fitting" — a brief walkthrough where the agent demonstrates its ability to change itself.

### The Flow (Agent-Led, Post-Handshake)

After the user says their first real request and gets a response (so they've seen the product work), the agent can naturally introduce customization:

> *"By the way — I can change how I look and sound. Want to see?"*

If the user says yes:

1. **Voice demo**: *"Here's what I sound like as 'onyx'..."* → `set_voice('onyx')` → agent speaks a sentence in the new voice → *"Or maybe 'shimmer'..."* → `set_voice('shimmer')` → *"Which do you prefer?"*

2. **Theme demo**: *"I can also change the whole vibe..."* → `set_design_pack('midnight')` → pause → `set_design_pack('aurora')` → *"Any of these feel right, or should I go back to default?"*

3. **Mode flip**: *"And dark or light?"* → `set_color_mode('light')` → pause → `set_color_mode('dark')` → settle on preference.

### Why This Works

- Demonstrates three capabilities in 30 seconds without a tutorial
- The user discovers customization by experiencing it, not reading about it
- The agent feels alive — it's not just answering questions, it's reshaping itself
- User preferences are set from day one instead of buried in settings
- It's a natural conversation, not a forced walkthrough — the agent asks, the user reacts

### When to Trigger

- **Not during onboarding** — the Handshake should be tight (name → "what's on your mind?"). Don't bloat it.
- **After 2-3 real exchanges** — the user has seen the product work. Now show them it's customizable.
- **Only once** — track via a Ghost Guide hint (`appearance-walkthrough`) or a localStorage flag
- **Agent-initiated but optional** — if the user says "no" or ignores it, move on. No forcing.

### Implementation

The `createAppearanceModule()` in `app/modules/appearance.ts` provides `set_design_pack`, `set_color_mode`, and `set_voice` functions to the agent via SCM. The agent can call them at any time. The onboarding trigger is just a system prompt nudge or init instruction that says: *"After 2-3 exchanges with a new user, offer to demo theme/voice customization."*

Available design packs: default, midnight, neon_terminal, zen, brutalist, aurora, crypto_gold, creative, oled_black, dev_tools

Available voices: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar

---

## Fallback Paths

### Silent User (Public / No Mic)
If the user doesn't speak within 8 seconds of the agent's greeting, muted text fades in: **"Prefer to type?"** with a keyboard icon pulse. Tapping opens the text composer. The name is collected via text. The flow completes identically.

This path must be first-class — not a consolation route. Some users will always prefer text. The onboarding should work beautifully either way.

### Mic Permission Denied
If the user denies mic access, skip the voice greeting entirely. Show the text composer immediately. The name is collected via keyboard. The agent's greeting appears as text below the orb instead of speech.

### Not Authenticated
The overlay checks auth state before proceeding to mic activation. If the user isn't authenticated (and anonymous auth isn't available), the Firebase login modal opens first. After successful auth, the Handshake continues.

### Returning Users
A simple localStorage flag (`smartchats-onboarding-complete`) gates the entire overlay. Returning users see zero overhead — the overlay never mounts, the normal shell loads instantly.

## Technical Approach

### State Management
A `useOnboarding` hook manages the state machine:
- Phases: `breathing` → `expanding` → `greeting` → `awaiting-name` → `acknowledged` → `dissolving` → `complete`
- Persistence: localStorage for completion flag and Ghost Guide hint tracking
- Timers: 3.5s keyboard affordance in breathing, 8s silence fallback in awaiting-name

### Overlay Architecture
The `OnboardingOverlay` component wraps the shell at the `app3.tsx` level (not inside any specific shell). It's an app-level concern. The real shell renders underneath but hidden, initializing normally in the background. When onboarding completes, the overlay dissolves and the shell becomes visible with zero delay.

### Orb Reuse
The overlay reuses the real `OrbStage` component via a CSS scale trick: `transform: scale(0.62)` gives the 290px orb a 180px appearance during the breathing phase, transitioning to `scale(1)` on tap. No component modifications needed.

### Voice Handoff
The overlay calls `tivi.startListening()` directly for mic init and registers its own speech recognition listener. On completion, it removes its listener and hands off to the orchestrator's real transcript pipeline. The orchestrator's new `handleOnboardingComplete` method wires the real handler without calling `startListening` again (tivi is already active).

### Name Storage
The user's name is stored directly via `graph_utils.store_knowledge([["current_user", "name_is", name]])` — the same knowledge graph the agent uses. The LLM's first real turn will see the name in its startup context (`current_user_kg`).

## Files to Create

| File | Purpose | ~Lines |
|------|---------|--------|
| `app/hooks/useOnboarding.ts` | State machine hook | 100 |
| `app/components/OnboardingOverlay.tsx` | Full-screen overlay | 280 |
| `app/components/GhostGuide.tsx` | Contextual hint layer | 120 |

## Files to Modify

| File | Change | ~Lines Added |
|------|--------|-------------|
| `app/hooks/useOrchestrator.ts` | Add `handleOnboardingComplete` method | 25 |
| `app/app3.tsx` | Wire overlay, pass onboarding state to shell | 40 |
| `core/types/shell.ts` | Extend `ShellMeta` with onboarding bag | 5 |
| `app/shells/ClaudeMobileShellV2.tsx` | Render GhostGuide layer | 15 |

## What We're NOT Changing

- `OrbStage` component — reused as-is
- `VoiceStage` / `VoiceStatus` — untouched
- `initialization.ts` system message — "ask name if new user" stays as a fallback
- `AppDataStore` / cloud storage — localStorage is sufficient for onboarding flags

## Future Idea: "Show, Don't Tell" — Live Metrics After First Conversation

### The Concept

After the Handshake completes and the user has a few real turns of conversation, SmartChats silently reveals its power by surfacing live conversation analytics — without the user asking. The agent says something like: *"By the way — here's what just happened behind the scenes"* and renders a visualization card showing real metrics from the conversation that just occurred.

This is the "wow" moment that transitions from "this is a chatbot" to "this is an instrument."

### What to Show

Metrics that are readily derivable from the first few turns, no special infrastructure needed:

- **Response latency** per turn (bar chart) — how fast the agent responded each time
- **Words per response** — agent vs user, showing the conversation shape
- **Character/token frequency** distribution in the user's speech
- **Conversation flow** — a small timeline showing the voice states (listening → processing → speaking) with durations
- **Pipeline breakdown** — how much time was spent in speech recognition vs LLM vs TTS for each turn

These are all already tracked by the existing telemetry pipeline (`usePipelineTelemetry` stamps, `voice_interaction_complete` events, `performance_metrics` events). The data exists — it just needs a visualization.

### The Deeper Idea: Built-In Usage Metrics as a Feature

This points to something bigger than onboarding: SmartChats should treat **conversation analytics as a first-class metric tracking feature**. The metrics module (`app/modules/metrics.ts`) already supports user-defined tracked metrics. What if the system automatically tracked a set of conversation-level metrics from day one?

Built-in auto-tracked metrics:
- `response_latency_ms` — per turn
- `words_per_response` — agent and user
- `turns_per_session` — conversation depth
- `voice_vs_text_ratio` — input modality preference
- `tts_duration_ms` — speaking time per response
- `context_utilization_percent` — how much of the context window is used

These accumulate silently in the background from the very first interaction. Then during onboarding (after 3-4 turns), the agent can surface them as a live visualization — demonstrating both the graphing capability and the metrics system in one move.

### Why This Works for Onboarding

1. **Demonstrates capability through real data** — the user sees their own conversation reflected back as a rich visualization, not a canned demo
2. **Shows the graphing/viz system** — the user discovers that SmartChats can render charts and visuals, without being told
3. **Shows the metrics system** — seeds the idea that SmartChats tracks and analyzes things over time
4. **Creates a "how did it do that?" moment** — the user didn't ask for analytics, but there they are, personalized and real
5. **The data was collected passively** — no extra work during onboarding, the telemetry pipeline was already running

### Implementation Sketch

- During onboarding turns, the `voice_interaction_complete` events already fire with full pipeline timestamps
- After the 3rd or 4th real turn post-onboarding, the agent (via init instructions or a system prompt nudge) generates a small visualization using the conversation data
- The viz renders in the existing `VizStack` — no new UI needed
- Alternatively, a dedicated "Session Stats" card could be a Ghost Guide-style moment that appears once after first session

### Open Questions

- Should this be agent-initiated (LLM decides to show stats) or system-initiated (hard-coded trigger after N turns)?
- Should it use the existing metrics module (`fetchMetricsContext`) or read directly from the insights event stream?
- How aggressive should the timing be? After 3 turns feels natural. After 1 turn feels premature. After 10 turns might be too late — the "wow" window closes.
- Should the auto-tracked conversation metrics persist across sessions (enabling "your weekly SmartChats report" style features later)?

---

## Onboarding as a Mini-App (Consolidated Notes — 2026-03-31)

High-level: Onboarding should be treated as the first "mini-app" inside SmartChats. It should have its own persisted state across interactions (what steps are completed), and support both voice-driven progression and direct UI/touch interaction, with the UI updating in response to voice and vice versa.

### Content the Onboarding Flow Should Cover

1. **Product pitch and promise**: Briefly explain what SmartChats is and what the user gets out of it.
2. **Voice selection first**: Let the user browse and test voices before anything else. Once selected, use that TTS voice for the rest of onboarding (and ideally for future `accumulate_text` prompts too). *(Aligns with Layer 4 — Appearance Walkthrough above, but promotes voice selection to happen earlier.)*
3. **Explain logs vs metrics**: Teach the user the difference between logs and metrics, and how to query them.
4. **Teach `accumulate_text`**: How to dictate longer entries and end with the word "finished."
5. **Sound/feedback system**: Clear audible feedback for listening/speaking/thinking/saved states; improve overall sound cues.
6. **User interrupt**: How the user can interrupt the agent; ensure the UI affordance exists and is explained. *(Connects to Ghost Guide hint "Tap to interrupt, hold to stop" in Layer 3.)*
7. **Progress visualization**: Use GSAP for sleek animations and to show what onboarding steps are complete vs incomplete.

### Architectural Implications

- **Persisted onboarding state**: The current design uses a single `smartchats-onboarding-complete` localStorage flag. This needs to expand into a per-step completion map so users can resume onboarding across sessions and the system knows which steps are done.
- **Bidirectional voice ↔ UI**: Voice commands should advance the onboarding flow and update the UI; tapping UI elements should also advance the flow and be acknowledged by voice.
- **GSAP integration**: Progress visualization requires adding GSAP (or similar) for step-completion animations — the current CSS transition approach (orb scale) is insufficient for a multi-step progress display.

---

## Strategic Notes

### Why This Beats the Alternatives

**Story cards** (swipeable tutorial): Too "SaaS." Borrowed pattern that signals the product couldn't teach itself. Every user taps through without reading.

**Auto-playing demo**: Watching a video of an app is never as cool as using the app. Creates a "spectator" delay. Better as an App Store preview or landing page asset.

**Persona selection** ("I want to build" / "I want to talk"): Creates work before the user feels anything. Better to infer intent from the conversation itself.

**No onboarding** (Ghost Guide only): Under-expresses the magic for a new product. One strong orchestrated moment is needed to set the tone.

### The Recording Opportunity

The Pulse → Handshake sequence — orb breathing in the dark, user taps, orb ignites, agent speaks — is the App Store preview video. Record a real first-user session. That 15-second clip is the highest-converting ad asset because it IS the product, not a description of it.

### The Principle

**Make the onboarding feel authored, but never feel separate.**

The user's first act is the product's core interaction: speaking to the orb. Every second of onboarding is a second of genuine product usage. The emotional hook (waking something up) is memorable, demonstrable, and marketable.
