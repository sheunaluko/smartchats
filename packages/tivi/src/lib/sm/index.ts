/**
 * Tivi turn-commit state machine — public barrel.
 *
 * Consumers get the types + the runtime factory. Predictor implementations
 * (Smart Turn v3, shadow wrappers, cloud sidecars) live outside this
 * directory and plug in via the `EndpointPredictor` interface.
 */

export type {
  TiviSMState,
  TiviSMCause,
  TiviSMInput,
  TiviSMEffect,
  TiviSMContext,
  ReducerResult,
  ReducerConfig,
  EndpointPredictor,
  PredictorWarmup,
  PredictorDecision,
} from './types';
export { INITIAL_SM_CONTEXT } from './types';
export { reduce, bestTranscript } from './reducer';
export { createRuntime } from './runtime';
export type { RuntimeOptions, RuntimeEffectHandlers, TiviSMRuntime } from './runtime';
export { createSmartTurnPredictor, createShadowPredictor } from './predictors';
export type { SmartTurnPredictorOptions } from './predictors';
