# voicebench

Streaming TTS provider benchmarking. Same scenario, same metrics, multiple providers — apples-to-apples latency + cost comparison.

## Why

The chunk-0→1 stutter investigation (commits `f598f6b` open / `75e96ee` cloud, see `AUDIO_TIMING.md` in cloud) showed OpenAI's TTS has a slow first-batch ramp that no amount of player-side tuning fully hides. The real fix is either bumping the initial lookahead (degrades TTFA), switching providers (unknown until measured), or going to a provider that supports continuous streaming.

This package exists so the provider-switch decision is driven by data, not vendor claims.

## Design

```ts
// The swappable contract — any conformant adapter plugs into the same harness
// AND can be lifted straight into cloud's llm_tts_stream_http.ts as a one-line
// import swap when a winner emerges.
interface TtsProvider {
    connect(opts: ConnectOpts): Promise<TtsConnection>;
    estimateCost(opts): CostEstimate;
    listVoices(): string[];
}

interface TtsConnection {
    stream(opts: StreamOpts): AsyncIterable<Buffer>;  // PCM16 24kHz mono
    close(): Promise<void>;
    readonly setup_ms: number;
    readonly is_cold: boolean;
}
```

`connect()` is split from `stream()` so the runner can measure the WS handshake
overhead separately and so prod can use a **speculative-connect pattern**:
fire `provider.connect(...)` at the top of `llm_tts_stream_http` so the WS
handshake completes in parallel with the LLM producing its first 8 words.

## Today's providers

| Provider | Status |
|---|---|
| `openai` | Reference adapter wrapping the existing `openaiTtsStream` from llm-service. Done. |
| `xai_ws` | Planned — xAI WebSocket TTS with `optimize_streaming_latency: 1` |
| `gcp_streaming` | Planned — Google Cloud TTS `StreamingSynthesize` (gRPC bidi), lift from `tidyscripts/bin/dev/ws_stream_server_gcp.ts` |
| `gemini_live` | Planned — Gemini Live API (WS), heaviest surface, newest |

## Running

```bash
# Smoke (1 provider, 1 scenario, default 3 trials)
npm run bench -- --providers openai --scenarios short

# Full sweep (all providers, all scenarios, 5 trials each)
npm run bench -- --providers openai,xai_ws,gcp_streaming,gemini_live \
                 --scenarios short,medium,long --trials 5 \
                 --out results/run_$(date +%s).json
```

Output is two tables — per-trial (every measurement visible, for outlier
spotting) and per-(provider, scenario) aggregate (median/p95/max for
ranking). With `--out`, raw trials are persisted as JSON for later
`compare` runs (planned).

## Metrics

Each trial captures:

- `setup_ms` — connect() duration. ~0 for HTTP/pooled; ~100-300ms for fresh WS.
- `time_to_first_byte_ms` — stream() call → first byte from provider.
- `batches[]` — per-batch `{ index, ms_from_stream, bytes, provider_bytes_cumulative }`. Re-batched to ~6400 bytes (~133ms of audio) for cross-provider comparability.
- `total_response_ms` — stream() call → last byte.
- `total_audio_ms` — duration of generated audio (= total_bytes / 48000 for PCM16 24kHz mono).
- `estimated_cost_usd` — best-effort, per-provider model.
- Headline derived metric: `interBatch01Ms` — the gap between batch 0 and batch 1 yielding. **This is the chunk-0→1 stutter signal.** If a provider's median for this metric stays under the player's snap budget (333ms), the stutter goes away in prod.

## Adding a provider

1. New file `src/providers/<name>.ts` implementing `TtsProvider`
2. Re-batch to 6400 bytes per yielded Buffer (so cross-provider numbers stay comparable)
3. Fire `onFirstByte` once, `onBatchYield` per yielded batch
4. Per-provider cost constants in `estimateCost`
5. Register in `scripts/bench.ts:buildProvider`

## Known imprecisions

- OpenAI cost model is currently off by ~100x — I'm using a per-million-token formula but OpenAI's actual gpt-4o-mini-tts billing is per-audio-minute. Don't trust `cost_usd` yet; will calibrate as the other providers land (each needs its own correct constants anyway).
- `providerBytesCumulative` for OpenAI is the same as the yielded chunk bytes (the SDK doesn't expose pre-batched byte counts). Other providers may give richer data — useful for upstream-vs-downstream attribution analysis like we did for the chunk-0→1 stutter.

## Plug-in to prod when a winner is picked

When the benchmark identifies the winning provider, swap it into `packages/smartchats-cloud/functions/src/llm/llm_tts_stream_http.ts`:

```ts
// Was:
import { openaiTtsStream } from 'llm-service';
// for await (const pcm of openaiTtsStream(openai, { text, voice, ... })) { ... }

// Becomes:
import { OpenAITtsProvider, XaiTtsProvider, GcpStreamingTtsProvider } from 'voicebench';
const provider = pickProvider(process.env['TTS_PROVIDER']);
const conn = await provider.connect({ voice });  // fire early for speculative warm
// ... LLM streams ...
for await (const pcm of conn.stream({ text, instructions })) { ... }
```

Behind a feature flag for A/B in /sail.
