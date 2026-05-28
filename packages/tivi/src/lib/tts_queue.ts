/**
 * TTS Speech Queue
 *
 * Sentence chunking, parallel prefetch, sequential playback.
 * Backend-agnostic via injectable TTSCallFn.
 */

import { logger } from 'smartchats-common';
const log = logger.get_logger({ id: 'tivi/tts_queue' });

// ─── Types ─────────────────────────────────────────────────────────

export type TTSCallFn = (text: string, voice: string, model: string, speed?: number) => Promise<AudioBuffer>;

export type TTSStreamCallFn = (
  text: string, voice: string, model: string, speed?: number
) => Promise<{
  stream: AsyncIterable<Float32Array>;  // PCM float32 chunks, ready for AudioBuffer
  done: Promise<void>;                  // Resolves when server finishes (billing settled)
}>;

export type QueueEntryStatusType = 'queued' | 'loading' | 'playing' | 'done' | 'error';

export interface QueueEntryStatus {
  id: number;
  text: string | null;
  status: QueueEntryStatusType;
  cached?: boolean;
}

/**
 * Per-chunk timing sample inside a streaming utterance. `arrival_ms` is
 * relative to the start of `playStream` (or `playExternalStreamAudio`).
 * `schedule_slack_ms` is `scheduleTime - ctx.currentTime` at the moment
 * `source.start()` is called — the lookahead headroom the audio thread
 * had for this chunk. Negative values mean we'd already missed; the
 * stream-scheduler snapped forward to `ctx.currentTime + 10ms`.
 * `snapped_forward` is true when that snap fired for this chunk.
 */
export interface TtsChunkSample {
  index: number;
  arrival_ms: number;
  samples: number;
  duration_ms: number;
  schedule_slack_ms: number;
  snapped_forward: boolean;
}

/**
 * Aggregated timing event for one streaming TTS utterance. Built inside
 * `tts_queue.ts` and fired once per utterance via `onTtsPlaybackTiming`
 * (cancelled or not). Designed to diagnose first-chunk audio glitches:
 * if `first_chunk.snapped_forward` is true and `first_chunk.schedule_slack_ms`
 * is near zero, the audio thread had no lookahead when chunk 0 started —
 * the most likely cause of the audible click/silence at the start of
 * an utterance.
 *
 * `chunks` is capped to keep insights payload bounded.
 */
export interface TtsPlaybackTimingEvent {
  utterance_id: string;
  text_preview: string;
  path: 'stream' | 'external_stream';
  /** AudioContext state observed BEFORE any resume. */
  ctx_state_before: AudioContextState;
  /** Time spent in `await ctx.resume()`, null if state was already running. */
  ctx_resume_ms: number | null;
  /** AudioContext.baseLatency in ms (browser/OS audio output floor). */
  ctx_base_latency_ms: number;
  /** AudioContext.outputLatency in ms if supported, else null. */
  ctx_output_latency_ms: number | null;
  /** Time from playStream entry to TTS server returning the first byte (request → response). */
  connect_ms: number | null;
  /** Configured lookahead (ms) used to seed scheduleTime. */
  initial_lookahead_ms: number;
  /** Configured snap-forward target (ms) used when scheduleTime falls behind. */
  snap_lookahead_ms: number;
  /** Total time playStream spent receiving + scheduling chunks. */
  stream_duration_ms: number;
  /** Total audible audio scheduled, in ms. */
  total_audio_ms: number;
  /** Count of chunks received (not necessarily == chunks.length, which is capped). */
  total_chunks: number;
  /** Count of chunks that triggered snap-forward (schedule fell behind ctx.currentTime). */
  snap_forward_count: number;
  /** First-chunk metrics, broken out for fast querying. */
  first_chunk: TtsChunkSample | null;
  /** Capped sample of chunks (currently first 10). */
  chunks: TtsChunkSample[];
  cancelled: boolean;
}

