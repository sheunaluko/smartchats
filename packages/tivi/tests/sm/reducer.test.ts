/**
 * Turn-commit SM reducer — unit tests.
 *
 * Pure reducer means no mocks needed. Every test drives the state machine
 * through a sequence of inputs and asserts on the resulting context + effects.
 */

import { describe, it, expect } from 'vitest';
import {
  reduce,
  bestTranscript,
  INITIAL_SM_CONTEXT,
  type TiviSMContext,
  type TiviSMInput,
  type ReducerConfig,
} from '../../src/lib/sm';

const CFG: ReducerConfig = { maxAwaitCommitMs: 1400 };

// Small runner: apply a sequence of inputs, return final ctx + all effects.
function run(inputs: TiviSMInput[], start: TiviSMContext = INITIAL_SM_CONTEXT) {
  let ctx = start;
  const effects = [];
  for (const input of inputs) {
    const result = reduce(ctx, input, CFG);
    ctx = result.next;
    effects.push(...result.effects);
  }
  return { ctx, effects };
}

const dummyAudio = new Float32Array(16000);

describe('reducer — IDLE state', () => {
  it('starts in IDLE', () => {
    expect(INITIAL_SM_CONTEXT.state).toBe('IDLE');
  });

  it('IDLE + external.START → IDLE (no-op)', () => {
    const { ctx } = run([{ channel: 'external', kind: 'START' }]);
    expect(ctx.state).toBe('IDLE');
  });

  it('IDLE + vad.SPEECH_START → RECORDING', () => {
    const { ctx, effects } = run([{ channel: 'vad', kind: 'SPEECH_START' }]);
    expect(ctx.state).toBe('RECORDING');
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'EMIT_STATE_CHANGE', from: 'IDLE', to: 'RECORDING' }),
    );
  });

  it('IDLE + stt.FINAL → IDLE (ignored, no commit)', () => {
    const { ctx, effects } = run([{ channel: 'stt', kind: 'FINAL', text: 'stale' }]);
    expect(ctx.state).toBe('IDLE');
    expect(effects.find((e) => e.kind === 'EMIT_TRANSCRIPTION')).toBeUndefined();
  });
});

describe('reducer — RECORDING state', () => {
  it('captures INTERIM tokens without commit', () => {
    const { ctx, effects } = run([
      { channel: 'vad', kind: 'SPEECH_START' },
      { channel: 'stt', kind: 'INTERIM', text: 'hello' },
      { channel: 'stt', kind: 'INTERIM', text: 'hello world' },
    ]);
    expect(ctx.state).toBe('RECORDING');
    expect(ctx.latestInterim).toBe('hello world');
    expect(effects.find((e) => e.kind === 'EMIT_TRANSCRIPTION')).toBeUndefined();
  });

  it('captures FINAL but does not commit yet (waits for VAD/predictor)', () => {
    const { ctx, effects } = run([
      { channel: 'vad', kind: 'SPEECH_START' },
      { channel: 'stt', kind: 'FINAL', text: 'hello world' },
    ]);
    expect(ctx.state).toBe('RECORDING');
    expect(ctx.latestFinal).toBe('hello world');
    expect(effects.find((e) => e.kind === 'EMIT_TRANSCRIPTION')).toBeUndefined();
  });

  it('vad.SPEECH_END → AWAITING_COMMIT + INVOKE_PREDICTOR effect', () => {
    const { ctx, effects } = run([
      { channel: 'vad', kind: 'SPEECH_START' },
      { channel: 'vad', kind: 'SPEECH_END', audio: dummyAudio },
    ]);
    expect(ctx.state).toBe('AWAITING_COMMIT');
    expect(ctx.hasPendingPredictor).toBe(true);
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'INVOKE_PREDICTOR' }),
    );
  });
});

