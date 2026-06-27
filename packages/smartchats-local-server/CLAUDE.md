# smartchats-local-server — self-hosted Express backend

HTTP implementation of the `SmartChatsBackend` contract. Runs against a local SurrealDB with BYO API keys; no billing envelope, no external auth. Mounted at `/local-api/*` (see `src/app.ts:108`). Browser hits it directly in prod; Next dev rewrites `/local-api/*` to this server.

Client side is `packages/smartchats-backend-local/` — that adapter speaks this server's wire format and nothing else. If you change framing here, change it there in the same commit.

## Routes (mounted in `src/app.ts:52-60`)

| Path | File | Purpose |
|---|---|---|
| `/health` | `routes/health.ts` | Liveness + per-provider key status |
| `/llm` | `routes/llm.ts` | Text + **combined LLM+TTS** streaming (see below) |
| `/tts` | `routes/tts.ts` | Standalone TTS |
| `/embeddings` | `routes/embeddings.ts` | OpenAI embeddings passthrough |
| `/data` | `routes/data.ts` | SurrealDB CRUD |
| `/usage` | `routes/usage.ts` | Usage reporting |
| `/keys` | `routes/keys.ts` | BYO key resolution per provider |
| `/tools` | `routes/tools.ts` | Tool dispatch (e.g. URL fetch + readability) |
| `/insights` | `routes/insights.ts` | OTel-shaped event ingest (writes to `insights_events`) |

---

# Combined LLM + TTS streaming — `POST /llm/streamWithTTS`

**This is the OSS equivalent of cloud's `llm_tts_stream_http`.** Same contract, same NDJSON wire format. If you're benchmarking TTS providers or hunting voice latency, this is the handler that matters.

Defined in `src/routes/llm.ts:182`. The combined pipeline lives entirely in that one handler — the LLM stream and parallel TTS dispatch are interleaved into a single NDJSON response.

## The early-split pattern

1. LLM stream tokens arrive (`llm-service.handleLLMStreamRequest`).
2. `JsonStreamParser` (cortex) extracts the response text from the stream.
3. `ResponseSplitter` (llm-service) buffers text until **8 words** (`FIRST_CHUNK_WORD_THRESHOLD`, `llm.ts:51`) and fires the first TTS chunk early — `fireTts()` at `llm.ts:246`.
4. LLM keeps streaming while OpenAI TTS synthesizes that first chunk **in parallel**. PCM is base64-framed back into the same NDJSON stream as `audio_start` / `audio` / `audio_end` events.
5. When the LLM finishes, `splitter.flushRemainder()` fires the second (and final) TTS chunk.

In-flight TTS calls are tracked via `ttsPromises[]`; the handler awaits all of them before writing the `done` frame. This is what makes the early-split safe — the response stream stays open until every audio chunk has streamed back.

## Wire format

NDJSON. Each line is a JSON object with a discriminator `t`:

| `t` | Fields | Meaning |
|---|---|---|
| `text` | `d: string` | LLM token chunk |
| `audio_start` | `s: chunkIdx, text, ms` | TTS for chunk N about to stream |
| `audio` | `s, c, b64` | One PCM batch for chunk N |
| `audio_end` | `s, ms` | Chunk N audio complete |
| `audio_error` | `s, error` | TTS failure for chunk N (LLM stream continues) |
| `error` | `error` | LLM stream failure |
| `done` | usage, cost, timings | Terminal frame |

PCM16, 24 kHz, mono — matches `openaiTtsStream` and voicebench's `TtsProvider` contract.

## Cross-references

- **Interface that enables the parallel pattern**: `packages/voicebench/src/providers/_types.ts:74-91` — `TtsProvider.connect()` split from `TtsConnection.stream()` exists so callers can warm a TTS connection in parallel with LLM token generation ("speculative connect").
- **Benchmark harness**: `packages/voicebench/src/runner.ts` — measures `connect()` + `stream()` sequentially for clean per-provider numbers. Does NOT exercise the combined pipeline; this handler is the only place that does.
- **Cloud equivalent (closed)**: `packages/smartchats-cloud/functions/src/llm/llm_tts_stream_http.ts` — same shape, adds billing envelope + speculative-connect for WS providers (Azure, xAI, Gemini Live). See `apps/site/content/blog/voice-stutter-tts-benchmark.md:704-721`.
- **Client adapter**: `packages/smartchats-backend-local/src/llm.ts:56` — `streamWithTTS()` HTTP wrapper.
- **Client caller**: `apps/smartchats/src/lib/llm_caller.ts:333` — the only consumer; both text and voice flows go through it.
- **Backend interface**: `packages/smartchats-backend/src/types.ts:199` — method signature.

## Conventions specific to this server

- **BYO keys only** — `requireProviderKey()` (`llm.ts:67`) returns 400 if a provider key isn't configured. Two keys may be required per `streamWithTTS` call: the LLM provider's key + OpenAI's key for TTS.
- **No billing envelope** in the `done` frame. Client adapter treats `billing` as optional.
- **Usage written per call** to SurrealDB via `writeUsageRecord` (`src/usage_writer.ts`). `streamWithTTS` writes TWO rows — one LLM, one TTS — billed separately.
- **TTS cost** uses `estimateGpt4oMiniTtsCost` (per-token, 2% safety margin). The voicebench OpenAI provider delegates to this same function for parity (`packages/voicebench/src/providers/openai.ts:21`).
- **Wire-format changes are breaking** — every `SmartChatsBackend` adapter shares this NDJSON shape. Update `smartchats-backend-local` (and the cloud client) in the same commit.

## When you touch this handler

- Run voicebench against OpenAI to confirm TTS cost numbers didn't drift.
- Hit `/llm/streamWithTTS` end-to-end via `bin/devserve` and an `apps/smartchats` voice turn — the orchestrator at `apps/smartchats/app/hooks/useOrchestrator.ts` consumes the audio frames; mis-framing shows up as silent turns or stuck queues.
- Telemetry stamps that pair with this handler are documented in `apps/smartchats/CLAUDE.md` § Telemetry under `llm_server_timing` — three `phase` stamps per call (`llm_function_received`, `llm_request_start`, `llm_first_byte`).