export interface TTSSpeechQueueConfig {
  /** AudioBuffer-based TTS (OpenAI etc). Optional when speakFn is provided. */
  ttsCallFn?: TTSCallFn;
  /** Optional streaming TTS — plays audio as chunks arrive. Falls back to ttsCallFn when absent. */
  ttsStreamCallFn?: TTSStreamCallFn;
  /** Browser TTS — speaks text directly via SpeechSynthesis. Used when no ttsCallFn. */
  speakFn?: (text: string, speed: number) => Promise<void>;
  /** Cancel browser TTS playback */
  cancelFn?: () => void;
  /** Max concurrent TTS network calls in flight. Default: 3 */
  prefetchCount?: number;
  voice?: string;
  model?: string;
  playbackRate?: number;
  onStart?: () => void;
  onDrain?: (info: { cancelled: boolean }) => void;
  onError?: (error: Error) => void;
  onStateChange?: (entries: QueueEntryStatus[]) => void;
  getCachedBuffer?: (text: string, speed: number) => AudioBuffer | null;
  /** Fired when the first entry in a play cycle transitions to 'playing'. */
  onFirstUtterance?: () => void;
  /** Fired after each entry finishes playing. */
  onEntryComplete?: (info: { id: number; text: string | null; duration_ms: number }) => void;
  /** Fired once per streaming utterance with chunk-level scheduling metrics.
   *  Used for first-chunk-jitter diagnosis. Fire-and-forget; emits even
   *  when the utterance is cancelled (so cancellation patterns are visible). */
  onTtsPlaybackTiming?: (event: TtsPlaybackTimingEvent) => void;
}

// Initial lookahead before the first chunk is scheduled. With external_stream
// (combined LLM+TTS), first chunks observed at 640-1236ms in real sessions
// (2026-05-26 telemetry); 150ms was too aggressive and caused every utterance
// to snap-forward at chunk 0 with ~10ms of buffering, producing audible
// glitches on the first word. 300ms covers the fast cases without snap.
const DEFAULT_INITIAL_LOOKAHEAD_S = 0.3;
// When schedule falls behind ctx.currentTime (late first chunk), we snap
// forward to currentTime + this value. The previous 150ms was too tight:
// 2026-05-28 sail experiment (snap_sweep with init=300 fixed) showed
// chunk-1+ snap rates of 100% at snap=10/50, 75% at snap=150, and 0%
// at snap=300/500 — i.e. snap≥300ms is what actually kills the audible
// "cutoff-and-resume" mid-utterance glitch. Chunk-0 snap is barely
// perceptible ("audio starts 300ms late"); chunk-1+ snaps cut the audio
// thread mid-stream and are the real bug. 333ms is "300 with margin"
// to cover variance in chunk durations across voices/models.
const DEFAULT_SNAP_LOOKAHEAD_S = 0.333;
const CHUNK_SAMPLE_CAP = 10;

// Mutable per-process lookahead config. /sail's ExperimentControls can
// override these via setLookaheadConfig() to A/B-test scheduling behavior
// in production without redeploying. Reads happen at the top of each
// playStream / playExternalStreamAudio call so a change applies to the
// next utterance, not retroactively to one in flight.
let _initialLookaheadS = DEFAULT_INITIAL_LOOKAHEAD_S;
let _snapLookaheadS = DEFAULT_SNAP_LOOKAHEAD_S;

export interface LookaheadConfig {
    initialMs?: number;
    snapMs?: number;
}

/** Override the audio scheduling lookahead values. Pass undefined values to
 *  reset to defaults. Affects every subsequent TTS playback in this process. */
export function setLookaheadConfig(opts: LookaheadConfig): void {
    if (opts.initialMs !== undefined) _initialLookaheadS = Math.max(0, opts.initialMs) / 1000;
    else _initialLookaheadS = DEFAULT_INITIAL_LOOKAHEAD_S;
    if (opts.snapMs !== undefined) _snapLookaheadS = Math.max(0, opts.snapMs) / 1000;
    else _snapLookaheadS = DEFAULT_SNAP_LOOKAHEAD_S;
}

export function getLookaheadConfig(): { initialMs: number; snapMs: number; initialMsDefault: number; snapMsDefault: number } {
    return {
        initialMs: _initialLookaheadS * 1000,
        snapMs: _snapLookaheadS * 1000,
        initialMsDefault: DEFAULT_INITIAL_LOOKAHEAD_S * 1000,
        snapMsDefault: DEFAULT_SNAP_LOOKAHEAD_S * 1000,
    };
}

