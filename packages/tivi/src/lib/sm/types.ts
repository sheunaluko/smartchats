/**
 * Turn-commit state machine — types.
 *
 * A small pure reducer that decides WHEN to fire the transcription callback,
 * incorporating VAD speech-end, STT interim/final tokens, and (optionally)
 * a Smart Turn-style endpoint predictor.
 *
 * Scope: this SM owns the commit-decision path only. Interruption,
 * TTS-playing state, and mode-specific STT lifecycle remain in the
 * imperative useTivi code. This is a targeted integration to enable
 * Smart Turn v3 without rewriting the entire hook. A future refactor
 * (out of scope for Phase 1) can pull those concerns into the SM as well.
 *
 * When no predictor is passed (default), the SM is not instantiated and
 * useTivi behaves byte-identically to prior versions. When a predictor is
 * passed, the SM intercepts the commit decision.
 */

export type TiviSMState =
  | 'IDLE'             // No user speech in flight
  | 'RECORDING'        // VAD sees speech; STT streaming
  | 'AWAITING_COMMIT'  // VAD said speech-end; predictor deciding
  | 'COMMITTED';       // Just committed; awaiting next SPEECH_START

export type TiviSMCause =
  | 'external.START'
  | 'external.STOP'
  | 'vad.SPEECH_START'
  | 'vad.SPEECH_END'
  | 'stt.FINAL'
  | 'predictor.COMPLETE'
  | 'predictor.INCOMPLETE'
  | 'predictor.SHADOW'
  | 'predictor.TIMEOUT';

export type TiviSMInput =
  | { channel: 'external'; kind: 'START' }
  | { channel: 'external'; kind: 'STOP' }
  | { channel: 'vad'; kind: 'SPEECH_START' }
  | { channel: 'vad'; kind: 'SPEECH_END'; audio: Float32Array }
  | { channel: 'stt'; kind: 'INTERIM'; text: string }
  | { channel: 'stt'; kind: 'FINAL'; text: string }
  | { channel: 'predictor'; kind: 'DECISION'; result: PredictorDecision }
  | { channel: 'predictor'; kind: 'TIMEOUT' };

export type TiviSMEffect =
  | { kind: 'INVOKE_PREDICTOR'; audio: Float32Array; maxWaitMs: number }
  | { kind: 'CANCEL_PREDICTOR' }
  | { kind: 'EMIT_TRANSCRIPTION'; text: string }
  | { kind: 'EMIT_INCOMPLETE'; decision: PredictorDecision }
  | { kind: 'EMIT_STATE_CHANGE'; from: TiviSMState; to: TiviSMState; cause: TiviSMCause };

export interface TiviSMContext {
  state: TiviSMState;
  latestInterim: string;
  latestFinal: string;
  hasPendingPredictor: boolean;
}

export const INITIAL_SM_CONTEXT: TiviSMContext = {
  state: 'IDLE',
  latestInterim: '',
  latestFinal: '',
  hasPendingPredictor: false,
};

// === Predictor interface — Smart Turn v3 plugs in here ===

export interface EndpointPredictor {
  warmup(): Promise<PredictorWarmup>;
  predict(audio: Float32Array, signal?: AbortSignal): Promise<PredictorDecision>;
}

export interface PredictorWarmup {
  ok: boolean;
  duration_ms: number;
  cached: boolean;
  error?: string;
}

export interface PredictorDecision {
  complete: boolean;
  probability: number;
  latency_ms: number;
  /**
   * True when the decision was recorded but not acted on (shadow mode).
   * SM treats shadow decisions as if the predictor said INCOMPLETE.
   */
  shadow?: boolean;
}

export interface ReducerResult {
  next: TiviSMContext;
  effects: TiviSMEffect[];
}

export interface ReducerConfig {
  /** Safety timeout in AWAITING_COMMIT. Fires TIMEOUT if predictor hasn't returned. */
  maxAwaitCommitMs: number;
}
