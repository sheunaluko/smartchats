/**
 * tivi/lib exports
 */

export { useTivi } from './useTivi';
export type { UseTiviOptions, UseTiviReturn, TiviProps, TiviMode } from './types';
export { useCalibration } from './useCalibration';
export type { CalibrationPhase, Phase1Results, Phase2Results, UseCalibrationReturn } from './useCalibration';
export { TSVAD } from './ts_vad/src';
export { get_silero_session, warmup_vad, get_smart_turn_session, warmup_smart_turn } from './onnx';

// Settings module
export { getTiviSettings, updateTiviSettings, resetTiviSettings, TIVI_DEFAULTS, subscribe as subscribeTiviSettings, getSnapshot as getTiviSettingsSnapshot, setTiviSettingsBackend } from './settings';
export type { TiviSettings, TiviSettingsKey, TiviSettingsStorage } from './settings';
export { useTiviSettings } from './useTiviSettings';

// TTS Queue
export { createTTSSpeechQueue, chunkIntoSentences, setLookaheadConfig, getLookaheadConfig } from './tts_queue';
export type { TTSCallFn, TTSStreamCallFn, TTSSpeechQueueConfig, QueueEntryStatus, LookaheadConfig } from './tts_queue';

// TTS Backends
export { createLocalTtsCallFn, createFirebaseTtsCallFn } from './tts_backends';
export type { FirebaseTtsCallable } from './tts_backends';

// TTS Acknowledgements (deprecated — see ./ack for v2 module)
export { preloadAcknowledgements, getAckBuffer, getAckBufferByText, clearAckCache, isAckCacheLoaded, getLoadedVoice, getLoadedSpeed, quantizeSpeed, ACK_TYPES, OPENAI_VOICES, ACK_SPOKEN_TEXT, CACHED_SPEEDS } from './tts_acknowledgements';
export type { AckType, OpenAIVoice } from './tts_acknowledgements';

// Ack sibling SM — used when semanticEndpointing produces INCOMPLETE decisions
// to play a random backchannel ("ok" / "mmhmm" / "yea") without perturbing
// the main turn-commit SM. See src/lib/ack/.
export {
  ACK_PHRASES,
  warmAcksForVoice,
  getRandomAck,
  clearAckCache as clearAckSmCache,
  clearAckCacheForVoice,
  isVoiceWarm,
  getAckCacheSnapshot,
  createAckRuntime,
} from './ack';
export type {
  AckPhrase,
  AckSMState,
  AckSMInput,
  AckSMHandlers,
  AckSMOptions,
  AckSMRuntime,
} from './ack';

// Semantic endpointing state machine (Smart Turn v3 integration)
export {
  createRuntime as createSMRuntime,
  reduce as reduceSM,
  bestTranscript,
  INITIAL_SM_CONTEXT,
  createSmartTurnPredictor,
  createShadowPredictor,
} from './sm';
export type {
  EndpointPredictor,
  PredictorWarmup,
  PredictorDecision,
  TiviSMState,
  TiviSMCause,
  TiviSMInput,
  TiviSMEffect,
  TiviSMContext,
  ReducerResult,
  ReducerConfig,
  TiviSMRuntime,
  RuntimeOptions,
  RuntimeEffectHandlers,
} from './sm';