interface QueueEntry {
  id: number;
  audioBuffer: AudioBuffer | null;
  promise: Promise<AudioBuffer> | null;
  text: string | null;
  status: QueueEntryStatusType;
  cached: boolean;
  /** External audio stream (from combined LLM+TTS). When present, audio comes from this iterable instead of calling ttsStreamCallFn. */
  externalStream?: AsyncIterable<Float32Array>;
}

// ─── Sentence chunking ────────────────────────────────────────────

const SENTENCE_SPLIT_RE = /(?<=[.!?\n])\s+/;
const MAX_CHUNK_CHARS = 4096;

// ─── Two-chunk streaming constants & helpers ─────────────────────

const MIN_FIRST_CHUNK_WORDS = 25;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/** Returns the character index where the Nth word ends, or -1 if fewer than N words */
function nthWordEndPosition(text: string, n: number): number {
  let count = 0;
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    count++;
    if (count === n) return match.index + match[0].length;
  }
  return -1;
}

export function chunkIntoSentences(text: string): string[] {
  const raw = text.split(SENTENCE_SPLIT_RE).filter(s => s.trim().length > 0);
  const result: string[] = [];

  for (const chunk of raw) {
    if (chunk.length <= MAX_CHUNK_CHARS) {
      result.push(chunk);
    } else {
      // Fallback: split on word boundaries
      const words = chunk.split(/\s+/);
      let current = '';
      for (const word of words) {
        if (current.length + word.length + 1 > MAX_CHUNK_CHARS) {
          if (current) result.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      if (current) result.push(current);
    }
  }

  return result;
}

// ─── Queue factory ────────────────────────────────────────────────

export function createTTSSpeechQueue(config: TTSSpeechQueueConfig) {
  const {
    ttsCallFn,
    ttsStreamCallFn,
    speakFn,
    cancelFn,
    onStart,
    onDrain,
    onError,
    onStateChange,
    getCachedBuffer,
    onFirstUtterance,
    onEntryComplete,
    onTtsPlaybackTiming,
  } = config;

  let voice = config.voice ?? 'nova';
  let model = config.model ?? 'tts-1';
  let speed = config.playbackRate ?? 1.0;
  let maxPrefetch = config.prefetchCount ?? 3;
  let inFlight = 0;

  // Single reused AudioContext
  let audioCtx: AudioContext | null = null;
  function getAudioContext(): AudioContext {
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioContext();
    }
    return audioCtx;
  }

  // Queue state
  const queue: QueueEntry[] = [];
  const completed: QueueEntry[] = [];
  const MAX_COMPLETED = 20;
  let nextId = 0;
  let playing = false;
  let paused = false;
  let cancelled = false;
  let currentSource: AudioBufferSourceNode | null = null;
  let activeStreamSources: AudioBufferSourceNode[] = [];
  let isFirstInCycle = true;
  let drainResolvers: (() => void)[] = [];
  let externalAudioMode = false;
  let logStreamChunks = false;

  // ─── Allocation tracking (crash diagnostics) ──────────────
  let totalAudioBuffersCreated = 0;
  let totalAudioBytesAllocated = 0;
  let totalSourceNodesCreated = 0;
  let peakConcurrentSources = 0;

  function emitState() {
    onStateChange?.([
      ...completed.map(e => ({ id: e.id, text: e.text, status: e.status, cached: e.cached })),
      ...queue.map(e => ({ id: e.id, text: e.text, status: e.status, cached: e.cached })),
    ]);
  }

  function markEntry(entry: QueueEntry, status: QueueEntryStatusType) {
    entry.status = status;
    emitState();
  }

  function completeEntry(entry: QueueEntry, status: 'done' | 'error') {
    entry.status = status;
    completed.push(entry);
    if (completed.length > MAX_COMPLETED) completed.shift();
  }

  async function processQueue() {
    if (playing || paused || queue.length === 0) return;

    playing = true;
    cancelled = false;
    isFirstInCycle = true;
    onStart?.();

    while (queue.length > 0 && !cancelled) {
      if (paused) {
        // Wait until resumed or cancelled
        await new Promise<void>(resolve => {
          const check = setInterval(() => {
            if (!paused || cancelled) {
              clearInterval(check);
              resolve();
            }
          }, 50);
        });
        if (cancelled) break;
      }

      const entry = queue[0];
      const entryStart = Date.now();

      // ─── Browser TTS path: speak via SpeechSynthesis ──────
      if (speakFn && entry.text && !entry.audioBuffer) {
        try {
          markEntry(entry, 'playing');
          if (isFirstInCycle) { isFirstInCycle = false; onFirstUtterance?.(); }
          await speakFn(entry.text, speed);
          if (cancelled) break;
          completeEntry(entry, 'done');
          onEntryComplete?.({ id: entry.id, text: entry.text, duration_ms: Date.now() - entryStart });
        } catch (err) {
          completeEntry(entry, 'error');
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
        queue.shift();
        emitState();
        continue;
      }

      // ─── External stream path: audio from combined LLM+TTS ───
      if (entry.externalStream) {
        try {
          markEntry(entry, 'playing');
          if (isFirstInCycle) { isFirstInCycle = false; onFirstUtterance?.(); }
          await playExternalStreamAudio(entry.externalStream, () => cancelled);
          if (cancelled) break;
          completeEntry(entry, 'done');
          onEntryComplete?.({ id: entry.id, text: entry.text, duration_ms: Date.now() - entryStart });
        } catch (err) {
          completeEntry(entry, 'error');
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
        queue.shift();
        emitState();
        continue;
      }

      // ─── Streaming path: play audio as chunks arrive ───────
      if (ttsStreamCallFn && entry.text && !entry.audioBuffer && !entry.cached) {
        try {
          markEntry(entry, 'playing');
          if (isFirstInCycle) { isFirstInCycle = false; onFirstUtterance?.(); }
          await playStream(entry.text, () => cancelled);
          if (cancelled) break;
          completeEntry(entry, 'done');
          onEntryComplete?.({ id: entry.id, text: entry.text, duration_ms: Date.now() - entryStart });
        } catch (err) {
          completeEntry(entry, 'error');
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
        queue.shift();
        emitState();
        continue;
      }

      // ─── Buffer path: prefetch-then-play (existing) ────────
      try {
        // Resolve the audio buffer if it's still a promise
        let buffer: AudioBuffer;
        if (entry.audioBuffer) {
          buffer = entry.audioBuffer;
        } else if (entry.promise) {
          markEntry(entry, 'loading');
          buffer = await entry.promise;
          entry.audioBuffer = buffer;
        } else if (entry.text) {
          // Entry not yet prefetched — fire now and await inline
          fireTTS(entry);
          markEntry(entry, 'loading');
          buffer = await entry.promise!;
          entry.audioBuffer = buffer;
        } else {
          queue.shift();
          continue;
        }

        if (cancelled) break;

        // Play the buffer
        markEntry(entry, 'playing');
        if (isFirstInCycle) { isFirstInCycle = false; onFirstUtterance?.(); }
        await playBuffer(buffer);
        completeEntry(entry, 'done');
        onEntryComplete?.({ id: entry.id, text: entry.text, duration_ms: Date.now() - entryStart });

      } catch (err) {
        completeEntry(entry, 'error');
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }

      queue.shift();
      emitState();
    }

    playing = false;
    currentSource = null;

    if (!cancelled) {
      // Clear completed entries and emit empty state
      completed.length = 0;
      emitState();
    }
    onDrain?.({ cancelled });
    for (const r of drainResolvers) r();
    drainResolvers = [];
  }

  async function playBuffer(buffer: AudioBuffer): Promise<void> {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return new Promise((resolve, reject) => {
      try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        totalSourceNodesCreated++;
        totalAudioBuffersCreated++;
        totalAudioBytesAllocated += buffer.length * 4;

        currentSource = source;

        source.onended = () => {
          currentSource = null;
          resolve();
        };

        source.start(0);
      } catch (err) {
        reject(err);
      }
    });
  }

  // ─── Streaming playback ─────────────────────────────────────

  async function playStream(
    text: string,
    isCancelled: () => boolean,
  ): Promise<void> {
    const ctx = getAudioContext();
    const ctxStateBefore = ctx.state;
    let ctxResumeMs: number | null = null;
    if (ctx.state === 'suspended') {
      const t0 = performance.now();
      await ctx.resume();
      ctxResumeMs = performance.now() - t0;
    }

    const streamStart = performance.now();
    log(`playStream: starting "${text.slice(0, 50)}"`);

    const utteranceId = `utt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const chunkSamples: TtsChunkSample[] = [];
    let snapForwardCount = 0;
    let totalAudioMs = 0;
    let connectMs: number | null = null;
    let cancelledDuringStream = false;

    const { stream, done } = await ttsStreamCallFn!(text, voice, model, speed);
    connectMs = performance.now() - streamStart;
    log(`playStream: connected in ${connectMs.toFixed(0)}ms`);

    // Schedule time starts `_initialLookaheadS` ahead of "now" to absorb jitter.
    // Tunable via setLookaheadConfig (used by /sail experiment runner).
    let scheduleTime = ctx.currentTime + _initialLookaheadS;
    let lastSource: AudioBufferSourceNode | null = null;
    let chunkIdx = 0;
    activeStreamSources = [];

    for await (const chunk of stream) {
      if (isCancelled()) { cancelledDuringStream = true; break; }

      const arrivalMs = performance.now() - streamStart;
      const buf = ctx.createBuffer(1, chunk.length, 24000);
      buf.getChannelData(0).set(chunk);

      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(ctx.destination);
      totalAudioBuffersCreated++;
      totalAudioBytesAllocated += chunk.length * 4;
      totalSourceNodesCreated++;

      // If schedule time has fallen behind, snap forward
      let snappedForward = false;
      if (scheduleTime < ctx.currentTime) {
        scheduleTime = ctx.currentTime + _snapLookaheadS;
        snappedForward = true;
        snapForwardCount++;
      }

      // Slack at the moment we hand the buffer to the audio thread.
      const scheduleSlackMs = (scheduleTime - ctx.currentTime) * 1000;

      source.start(scheduleTime);
      scheduleTime += buf.duration;

      activeStreamSources.push(source);
      lastSource = source;
      peakConcurrentSources = Math.max(peakConcurrentSources, activeStreamSources.length);

      totalAudioMs += buf.duration * 1000;
      if (chunkSamples.length < CHUNK_SAMPLE_CAP) {
        chunkSamples.push({
          index: chunkIdx,
          arrival_ms: arrivalMs,
          samples: chunk.length,
          duration_ms: buf.duration * 1000,
          schedule_slack_ms: scheduleSlackMs,
          snapped_forward: snappedForward,
        });
      }

      log(`playStream: chunk ${chunkIdx++} | ${chunk.length} samples (${(buf.duration * 1000).toFixed(0)}ms audio) | T+${arrivalMs.toFixed(0)}ms`);
    }

    const streamDurationMs = performance.now() - streamStart;
    log(`playStream: ${chunkIdx} chunks received in ${streamDurationMs.toFixed(0)}ms | scheduled audio ends in +${((scheduleTime - ctx.currentTime) * 1000).toFixed(0)}ms`);

    // Fire telemetry — fire-and-forget, even on cancellation.
    try {
      onTtsPlaybackTiming?.({
        utterance_id: utteranceId,
        text_preview: text.slice(0, 80),
        path: 'stream',
        ctx_state_before: ctxStateBefore,
        ctx_resume_ms: ctxResumeMs,
        ctx_base_latency_ms: (ctx.baseLatency ?? 0) * 1000,
        ctx_output_latency_ms: typeof (ctx as any).outputLatency === 'number'
          ? (ctx as any).outputLatency * 1000
          : null,
        connect_ms: connectMs,
        initial_lookahead_ms: _initialLookaheadS * 1000,
        snap_lookahead_ms: _snapLookaheadS * 1000,
        stream_duration_ms: streamDurationMs,
        total_audio_ms: totalAudioMs,
        total_chunks: chunkIdx,
        snap_forward_count: snapForwardCount,
        first_chunk: chunkSamples[0] ?? null,
        chunks: chunkSamples,
        cancelled: cancelledDuringStream || isCancelled(),
      });
    } catch { /* swallow telemetry errors */ }

    // Wait for billing to settle
    await done.catch(() => {});

    // Wait for the last scheduled source to finish playing
    if (lastSource && !isCancelled()) {
      await new Promise<void>(resolve => {
        lastSource!.onended = () => resolve();
        // Safety timeout: if onended doesn't fire (e.g. zero-length buffer)
        const safetyMs = Math.max(0, (scheduleTime - ctx.currentTime) * 1000) + 500;
        setTimeout(resolve, safetyMs);
      });
    }

    activeStreamSources = [];
  }

  // ─── External stream playback (combined LLM+TTS) ────────────

  async function playExternalStreamAudio(
    chunks: AsyncIterable<Float32Array>,
    isCancelled: () => boolean,
  ): Promise<void> {
    const ctx = getAudioContext();
    const ctxStateBefore = ctx.state;
    let ctxResumeMs: number | null = null;
    if (ctx.state === 'suspended') {
      const t0 = performance.now();
      await ctx.resume();
      ctxResumeMs = performance.now() - t0;
    }

    const streamStart = performance.now();
    log(`playExternalStreamAudio: starting`);

    const utteranceId = `utt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const chunkSamples: TtsChunkSample[] = [];
    let snapForwardCount = 0;
    let totalAudioMs = 0;
    let cancelledDuringStream = false;

    // Schedule time starts `_initialLookaheadS` ahead of "now" to absorb jitter.
    // Tunable via setLookaheadConfig (used by /sail experiment runner).
    let scheduleTime = ctx.currentTime + _initialLookaheadS;
    let lastSource: AudioBufferSourceNode | null = null;
    let chunkIdx = 0;
    activeStreamSources = [];

    for await (const chunk of chunks) {
      if (isCancelled()) { cancelledDuringStream = true; break; }

      const arrivalMs = performance.now() - streamStart;
      const buf = ctx.createBuffer(1, chunk.length, 24000);
      buf.getChannelData(0).set(chunk);

      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(ctx.destination);
      totalAudioBuffersCreated++;
      totalAudioBytesAllocated += chunk.length * 4;
      totalSourceNodesCreated++;

      // If schedule time has fallen behind, snap forward
      let snappedForward = false;
      if (scheduleTime < ctx.currentTime) {
        scheduleTime = ctx.currentTime + _snapLookaheadS;
        snappedForward = true;
        snapForwardCount++;
      }

      const scheduleSlackMs = (scheduleTime - ctx.currentTime) * 1000;

      source.start(scheduleTime);
      scheduleTime += buf.duration;

      activeStreamSources.push(source);
      lastSource = source;
      peakConcurrentSources = Math.max(peakConcurrentSources, activeStreamSources.length);

      totalAudioMs += buf.duration * 1000;
      if (chunkSamples.length < CHUNK_SAMPLE_CAP) {
        chunkSamples.push({
          index: chunkIdx,
          arrival_ms: arrivalMs,
          samples: chunk.length,
          duration_ms: buf.duration * 1000,
          schedule_slack_ms: scheduleSlackMs,
          snapped_forward: snappedForward,
        });
      }

      chunkIdx++;
      if (logStreamChunks) log(`playExternalStreamAudio: chunk ${chunkIdx} | ${chunk.length} samples (${(buf.duration * 1000).toFixed(0)}ms audio) | T+${arrivalMs.toFixed(0)}ms`);
    }

    const streamDurationMs = performance.now() - streamStart;
    log(`playExternalStreamAudio: ${chunkIdx} chunks in ${streamDurationMs.toFixed(0)}ms | scheduled audio ends in +${((scheduleTime - ctx.currentTime) * 1000).toFixed(0)}ms`);

    // Fire telemetry — fire-and-forget, even on cancellation.
    try {
      onTtsPlaybackTiming?.({
        utterance_id: utteranceId,
        text_preview: '<external_stream>',
        path: 'external_stream',
        ctx_state_before: ctxStateBefore,
        ctx_resume_ms: ctxResumeMs,
        ctx_base_latency_ms: (ctx.baseLatency ?? 0) * 1000,
        ctx_output_latency_ms: typeof (ctx as any).outputLatency === 'number'
          ? (ctx as any).outputLatency * 1000
          : null,
        connect_ms: null,
        initial_lookahead_ms: _initialLookaheadS * 1000,
        snap_lookahead_ms: _snapLookaheadS * 1000,
        stream_duration_ms: streamDurationMs,
        total_audio_ms: totalAudioMs,
        total_chunks: chunkIdx,
        snap_forward_count: snapForwardCount,
        first_chunk: chunkSamples[0] ?? null,
        chunks: chunkSamples,
        cancelled: cancelledDuringStream || isCancelled(),
      });
    } catch { /* swallow telemetry errors */ }

    // Wait for the last scheduled source to finish playing
    if (lastSource && !isCancelled()) {
      await new Promise<void>(resolve => {
        lastSource!.onended = () => resolve();
        const safetyMs = Math.max(0, (scheduleTime - ctx.currentTime) * 1000) + 500;
        setTimeout(resolve, safetyMs);
      });
    }

    activeStreamSources = [];
  }

  // ─── Prefetch helpers ────────────────────────────────────────

  function fireTTS(entry: QueueEntry) {
    if (!entry.text || entry.promise || !ttsCallFn) return;
    inFlight++;
    entry.status = 'loading';
    const promise = ttsCallFn(entry.text, voice, model, speed);
    entry.promise = promise;
    promise.then(buf => {
      entry.audioBuffer = buf;
      if (entry.status === 'loading') {
        entry.status = 'queued';
        emitState();
      }
    }).catch(() => {}).finally(() => {
      inFlight--;
      prefetchNext();
    });
  }

  function prefetchNext() {
    while (inFlight < maxPrefetch) {
      // When streaming is active, skip queue[0] — processQueue handles it via playStream.
      // Prefetch entries 1+ so they're buffered by the time the first finishes playing.
      const next = queue.find((e, idx) => !e.promise && !e.audioBuffer && e.text
        && !(ttsStreamCallFn && !e.cached && idx === 0));
      if (!next) break;
      fireTTS(next);
    }
  }

  // ─── Public API ───────────────────────────────────────────────

  function speakText(text: string) {
    const sentences = chunkIntoSentences(text);
    if (sentences.length === 0) return;

    for (const sentence of sentences) {
      const entry: QueueEntry = {
        id: nextId++,
        audioBuffer: null,
        promise: null,
        text: sentence,
        status: 'queued',
        cached: false,
      };
      queue.push(entry);
    }

    if (ttsCallFn) prefetchNext();
    emitState();
    processQueue();
  }

  function speakCached(audioBuffer: AudioBuffer) {
    queue.push({ id: nextId++, audioBuffer, promise: null, text: null, status: 'queued', cached: true });
    emitState();
    processQueue();
  }

  function pause() {
    paused = true;
  }

  function resume() {
    paused = false;
  }

  function cancel() {
    cancelled = true;
    paused = false;
    queue.length = 0;
    completed.length = 0;
    inFlight = 0;
    streamBuffer = '';
    firstChunkSent = false;
    // Note: externalAudioMode is NOT reset here — it's a session-level setting
    // managed by app3.tsx, not a per-turn flag. Resetting it on cancel would
    // cause feedChunk to re-activate and double-play audio on the next turn.

    // Cancel browser TTS
    cancelFn?.();

    // Stop currently playing audio
    if (currentSource) {
      try {
        currentSource.stop();
      } catch {}
      currentSource = null;
    }

    // Stop all scheduled streaming sources
    for (const s of activeStreamSources) {
      try { s.stop(); } catch {}
    }
    activeStreamSources = [];

    playing = false;
    emitState();
    onDrain?.({ cancelled: true });
    for (const r of drainResolvers) r();
    drainResolvers = [];
  }

  function clear() {
    queue.length = 0;
    inFlight = 0;
    emitState();
  }

  function isPlaying() {
    return playing;
  }

  function isPaused() {
    return paused;
  }

  function pending() {
    return queue.length;
  }

  function setPlaybackRate(rate: number) {
    speed = rate;
  }

  function setVoice(v: string) {
    voice = v;
  }

  function setModel(m: string) {
    model = m;
  }

  function setPrefetchCount(n: number) {
    maxPrefetch = n;
  }

  function getState(): QueueEntryStatus[] {
    return [
      ...completed.map(e => ({ id: e.id, text: e.text, status: e.status, cached: e.cached })),
      ...queue.map(e => ({ id: e.id, text: e.text, status: e.status, cached: e.cached })),
    ];
  }

  // ─── Streaming TTS (sentence-by-sentence from LLM chunks) ─────

  let streamBuffer = '';
  let firstChunkSent = false;

  function feedChunk(chunk: string) {
    if (externalAudioMode) return; // Server handles TTS in combined mode
    streamBuffer += chunk;

    // After first chunk sent, just accumulate — flushStream sends the rest as one piece
    if (firstChunkSent) return;

    // Not enough words yet
    if (wordCount(streamBuffer) < MIN_FIRST_CHUNK_WORDS) return;

    // Find position after Nth word, then first delimiter from there
    const nthWordPos = nthWordEndPosition(streamBuffer, MIN_FIRST_CHUNK_WORDS);
    if (nthWordPos === -1) return;

    // Search for first delimiter at or after the Nth word position
    const tail = streamBuffer.slice(nthWordPos);
    const delimMatch = tail.match(/(?:[.!?\n,:;(]|--)\s+/);
    if (!delimMatch || delimMatch.index === undefined) return;

    const splitEnd = nthWordPos + delimMatch.index + delimMatch[0].length;
    const firstChunk = streamBuffer.slice(0, splitEnd).trim();
    streamBuffer = streamBuffer.slice(splitEnd);

    if (firstChunk.length > 0) {
      const entry: QueueEntry = { id: nextId++, audioBuffer: null, promise: null, text: firstChunk, status: 'queued', cached: false };
      queue.push(entry);
      firstChunkSent = true;

      if (ttsCallFn) prefetchNext();
      emitState();
      processQueue();
    }
  }

  function flushStream() {
    if (externalAudioMode) return; // Server handles TTS in combined mode
    const remaining = streamBuffer.trim();
    if (remaining.length > 0) {
      const entry: QueueEntry = { id: nextId++, audioBuffer: null, promise: null, text: remaining, status: 'queued', cached: false };
      queue.push(entry);
      if (ttsCallFn) prefetchNext();
      emitState();
      processQueue();
    }
    streamBuffer = '';
    firstChunkSent = false;
  }

  function resetStream() {
    streamBuffer = '';
    firstChunkSent = false;
  }

  function playExternalStream(chunks: AsyncIterable<Float32Array>, meta?: { text?: string }) {
    const entry: QueueEntry = {
      id: nextId++,
      audioBuffer: null,
      promise: null,
      text: meta?.text ?? null,
      status: 'queued',
      cached: false,
      externalStream: chunks,
    };
    queue.push(entry);
    emitState();
    processQueue();
  }

  function setExternalAudioMode(enabled: boolean) {
    externalAudioMode = enabled;
    if (enabled) {
      streamBuffer = '';
      firstChunkSent = false;
    }
  }

  function waitUntilDrained(): Promise<void> {
    if (!playing && queue.length === 0) return Promise.resolve();
    return new Promise<void>(resolve => { drainResolvers.push(resolve); });
  }

  return {
    speakText,
    speakCached,
    pause,
    resume,
    cancel,
    clear,
    isPlaying,
    isPaused,
    pending,
    setPlaybackRate,
    setVoice,
    setModel,
    setPrefetchCount,
    getState,
    feedChunk,
    flushStream,
    resetStream,
    waitUntilDrained,
    playExternalStream,
    setExternalAudioMode,
    setLogStreamChunks: (v: boolean) => { logStreamChunks = v; },
    getDiagnostics: () => ({
      audioCtxState: audioCtx?.state ?? 'none',
      audioCtxSampleRate: audioCtx?.sampleRate ?? 0,
      totalAudioBuffersCreated,
      totalAudioBytesAllocated,
      totalAudioBytesAllocatedMB: Math.round(totalAudioBytesAllocated / 1024 / 1024 * 100) / 100,
      totalSourceNodesCreated,
      peakConcurrentSources,
      activeSourcesNow: activeStreamSources.length,
      queueLength: queue.length,
      completedLength: completed.length,
      isPlaying: playing,
      nextId,
    }),
  };
}
