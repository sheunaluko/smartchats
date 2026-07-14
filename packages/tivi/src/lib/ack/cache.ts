/**
 * Ack cache — per-voice AudioBuffers for the 3 backchannel phrases.
 *
 * Warmed on voice-select via warmAcksForVoice(voice_id, ttsCallFn). Read
 * on every predictor.INCOMPLETE via getRandomAck(voice_id). Cache is
 * in-memory (per-session); a fresh page load re-warms. Simple by design
 * — future work can persist to IndexedDB if pre-warm latency becomes a
 * user-perceived issue.
 *
 * The phrase list is intentionally small (3) for v1 to keep cache warm
 * cost trivial (3 TTS calls per voice change) and randomness meaningful
 * (a 3-item pool gives clear variety without being overwhelming).
 */

import type { TTSCallFn } from '../tts_queue';
import { logger } from 'smartchats-common';

const log = logger.get_logger({ id: 'tivi/ack' });

/** The three ack phrases we support in v1. Order determines random draw
 *  distribution; each is drawn with probability 1/3. */
export const ACK_PHRASES = ['ok', 'mmhmm', 'yea'] as const;
export type AckPhrase = typeof ACK_PHRASES[number];

// Map key = `${voice_id}:${phrase}` → AudioBuffer once warmed.
const cache = new Map<string, AudioBuffer>();

// Track voices currently mid-warm so concurrent calls collapse to one.
const warmingByVoice = new Map<string, Promise<void>>();

function cacheKey(voice_id: string, phrase: AckPhrase): string {
  return `${voice_id}:${phrase}`;
}

/** Whether all 3 ack phrases are cached for the given voice. */
export function isVoiceWarm(voice_id: string): boolean {
  return ACK_PHRASES.every((p) => cache.has(cacheKey(voice_id, p)));
}

/**
 * Warm the ack cache for a voice. Idempotent — a second concurrent call
 * for the same voice returns the same in-flight promise. Individual
 * phrase failures are silent (logged but not thrown) so a single flaky
 * TTS call doesn't block the other two.
 *
 * The `ttsModel` is passed through so the cache honors the current TTS
 * model choice; if the user changes model, callers should invalidate
 * (via `clearAckCache`) and re-warm.
 */
export async function warmAcksForVoice(
  voice_id: string,
  ttsCallFn: TTSCallFn,
  ttsModel: string,
): Promise<void> {
  if (isVoiceWarm(voice_id)) return;
  const inflight = warmingByVoice.get(voice_id);
  if (inflight) return inflight;

  log(`Warming ack cache for voice=${voice_id} model=${ttsModel}`);
  const p = Promise.all(
    ACK_PHRASES.map(async (phrase) => {
      const key = cacheKey(voice_id, phrase);
      if (cache.has(key)) return;
      try {
        const buf = await ttsCallFn(phrase, voice_id, ttsModel);
        cache.set(key, buf);
      } catch (err) {
        log(`Ack warm failed for ${phrase}: ${err instanceof Error ? err.message : err}`);
      }
    }),
  ).then(() => {
    log(`Ack cache warmed for voice=${voice_id} (${ACK_PHRASES.filter(p => cache.has(cacheKey(voice_id, p))).length}/${ACK_PHRASES.length})`);
  }).finally(() => {
    warmingByVoice.delete(voice_id);
  });
  warmingByVoice.set(voice_id, p);
  return p;
}

/**
 * Pick a random ack for the given voice. Returns the AudioBuffer if
 * warmed, null otherwise (in which case the AckSM runtime skips playback
 * for this INCOMPLETE — no ack is better than a jarring TTS spin-up).
 */
export function getRandomAck(voice_id: string): { phrase: AckPhrase; buffer: AudioBuffer } | null {
  const warmed = ACK_PHRASES.filter((p) => cache.has(cacheKey(voice_id, p)));
  if (warmed.length === 0) return null;
  const pick = warmed[Math.floor(Math.random() * warmed.length)];
  const buffer = cache.get(cacheKey(voice_id, pick));
  if (!buffer) return null;
  return { phrase: pick, buffer };
}

/** Purge all cached acks. Call on TTS model change. */
export function clearAckCache(): void {
  cache.clear();
  warmingByVoice.clear();
}

/** Purge acks for one voice (e.g. after voice-selector change). */
export function clearAckCacheForVoice(voice_id: string): void {
  for (const p of ACK_PHRASES) {
    cache.delete(cacheKey(voice_id, p));
  }
  warmingByVoice.delete(voice_id);
}

/** Diagnostic: current cache state for insights events. */
export function getAckCacheSnapshot(): { voices: number; total_entries: number } {
  const voices = new Set<string>();
  for (const key of cache.keys()) {
    voices.add(key.split(':')[0]);
  }
  return { voices: voices.size, total_entries: cache.size };
}