describe('reducer — AWAITING_COMMIT state', () => {
  const prelude: TiviSMInput[] = [
    { channel: 'vad', kind: 'SPEECH_START' },
    { channel: 'stt', kind: 'INTERIM', text: 'what time is it' },
    { channel: 'vad', kind: 'SPEECH_END', audio: dummyAudio },
  ];

  it('predictor COMPLETE → COMMITTED + EMIT_TRANSCRIPTION(best-available)', () => {
    const { ctx, effects } = run([
      ...prelude,
      {
        channel: 'predictor',
        kind: 'DECISION',
        result: { complete: true, probability: 0.9, latency_ms: 30 },
      },
    ]);
    expect(ctx.state).toBe('COMMITTED');
    expect(ctx.hasPendingPredictor).toBe(false);
    expect(effects).toContainEqual({
      kind: 'EMIT_TRANSCRIPTION',
      text: 'what time is it',
    });
  });

  it('predictor INCOMPLETE → RECORDING + EMIT_INCOMPLETE (ack signal)', () => {
    const { ctx, effects } = run([
      ...prelude,
      {
        channel: 'predictor',
        kind: 'DECISION',
        result: { complete: false, probability: 0.2, latency_ms: 30 },
      },
    ]);
    expect(ctx.state).toBe('RECORDING');
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'EMIT_INCOMPLETE' }),
    );
    expect(effects.find((e) => e.kind === 'EMIT_TRANSCRIPTION')).toBeUndefined();
  });

  it('predictor SHADOW → RECORDING + EMIT_INCOMPLETE (never commits)', () => {
    const { ctx, effects } = run([
      ...prelude,
      {
        channel: 'predictor',
        kind: 'DECISION',
        result: { complete: true, probability: 0.9, latency_ms: 30, shadow: true },
      },
    ]);
    expect(ctx.state).toBe('RECORDING');
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'EMIT_INCOMPLETE' }),
    );
    expect(effects.find((e) => e.kind === 'EMIT_TRANSCRIPTION')).toBeUndefined();
    // State-change cause distinguishes shadow from real INCOMPLETE
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'EMIT_STATE_CHANGE', cause: 'predictor.SHADOW' }),
    );
  });

  it('predictor TIMEOUT → COMMITTED + EMIT_TRANSCRIPTION(best-available)', () => {
    const { ctx, effects } = run([
      ...prelude,
      { channel: 'predictor', kind: 'TIMEOUT' },
    ]);
    expect(ctx.state).toBe('COMMITTED');
    expect(effects).toContainEqual({
      kind: 'EMIT_TRANSCRIPTION',
      text: 'what time is it',
    });
  });

  it('stt.FINAL beats predictor → COMMITTED with final text + CANCEL_PREDICTOR', () => {
    const { ctx, effects } = run([
      ...prelude,
      { channel: 'stt', kind: 'FINAL', text: 'what time is it now' },
    ]);
    expect(ctx.state).toBe('COMMITTED');
    expect(effects).toContainEqual({ kind: 'CANCEL_PREDICTOR' });
    expect(effects).toContainEqual({
      kind: 'EMIT_TRANSCRIPTION',
      text: 'what time is it now',
    });
  });

  it('vad.SPEECH_START (user resumed) → RECORDING + CANCEL_PREDICTOR', () => {
    const { ctx, effects } = run([
      ...prelude,
      { channel: 'vad', kind: 'SPEECH_START' },
    ]);
    expect(ctx.state).toBe('RECORDING');
    expect(ctx.hasPendingPredictor).toBe(false);
    expect(effects).toContainEqual({ kind: 'CANCEL_PREDICTOR' });
    expect(effects.find((e) => e.kind === 'EMIT_TRANSCRIPTION')).toBeUndefined();
  });

  it('interim tokens during AWAITING_COMMIT update latestInterim', () => {
    const { ctx } = run([
      ...prelude,
      { channel: 'stt', kind: 'INTERIM', text: 'what time is it now' },
    ]);
    expect(ctx.state).toBe('AWAITING_COMMIT');
    expect(ctx.latestInterim).toBe('what time is it now');
  });
});

