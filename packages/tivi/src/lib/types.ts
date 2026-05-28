/**
 * TypeScript type definitions for tivi component
 */

import { MutableRefObject } from 'react';
import type { TTSCallFn, TTSStreamCallFn, QueueEntryStatus } from './tts_queue';
import type { FirebaseTtsCallable } from './tts_backends';

/**
 * Recognition modes for TIVI:
 * - 'guarded': VAD triggers recognition (may miss first word, but filters noise)
 * - 'responsive': Power threshold triggers recognition (fast, low latency)
 * - 'continuous': Recognition auto-restarts (always listening, uses more resources)
 *
 * Interruption (VAD cancelling TTS on speech) is controlled separately via enableInterruption.
 */
export type TiviMode = 'guarded' | 'responsive' | 'continuous';

export interface UseTiviOptions {
  /**
   * Callback when speech is transcribed (final result)
   */
  onTranscription?: (text: string) => void;

  /**
   * Callback when TTS is interrupted by user speech
   */
  onInterrupt?: () => void;

  /**
   * Callback for audio power level (0-1) for visualization
   */
  onAudioLevel?: (level: number) => void;

  /**
   * Callback for errors
   */
  onError?: (error: Error) => void;

  /**
   * Speech recognition language (e.g., 'en-US', 'es-ES')
   * Default: 'en-US'
   */
  language?: string;

  /**
   * VAD speech detection threshold (0-1)
   * Lower = more sensitive
   * Default: 0.3
   */
  positiveSpeechThreshold?: number;

  /**
   * VAD silence detection threshold (0-1)
   * Should be ~0.15 below positiveSpeechThreshold
   * Default: 0.25
   */
  negativeSpeechThreshold?: number;

  /**
   * Minimum consecutive ms above threshold before triggering speech-start
   * Prevents false positives from brief spikes
   * Default: 150
   */
  minSpeechStartMs?: number;

  /**
   * Enable verbose logging for debugging
   * Default: false
   */
  verbose?: boolean;

  /**
   * Recognition mode
   * Default: 'responsive'
   */
  mode?: TiviMode;

  /**
   * Audio power threshold for 'responsive' mode (0-1)
   * Recognition starts when audio power exceeds this level
   * Default: 0.01
   */
  powerThreshold?: number;

  /**
   * Whether VAD can interrupt TTS when speech is detected.
   * When false, TTS always plays to completion regardless of mode.
   * Default: true
   */
  enableInterruption?: boolean;

  /**
   * Injectable TTS backend function.
   * When provided and ttsProvider is 'openai', routes TTS through this function.
   */
  ttsCallFn?: TTSCallFn;

  /**
   * Optional streaming TTS function for progressive audio playback.
   * When provided, audio plays as chunks arrive instead of waiting for the full buffer.
   * Falls back to ttsCallFn when absent.
   */
  ttsStreamCallFn?: TTSStreamCallFn;

  /**
   * Firebase callable for TTS (used when ttsBackend is 'firebase').
   * Pass the httpsCallable result here to enable Firebase TTS without
   * importing Firebase in tivi itself.
   */
  firebaseTtsCallable?: FirebaseTtsCallable;

  /**
   * Callback fired whenever the TTS queue state changes.
   * Receives a snapshot of all entries (completed + pending) with their status.
   */
  onQueueStateChange?: (entries: QueueEntryStatus[]) => void;

  /** Fired when the first TTS entry in a play cycle starts playing. */
  onQueueFirstUtterance?: () => void;

  /** Fired after each TTS entry finishes playing. */
  onQueueEntryComplete?: (info: { id: number; text: string | null; duration_ms: number }) => void;

  /** Fired when the TTS queue finishes all entries (drain). cancelled=true if user interrupted. */
  onQueueDrain?: (info: { cancelled: boolean }) => void;

  /** Fired once per streaming utterance with chunk-level scheduling metrics
   *  (first-chunk slack, snap-forward count, per-chunk arrival/schedule timing).
   *  Used by the app to emit a `tts_playback_timing` insights event for
   *  diagnosing first-chunk jitter. Fire-and-forget. */
  onTtsPlaybackTiming?: (event: import('./tts_queue').TtsPlaybackTimingEvent) => void;

  /** Fired on non-expected SpeechRecognition errors (excludes the silent
   *  no-speech / audio-capture / aborted set which auto-recover). Provides
   *  the raw event.error code ('network', 'not-allowed', etc.) so the app
   *  can emit a typed insights event. The existing onError callback also
   *  fires alongside this — onSpeechRecognitionError is the structured form. */
  onSpeechRecognitionError?: (info: { code: string; message: string }) => void;
}

export interface UseTiviReturn {
  /**
   * Whether VAD is currently listening for speech
   */
  isListening: boolean;

  /**
   * Whether TTS is currently speaking
   */
  isSpeaking: boolean;

  /**
   * Whether VAD is connected and ready
   */
  isConnected: boolean;

  /**
   * Final transcription text (accumulated)
   */
  transcription: string;

  /**
   * Interim transcription (real-time, not final)
   */
  interimResult: string;

  /**
   * Current audio power level (0-1) for visualization (as ref to avoid re-renders)
   */
  audioLevelRef: MutableRefObject<number>;

  /**
   * Current VAD speech probability (0-1) for visualization (as ref to avoid re-renders)
   */
  speechProbRef: MutableRefObject<number>;

  /**
   * Error message, if any
   */
  error: string | null;

  /**
   * Current recognition mode
   */
  mode: TiviMode;

  /**
   * Whether TTS interruption is enabled
   */
  enableInterruption: boolean;

  /**
   * Start listening for speech
   */
  startListening: () => Promise<void>;

  /**
   * Stop listening for speech
   */
  stopListening: () => void;

  /**
   * Speak text using TTS
   * @param text - Text to speak
   * @param rate - Speech rate (0.1-10.0), default 1.0
   */
  speak: (text: string, rate?: number) => Promise<void>;

  /**
   * Clear accumulated transcription
   */
  clearTranscription: () => void;

  /**
   * Cancel current speech output
   */
  cancelSpeech: () => void;

  /**
   * Pause speech recognition
   */
  pauseSpeechRecognition: () => void;

  /**
   * Resume VAD frame processing (for calibration in responsive/continuous modes)
   */
  resumeVADProcessing: () => void;

  /**
   * Pause VAD frame processing
   */
  pauseVADProcessing: () => void;

  /**
   * Enqueue a pre-loaded AudioBuffer for immediate playback (zero latency)
   */
  speakCached: (audioBuffer: AudioBuffer) => void;

  /**
   * Direct access to the TTS speech queue, null when using browser TTS
   */
  ttsQueue: ReturnType<typeof import('./tts_queue').createTTSSpeechQueue> | null;
}

export interface TiviProps extends UseTiviOptions {
  // Component-specific props can be added here if needed
}
