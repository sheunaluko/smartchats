/**
 * Turn-commit state machine — runtime.
 *
 * The impure wrapper around the pure reducer. Owns:
 *   - Current SM context (mutable ref)
 *   - Predictor invocation + abort-signal cancellation
 *   - Safety timer for AWAITING_COMMIT
 *   - Effect execution (dispatches to injected handlers)
 *
 * External event sources (VAD, STT) pump inputs in via `dispatch()`.
 * Effect handlers are supplied by the consumer (e.g. useTivi) to bridge
 * SM outputs to the app's callbacks and UI state.
 */

import type {
  EndpointPredictor,
  ReducerConfig,
  TiviSMContext,
  TiviSMInput,
  PredictorDecision,
  TiviSMState,
  TiviSMCause,
} from './types';
import { INITIAL_SM_CONTEXT } from './types';
import { reduce } from './reducer';

export interface RuntimeEffectHandlers {
  onEmitTranscription: (text: string) => void;
  onEmitIncomplete?: (decision: PredictorDecision) => void;
  onStateChange?: (from: TiviSMState, to: TiviSMState, cause: TiviSMCause) => void;
  /** Called for every predictor result (including shadow); for telemetry. */
  onPredictorDecision?: (decision: PredictorDecision) => void;
}

export interface RuntimeOptions {
  predictor: EndpointPredictor;
  config: ReducerConfig;
  handlers: RuntimeEffectHandlers;
  verbose?: boolean;
}

export interface TiviSMRuntime {
  dispatch(input: TiviSMInput): void;
  getContext(): TiviSMContext;
  stop(): void;
}

export function createRuntime(opts: RuntimeOptions): TiviSMRuntime {
  const { predictor, config, handlers, verbose } = opts;

  let ctx: TiviSMContext = { ...INITIAL_SM_CONTEXT };
  let predictorAbort: AbortController | null = null;
  let awaitTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function clearPredictor() {
    if (predictorAbort) {
      predictorAbort.abort();
      predictorAbort = null;
    }
    if (awaitTimer) {
      clearTimeout(awaitTimer);
      awaitTimer = null;
    }
  }

  function invokePredictor(audio: Float32Array, maxWaitMs: number) {
    clearPredictor();
    const ctrl = new AbortController();
    predictorAbort = ctrl;

    // Safety timer — fires TIMEOUT into SM if predictor doesn't return in time.
    awaitTimer = setTimeout(() => {
      if (stopped || ctrl.signal.aborted) return;
      dispatch({ channel: 'predictor', kind: 'TIMEOUT' });
    }, maxWaitMs);

    predictor
      .predict(audio, ctrl.signal)
      .then((result) => {
        if (stopped || ctrl.signal.aborted) return;
        handlers.onPredictorDecision?.(result);
        dispatch({ channel: 'predictor', kind: 'DECISION', result });
      })
      .catch((err) => {
        if (stopped || ctrl.signal.aborted) return;
        if (verbose) {
          console.warn('[tivi-sm] predictor.predict threw:', err);
        }
        // Treat any predictor error as timeout — safety commit.
        dispatch({ channel: 'predictor', kind: 'TIMEOUT' });
      });
  }

  function dispatch(input: TiviSMInput) {
    if (stopped) return;

    const { next, effects } = reduce(ctx, input, config);
    const prev = ctx;
    ctx = next;

    for (const eff of effects) {
      switch (eff.kind) {
        case 'INVOKE_PREDICTOR':
          invokePredictor(eff.audio, config.maxAwaitCommitMs);
          break;
        case 'CANCEL_PREDICTOR':
          clearPredictor();
          break;
        case 'EMIT_TRANSCRIPTION':
          try {
            handlers.onEmitTranscription(eff.text);
          } catch (err) {
            if (verbose) console.warn('[tivi-sm] onEmitTranscription threw:', err);
          }
          break;
        case 'EMIT_INCOMPLETE':
          try {
            handlers.onEmitIncomplete?.(eff.decision);
          } catch (err) {
            if (verbose) console.warn('[tivi-sm] onEmitIncomplete threw:', err);
          }
          break;
        case 'EMIT_STATE_CHANGE':
          try {
            handlers.onStateChange?.(eff.from, eff.to, eff.cause);
          } catch (err) {
            if (verbose) console.warn('[tivi-sm] onStateChange threw:', err);
          }
          break;
      }
    }

    if (verbose && prev.state !== ctx.state) {
      // Cheap trace when state changes.
      // eslint-disable-next-line no-console
      console.debug(`[tivi-sm] ${prev.state} -> ${ctx.state}`);
    }
  }

  function getContext(): TiviSMContext {
    return ctx;
  }

  function stop() {
    stopped = true;
    clearPredictor();
  }

  return { dispatch, getContext, stop };
}