describe('reducer — COMMITTED state', () => {
  const prelude: TiviSMInput[] = [
    { channel: 'vad', kind: 'SPEECH_START' },
    { channel: 'stt', kind: 'INTERIM', text: 'hi' },
    { channel: 'vad', kind: 'SPEECH_END', audio: dummyAudio },
    {
      channel: 'predictor',
      kind: 'DECISION',
      result: { complete: true, probability: 0.9, latency_ms: 20 },
    },
  ];

  it('vad.SPEECH_START loops back to RECORDING (next turn)', () => {
    const { ctx, effects } = run([
      ...prelude,
      { channel: 'vad', kind: 'SPEECH_START' },
    ]);
    expect(ctx.state).toBe('RECORDING');
    // Interim/final should have been reset
    expect(ctx.latestInterim).toBe('');
    expect(ctx.latestFinal).toBe('');
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'EMIT_STATE_CHANGE', from: 'COMMITTED', to: 'RECORDING' }),
    );
  });

  it('stale stt.FINAL after commit is a no-op', () => {
    const { ctx, effects: effectsBefore } = run(prelude);
    const commitEffects = effectsBefore.filter((e) => e.kind === 'EMIT_TRANSCRIPTION');
    expect(commitEffects.length).toBe(1);

    const { ctx: after, effects } = run(
      [{ channel: 'stt', kind: 'FINAL', text: 'late final' }],
      ctx,
    );
    expect(after.state).toBe('COMMITTED');
    // No new EMIT_TRANSCRIPTION
    expect(effects.find((e) => e.kind === 'EMIT_TRANSCRIPTION')).toBeUndefined();
  });
});

describe('reducer — external STOP', () => {
  it('STOP from any state → IDLE and clears buffers', () => {
    const states: TiviSMInput[][] = [
      [{ channel: 'vad', kind: 'SPEECH_START' }],
      [
        { channel: 'vad', kind: 'SPEECH_START' },
        { channel: 'vad', kind: 'SPEECH_END', audio: dummyAudio },
      ],
    ];
    for (const preludeSeq of states) {
      const { ctx } = run([...preludeSeq, { channel: 'external', kind: 'STOP' }]);
      expect(ctx.state).toBe('IDLE');
      expect(ctx.latestInterim).toBe('');
      expect(ctx.latestFinal).toBe('');
    }
  });

  it('STOP during AWAITING_COMMIT emits CANCEL_PREDICTOR', () => {
    const { effects } = run([
      { channel: 'vad', kind: 'SPEECH_START' },
      { channel: 'vad', kind: 'SPEECH_END', audio: dummyAudio },
      { channel: 'external', kind: 'STOP' },
    ]);
    expect(effects).toContainEqual({ kind: 'CANCEL_PREDICTOR' });
  });
});

describe('bestTranscript', () => {
  it('prefers FINAL over INTERIM', () => {
    const ctx = { ...INITIAL_SM_CONTEXT, latestInterim: 'partial', latestFinal: 'complete' };
    expect(bestTranscript(ctx)).toBe('complete');
  });

  it('falls back to INTERIM when no FINAL', () => {
    const ctx = { ...INITIAL_SM_CONTEXT, latestInterim: 'partial', latestFinal: '' };
    expect(bestTranscript(ctx)).toBe('partial');
  });

  it('returns empty string when neither is set', () => {
    expect(bestTranscript(INITIAL_SM_CONTEXT)).toBe('');
  });
});

describe('full turn flow — no predictor (safety-timeout only)', () => {
  it('interim + speech_end + timeout commits with interim', () => {
    const { ctx, effects } = run([
      { channel: 'vad', kind: 'SPEECH_START' },
      { channel: 'stt', kind: 'INTERIM', text: 'what time is it' },
      { channel: 'vad', kind: 'SPEECH_END', audio: dummyAudio },
      { channel: 'predictor', kind: 'TIMEOUT' },
    ]);
    expect(ctx.state).toBe('COMMITTED');
    expect(effects).toContainEqual({ kind: 'EMIT_TRANSCRIPTION', text: 'what time is it' });
  });
});

describe('full turn flow — predictor + WebSpeech race', () => {
  it('when predictor completes with only interim, commits on interim (latency win)', () => {
    const { ctx, effects } = run([
      { channel: 'vad', kind: 'SPEECH_START' },
      { channel: 'stt', kind: 'INTERIM', text: 'set a timer' },
      { channel: 'vad', kind: 'SPEECH_END', audio: dummyAudio },
      // Predictor beat WebSpeech's isFinal
      {
        channel: 'predictor',
        kind: 'DECISION',
        result: { complete: true, probability: 0.95, latency_ms: 40 },
      },
    ]);
    expect(ctx.state).toBe('COMMITTED');
    expect(effects).toContainEqual({ kind: 'EMIT_TRANSCRIPTION', text: 'set a timer' });
  });
});
