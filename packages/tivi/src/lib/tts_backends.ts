/**
 * TTS Backend Factories
 *
 * Two factories that return TTSCallFn for different backends:
 * - Local (OAAK): Uses OpenAI API key from localStorage via tidyscripts_web
 * - Firebase: Uses Firebase Cloud Function callable
 */

import type { TTSCallFn } from './tts_queue';

// ─── Types ─────────────────────────────────────────────────────────

/**
 * Generic callable type matching Firebase httpsCallable signature.
 * Avoids importing Firebase directly so tivi stays dependency-free.
 */
export type FirebaseTtsCallable = (data: {
  text: string;
  voice: string;
  model: string;
  speed?: number;
}) => Promise<{ data: { audio: string; billing?: any } }>;

// ─── Shared AudioContext ───────────────────────────────────────────

let _audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new AudioContext();
  }
  return _audioCtx;
}

// ─── Local (OAAK) Backend ─────────────────────────────────────────

/**
 * Deprecated: direct-browser OpenAI TTS via localStorage['OAAK'] is no longer
 * supported. Consumers should inject a ttsCallFn from their backend adapter
 * (e.g. FirebaseBackend.tts.stream or LocalBackend.tts.stream).
 */
export function createLocalTtsCallFn(): TTSCallFn {
  return async (): Promise<AudioBuffer> => {
    throw new Error(
      'createLocalTtsCallFn is deprecated. Inject a ttsCallFn from your backend adapter.'
    );
  };
}

// ─── Firebase Backend ─────────────────────────────────────────────

/**
 * Creates a TTSCallFn that calls a Firebase Cloud Function for TTS.
 * Decodes base64 MP3 response into AudioBuffer.
 * Dispatches `tivi:billing_update` event if billing data is present.
 */
export function createFirebaseTtsCallFn(callable: FirebaseTtsCallable): TTSCallFn {
  return async (text: string, voice: string, model: string, speed?: number): Promise<AudioBuffer> => {
    const result = await callable({ text, voice, model, speed: speed ?? 1.0 });
    const { audio } = result.data;

    // Dispatch billing update event for UI
    if (result.data.billing) {
      window.dispatchEvent(
        new CustomEvent('tivi:billing_update', {
          detail: result.data.billing,
        })
      );
    }

    // Decode base64 MP3 to AudioBuffer
    const binaryString = atob(audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const ctx = getAudioContext();
    const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
    return audioBuffer;
  };
}
