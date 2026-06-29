# llm-service / streaming — combined LLM + TTS NDJSON orchestration

This subtree owns the wire-format and orchestration for the combined
LLM-token + TTS-audio streaming endpoint. Both the cloud Firebase Function
(`smartchats-cloud/functions/src/llm/llm_tts_stream_http.ts`) and the local
Express route (`smartchats-local-server/src/routes/llm.ts` → `/llm/streamWithTTS`)
share this module — `streamLlmTtsToNdjson()` is the single implementation
both call.

## Why this lives in llm-service (not local-server or cloud)

- `llm-service` is the lowest common denominator: cloud + local both already
  depend on it for `handleLLMStreamRequest`, `ResponseSplitter`, and
  `openaiTtsStream`. Putting the orchestrator here is the only direction
  that doesn't create a circular dep.
- Cortex is even lower, but `JsonStreamParser` (cortex) is a primitive the
  orchestrator *uses* — putting the orchestrator there would invert the
  layering.

## The contract

`streamLlmTtsToNdjson()` takes a pre-resolved LLM stream + a TTS callable
+ an HTTP response, and produces an NDJSON-framed stream matching the
`NdjsonFrame` discriminated union in [`types.ts`](./types.ts). The
orchestrator owns the framing; the caller owns provider selection (which
LLM, which TTS adapter) and wrapper concerns (auth, billing, usage write).

```ts
streamLlmTtsToNdjson({
  res,                        // NdjsonStreamResponse (Express or onRequest)
  llmStream,                  // LLMStreamResponse from handleLLMStreamRequest
  tts,                        // TtsStreamFn — provider-agnostic callable
  voice,                      // string, passed to tts on each call
  firstChunkWordThreshold,    // splitter knob, e.g. 8
  firstChunkTimeThresholdMs,  // alternate splitter knob, 0 to disable
  funcReceivedMs,             // optional — wall-clock at handler entry
  emitServerTiming,           // default true
}): Promise<{
  aggregated,        // LLMResponse — usage, output_text, finish_reason, …
  totalTtsChars,     // for caller's billing / usage write
  ttsChunkCount,     // 0..N, in practice ≤ 2
  msTotal,           // ms from entry to `done` frame
}>
```

## NDJSON wire format

Every line is one JSON object with a `t` discriminator. The complete frame
union is in [`types.ts`](./types.ts) (`NdjsonFrame`). Quick reference:

| `t` | Carries | Purpose |
|---|---|---|
| `text` | `d` | LLM token delta |
| `audio_start` | `s, text, ms` | TTS chunk N about to stream |
| `audio` | `s, c, b64` | PCM batch for chunk N (PCM16 24kHz mono, base64) |
| `audio_end` | `s, ms` | TTS chunk N complete |
| `audio_error` | `s, error` | TTS chunk N failed; LLM stream continues |
| `error` | `error` | LLM-level failure |
| `server_timing` | `phase, …` | Timing stamp — see `ServerTimingEvent` below |
| `llm_done` | `data` | LLM aggregated; client may finalize the turn |
| `done` | `data` | Terminal — exactly once, after all TTS settles |

**Wire-format invariants** (enforced by [`stream_llm_tts_to_ndjson.test.ts`](./stream_llm_tts_to_ndjson.test.ts)):

1. `done` is the last line, written exactly once.
2. `llm_done` precedes `done` and follows the last `text`.
3. Every `audio_start` for chunk N is followed eventually by either `audio_end{s:N}` or `audio_error{s:N}`.
4. `audio` frames within a chunk N have monotonically increasing `c` from 0.
5. Chunk 1's `audio_start` may interleave with chunk 0's `audio` frames (parallel TTS).
6. PCM payloads are PCM16 24kHz mono, base64-encoded, sample-aligned.

A wire-format change is a breaking change for every adapter that parses
this stream: `smartchats-backend-local/src/llm.ts:streamWithTTS`,
`smartchats-backend-firebase/src/llm.ts:streamWithTTS`, and the orchestrator
inside `apps/smartchats/app/hooks/useOrchestrator.ts`. Touch them in the
same commit.

## ServerTimingEvent schema (formalized)

The `server_timing` phase set used to live as ad-hoc string literals
inside the cloud handler's `writeLine` calls. It's now a typed
discriminated union in [`types.ts`](./types.ts) (`ServerTimingEvent`).

### LLM-side phases (≤ 1 per request)

| Phase | Fields | Description |
|---|---|---|
| `llm_function_received` | `ts` | Handler entered (wall-clock). |
| `llm_request_start` | `ts, ms_since_function_received` | `handleLLMStreamRequest` called. |
| `llm_first_byte` | `ts, ms_since_request_start, ms_since_function_received` | First LLM token from provider. |

Cross-process deltas (e.g. `client_click → llm_function_received`) are
*caveat'd* in dashboards because browser ↔ Functions clocks drift tens of
ms. Same-process `ms_since_*` are wall-clock-safe.

### TTS-side phases (per chunk; `s` discriminates)

