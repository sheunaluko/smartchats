/**
 * AckSM — sibling state machine for backchannel acknowledgements.
 *
 * Design note (v1): this SM has 2 states and 3 transitions, so a full
 * pure-reducer is overkill. We model it as a small imperative runtime
 * with the same shape as the main SM's runtime (dispatch()/stop()) so
 * consumers can treat both uniformly, but with the state graph inlined
 * rather than reduced. If policy grows (probability-based, adjacent-
 * avoidance, per-context selection), promote to a pure reducer then.
 *
 * States:
 *   IDLE           — no ack playing
 *   ACKNOWLEDGING  — an ack is playing (transient, exits when audio ends
 *                    or user resumes speaking)
 *
 * Inputs (via dispatch):
 *   'INCOMPLETE'   — main SM signaled a predictor INCOMPLETE decision
 *   'CANCEL'       — user resumed speaking / turn state changed; abort playback
 *
 * Effects (via handlers):
 *   playCached(buffer) — play the ack via tts queue's speakCached
 *   cancel()           — stop currently playing ack
 */

import { logger } from 'smartchats-common';
import { getRandomAck, type AckPhrase } from './cache';

const log = logger.get_logger({ id: 'tivi/ack-sm' });

export type AckSMState = 'IDLE' | 'ACKNOWLEDGING';
export type AckSMInput = 'INCOMPLETE' | 'CANCEL';

export interface AckSMHandlers {
  /** Play the AudioBuffer through the app's TTS lane (typically ttsQueue.speakCached). */
  playCached: (buffer: AudioBuffer) => void;
  /** Cancel currently playing TTS (typically ttsQueue.cancel or tts.cancelSpeech). */
  cancel: () => void;
  /** Fires each time an ack is played. Used for telemetry. */
  onAckPlayed?: (info: { phrase: AckPhrase; voice_id: string }) => void;
  /** Fires each time an INCOMPLETE arrived but no ack was available (cache cold). */
  onAckSkipped?: (info: { reason: 'cache_cold' | 'currently_playing' }) => void;
}

export interface AckSMOptions {
  getVoiceId: () => string | null;
  handlers: AckSMHandlers;
}

export interface AckSMRuntime {
  dispatch(input: AckSMInput): void;
  getState(): AckSMState;
  stop(): void;
}

export function createAckRuntime(opts: AckSMOptions): AckSMRuntime {
  let state: AckSMState = 'IDLE';
  let stopped = false;

  function dispatch(input: AckSMInput) {
    if (stopped) return;
    switch (input) {
      case 'INCOMPLETE': {
        if (state === 'ACKNOWLEDGING') {
          opts.handlers.onAckSkipped?.({ reason: 'currently_playing' });
          return;
        }
        const voice_id = opts.getVoiceId();
        if (!voice_id) {
          opts.handlers.onAckSkipped?.({ reason: 'cache_cold' });
          return;
        }
        const pick = getRandomAck(voice_id);
        if (!pick) {
          opts.handlers.onAckSkipped?.({ reason: 'cache_cold' });
          return;
        }
        state = 'ACKNOWLEDGING';
        log(`Playing ack "${pick.phrase}" (voice=${voice_id})`);
        opts.handlers.playCached(pick.buffer);
        opts.handlers.onAckPlayed?.({ phrase: pick.phrase, voice_id });
        // We reset state on the next dispatch (INCOMPLETE re-entry) or CANCEL.
        // Since speakCached doesn't give us a completion callback here, we
        // treat playback as fire-and-forget; the queue's onDrain will settle
        // isSpeaking state upstream. If needed, hookable via a completion
        // promise in a future iteration.
        setTimeout(() => {
          // Best-effort: clear ACKNOWLEDGING after a generous window so the
          // next incomplete can trigger. TTS drain will beat this for typical
          // 200–400ms acks; the fallback prevents the SM from getting stuck.
          if (state === 'ACKNOWLEDGING') state = 'IDLE';
        }, 1500);
        return;
      }
      case 'CANCEL': {
        if (state === 'ACKNOWLEDGING') {
          opts.handlers.cancel();
        }
        state = 'IDLE';
        return;
      }
    }
  }

  return {
    dispatch,
    getState: () => state,
    stop() {
      stopped = true;
      if (state === 'ACKNOWLEDGING') {
        opts.handlers.cancel();
      }
      state = 'IDLE';
    },
  };
}
