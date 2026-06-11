# `lib/greeting` — templated voice greeting

Replaces the LLM-generated "first audio out" with a string-interpolation
+ direct-TTS path. Used by `useOrchestrator.handleStartStop` on Start
click to produce the agent's opening line.

## Why

The first turn used to be a full LLM round-trip: click → CF → provider →
first token → TTS → audio. Measured TTFA in the 5–6 s range on Pro tier
with a ~57k cached input context, completely dominated by provider TTFT
for what was almost always "Hi Sheun, how can I help today?". This
module produces the same string locally in microseconds and hands it
straight to `tivi.ttsQueue.speakText(...)` — total click → first audio
becomes bound by TTS latency (~500–800 ms) instead.

## What it produces

```ts
import { getGreeting } from '@/app/lib/greeting';

const result = getGreeting({ name: 'Sheun' });
// {
//   text: 'Good morning Sheun, what can I help with?',
//   template_id: 'morning_1',
//   time_bucket: 'morning',
//   has_name: true,
// }
```

If no name is passed (or KG hasn't resolved yet), it falls back cleanly
to the `without_name` form of the same template:

```ts
getGreeting()
// { text: 'Good morning, what can I help with?', template_id: 'morning_1', ... }
```

## API

| Field | Default | Notes |
|---|---|---|
| `name` | `undefined` | If empty/missing, no-name variant used |
| `now` | `new Date()` | Override for tests |
| `tz` | browser default | IANA zone, e.g. `America/Chicago` |
| `forceNeutral` | `false` | Skip time-of-day, use `neutral` bucket |
| `excludeRecent` | localStorage state | Template ids to avoid (anti-repeat) |
| `rand` | `Math.random` | Override for deterministic tests |

The returned `template_id` should be passed back as `excludeRecent` on
the next call (or — the default — stored automatically in
`localStorage` under `smartchats.greeting.last_template_ids`, last 3).

## Time buckets

Hour ranges in user-local time (defaults to browser timezone):

| Bucket | Hours | Example openers |
|---|---|---|
| `morning` | 05:00–11:59 | "Good morning…", "Morning…" |
| `afternoon` | 12:00–17:59 | "Good afternoon…", "Hi…" |
| `evening` | 18:00–21:59 | "Good evening…" |
| `night` | 22:00–04:59 | "Hi…" (no "Good night" — it sounds like a farewell) |
| `neutral` | n/a | Time-agnostic; used when `forceNeutral: true` |

## Template structure

15 templates total, distributed 3-per-bucket. Each template has BOTH
`with_name` and `without_name` forms — the catalog never includes a
template that requires a name to function. To add one:

1. Append to the matching bucket array in `templates.ts`.
2. Give it a unique `id` (prefix with the bucket name by convention).
3. Provide both `with_name` (use `{name}` placeholder) and `without_name`.

That's it. The selector picks uniformly at random within the chosen
bucket, skipping ids in `excludeRecent`. If the exclusion list empties
the pool (e.g. only 3 templates and 3 in `excludeRecent`), the
exclusion is dropped — better to repeat than to fail.

## What it deliberately does NOT do

- **No greeting-side LLM call.** The whole point.
- **No KG fetch.** The caller passes the name; this module is pure.
- **No TTS.** The caller hands the returned `text` to the TTS layer.
- **No state besides anti-repeat memory.** No "is the user new",
  "have we onboarded", "are they running late on todos". Those
  decisions belong upstream — this module returns a string.

## Testing

Pure module, no async, no I/O except `localStorage`. Override
`rand` and `now` to make tests deterministic:

```ts
const result = getGreeting({
    name: 'Test',
    now: new Date('2026-06-11T08:00:00-05:00'),
    tz: 'America/Chicago',
    rand: () => 0,  // first template in bucket
});
expect(result.time_bucket).toBe('morning');
expect(result.template_id).toBe('morning_1');
```