| Phase | Fields | Description |
|---|---|---|
| `tts_request_start` | `s, ts` | TTS adapter call initiated. |
| `tts_first_byte` | `s, ts` | Provider's first HTTP body chunk (from adapter's `onTiming`). |
| `tts_batch_yield` | `s, batch, ts, bytes, provider_bytes_total` | One PCM batch yielded by the adapter. |
| `tts_request_complete` | `s, ts, total_batches, ms_since_first_byte` | TTS chunk finished. |

Per-chunk order is `tts_request_start → tts_first_byte → tts_batch_yield* → tts_request_complete`.

### Sail / dashboard correspondence

Client-side, these `server_timing` frames are emitted into the insights
pipeline as `tts_server_timing` (TTS phases) and `llm_server_timing` (LLM
phases) events, keyed off `phase`. The dashboard query at
`packages/smartchats-sessions/src/analysis_db/tts_timing.ts` joins
`tts_first_byte` with the client-side `tts_playback_first_byte` to compute
the chunk-0→1 gap that voicebench measures. The phase set here is the
*source of truth* — adding a new phase here requires updating that
analyzer and the client parser.

## TTS adapter contract (`TtsStreamFn`)

```ts
type TtsStreamFn = (opts: {
    text: string,
    voice: string,
    onTiming?: (event: TtsTimingEvent) => void,
}) => AsyncIterable<Buffer>
```

Provider-agnostic. The orchestrator never knows about OpenAI, Azure, xAI
WS, or Gemini Live directly — the caller closes over those choices when
constructing the callable.

**Cloud uses:**
```ts
const tts: TtsStreamFn = (o) => openaiTtsStream(client, {
  text: o.text, voice: o.voice, onTiming: o.onTiming,
  model: tts_model, speed: tts_speed,
  instructions: tts_instructions,
  targetBytes: tts_target_bytes,
  firstBatchBytes: tts_first_batch_bytes,
})
```

**Local uses:**
```ts
const tts: TtsStreamFn = (o) => adapter.stream({ text: o.text, voice: o.voice })
```
…where `adapter` is whatever `resolveAdapter(config, tts_provider)`
returned in `smartchats-local-server/src/tts_providers/index.ts`. The
local adapter doesn't currently emit `onTiming` events; once it does,
the same `tts_server_timing` insights reach self-hosted users.

PCM contract on the buffers yielded:
- PCM16, 24 kHz, mono
- Sample-aligned (even byte counts)
- Default batch size ~6400 bytes ≈ 133 ms of audio (provider-specific
  knobs configure this when the caller closes over them)

## What's *not* in this module

| Concern | Lives in |
|---|---|
| Auth / billing gate | Caller (cloud Firebase Function preamble) |
| BYO key resolution | Caller (`smartchats-local-server/src/routes/keys.ts`) |
| Provider routing (which apiKey) | Caller — picks `apiKey` for `handleLLMStreamRequest` |
| Usage write to DB | Caller (`writeUsageRecord` after the orchestrator returns) |
| Billing envelope on `done` | Caller's cloud wrapper — appends to `done.data` before res.end |
| Voice-catalog / cost endpoints | `smartchats-local-server/src/tts_providers/*.ts` |
| TTS adapter resolution | `smartchats-local-server/src/tts_providers/index.ts:resolveAdapter` |

The orchestrator is a *pure framing layer*. Anything I/O-bound that isn't
"send these bytes to the response" lives in the caller.

## Testing

[`stream_llm_tts_to_ndjson.test.ts`](./stream_llm_tts_to_ndjson.test.ts)
locks in the behavioral contract. The test suite uses three fakes — fake
`res`, fake `llmStream`, fake `tts` — so it runs in milliseconds with no
real network. Each `describe` block targets one section of the contract:

1. Wire shape — headers, frame discriminators, ordering, `done` is last
2. Early-split behavior — first audio fires before last text
3. Parallel TTS dispatch — chunk 1 can start before chunk 0 ends
4. TTS failure isolation — `audio_error` doesn't break the LLM stream
5. `server_timing` schema — every phase + its fields
6. Text-only mode — orchestrator omits audio frames when `tts` is absent
7. Return value — `aggregated` + `totalTtsChars` + `ttsChunkCount` + `msTotal`
8. Adapter abstraction — only `TtsStreamFn` is required

Run with `npm --workspace llm-service run test:unit` (or via
`smartchats-test` at L2).

## How to migrate cloud + local handlers to use this

1. Caller resolves LLM stream (already done in both today).
2. Caller resolves TTS adapter + closes over provider-specific params into
   a `TtsStreamFn`.
3. Caller awaits `streamLlmTtsToNdjson({ res, llmStream, tts, voice, … })`.
4. Caller takes the result and does its wrapper-specific finish: write
   usage row, append billing envelope to a `res.end()` extra line, etc.

Each handler shrinks to ~80 lines — the auth/billing/key-resolution
preamble plus the result-finishing tail. The ~150 line orchestration
middle becomes a single function call.
