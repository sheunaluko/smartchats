/**
 * Turn-commit state machine — pure reducer.
 *
 * Given the current context and an input event, returns the next context
 * and a list of side effects for the runtime to execute. No side effects,
 * no timers, no promises — purely a state transition function.
 *
 * Design: see `types.ts` and `smart_turn_v3_integration_report_v2.html`
 * §3.3 for the transition table. This is a slightly narrower version of
 * that design — it owns only the commit-decision path, not TTS/barge-in.
 */

import type {
  TiviSMContext,
  TiviSMInput,
  TiviSMState,
  TiviSMEffect,
  TiviSMCause,
  ReducerResult,
  ReducerConfig,
} from './types';

export function reduce(
  ctx: TiviSMContext,
  input: TiviSMInput,
  _config: ReducerConfig,
): ReducerResult {
  const effects: TiviSMEffect[] = [];

  // External STOP always resets to IDLE.
  if (input.channel === 'external' && input.kind === 'STOP') {
    if (ctx.hasPendingPredictor) effects.push({ kind: 'CANCEL_PREDICTOR' });
    return transition(ctx, effects, 'IDLE', 'external.STOP', /*reset=*/ true);
  }

  switch (ctx.state) {
    case 'IDLE':
      return reduceIdle(ctx, input, effects);
    case 'RECORDING':
      return reduceRecording(ctx, input, effects);
    case 'AWAITING_COMMIT':
      return reduceAwaitingCommit(ctx, input, effects);
    case 'COMMITTED':
      return reduceCommitted(ctx, input, effects);
  }
}

// ─── IDLE ──────────────────────────────────────────────────────────

function reduceIdle(
  ctx: TiviSMContext,
  input: TiviSMInput,
  effects: TiviSMEffect[],
): ReducerResult {
  if (input.channel === 'external' && input.kind === 'START') {
    return { next: ctx, effects };
  }
  if (input.channel === 'vad' && input.kind === 'SPEECH_START') {
    return transition(ctx, effects, 'RECORDING', 'vad.SPEECH_START', /*reset=*/ true);
  }
  // STT tokens while IDLE — likely a spurious late final from a previous turn.
  // Ignore rather than emit to avoid double-committing.
  return { next: ctx, effects };
}

// ─── RECORDING ─────────────────────────────────────────────────────

function reduceRecording(
  ctx: TiviSMContext,
  input: TiviSMInput,
  effects: TiviSMEffect[],
): ReducerResult {
  if (input.channel === 'stt' && input.kind === 'INTERIM') {
    return { next: { ...ctx, latestInterim: input.text }, effects };
  }
  if (input.channel === 'stt' && input.kind === 'FINAL') {
    // Store but do NOT commit yet — wait for VAD/predictor gate.
    return { next: { ...ctx, latestFinal: input.text }, effects };
  }
  if (input.channel === 'vad' && input.kind === 'SPEECH_END') {
    effects.push({
      kind: 'INVOKE_PREDICTOR',
      audio: input.audio,
      maxWaitMs: 1400, // Value ignored; runtime uses config.maxAwaitCommitMs
    });
    return transition(
      { ...ctx, hasPendingPredictor: true },
      effects,
      'AWAITING_COMMIT',
      'vad.SPEECH_END',
    );
  }
  return { next: ctx, effects };
}

// ─── AWAITING_COMMIT ───────────────────────────────────────────────

function reduceAwaitingCommit(
  ctx: TiviSMContext,
  input: TiviSMInput,
  effects: TiviSMEffect[],
): ReducerResult {
  if (input.channel === 'vad' && input.kind === 'SPEECH_START') {
    // User resumed — cancel predictor, go back to RECORDING.
    effects.push({ kind: 'CANCEL_PREDICTOR' });
    return transition(
      { ...ctx, hasPendingPredictor: false },
      effects,
      'RECORDING',
      'vad.SPEECH_START',
    );
  }
  if (input.channel === 'stt' && input.kind === 'FINAL') {
    // STT beat the predictor — commit immediately with the final.
    effects.push({ kind: 'CANCEL_PREDICTOR' });
    effects.push({ kind: 'EMIT_TRANSCRIPTION', text: input.text });
    return transition(
      { ...ctx, hasPendingPredictor: false, latestFinal: input.text },
      effects,
      'COMMITTED',
      'stt.FINAL',
    );
  }
  if (input.channel === 'stt' && input.kind === 'INTERIM') {
    return { next: { ...ctx, latestInterim: input.text }, effects };
  }
  if (input.channel === 'predictor' && input.kind === 'DECISION') {
    if (input.result.shadow) {
      // Shadow mode: record but don't act. Emit for telemetry; treat as INCOMPLETE.
      effects.push({ kind: 'EMIT_INCOMPLETE', decision: input.result });
      return transition(
        { ...ctx, hasPendingPredictor: false },
        effects,
        'RECORDING',
        'predictor.SHADOW',
      );
    }
    if (input.result.complete) {
      const text = bestTranscript(ctx);
      effects.push({ kind: 'EMIT_TRANSCRIPTION', text });
      return transition(
        { ...ctx, hasPendingPredictor: false },
        effects,
        'COMMITTED',
        'predictor.COMPLETE',
      );
    }
    // Not complete, not shadow → the user is still mid-thought.
    effects.push({ kind: 'EMIT_INCOMPLETE', decision: input.result });
    return transition(
      { ...ctx, hasPendingPredictor: false },
      effects,
      'RECORDING',
      'predictor.INCOMPLETE',
    );
  }
  if (input.channel === 'predictor' && input.kind === 'TIMEOUT') {
    const text = bestTranscript(ctx);
    effects.push({ kind: 'EMIT_TRANSCRIPTION', text });
    return transition(
      { ...ctx, hasPendingPredictor: false },
      effects,
      'COMMITTED',
      'predictor.TIMEOUT',
    );
  }
  return { next: ctx, effects };
}

// ─── COMMITTED ─────────────────────────────────────────────────────

function reduceCommitted(
  ctx: TiviSMContext,
  input: TiviSMInput,
  effects: TiviSMEffect[],
): ReducerResult {
  if (input.channel === 'vad' && input.kind === 'SPEECH_START') {
    return transition(ctx, effects, 'RECORDING', 'vad.SPEECH_START', /*reset=*/ true);
  }
  // A stale STT event after commit is idempotent — ignore.
  return { next: ctx, effects };
}

// ─── Helpers ───────────────────────────────────────────────────────

function transition(
  ctx: TiviSMContext,
  effects: TiviSMEffect[],
  to: TiviSMState,
  cause: TiviSMCause,
  reset = false,
): ReducerResult {
  if (ctx.state !== to) {
    effects.push({ kind: 'EMIT_STATE_CHANGE', from: ctx.state, to, cause });
  }
  const next: TiviSMContext = {
    ...ctx,
    state: to,
    ...(reset ? { latestInterim: '', latestFinal: '' } : {}),
  };
  return { next, effects };
}

/**
 * Best-available transcript: prefer FINAL, fall back to INTERIM.
 * This is the perceived-latency win — if only an interim is available at
 * commit time (Smart Turn said COMPLETE before WebSpeech finalized), fire
 * on the interim rather than waiting for FINAL.
 */
export function bestTranscript(ctx: TiviSMContext): string {
  return ctx.latestFinal || ctx.latestInterim || '';
}
