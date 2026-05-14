'use client';

import React from 'react';
import { Chip } from '../Chip';
import type { MobileVoiceState } from '../../types/mobileVoice';

const LABELS: Record<MobileVoiceState, string> = {
  idle: 'Ready when you are',
  ready: 'Tap to begin',
  loading: 'Loading',
  listening: 'Listening',
  processing: 'Thinking',
  speaking: 'Speaking',
  interrupted: 'Interrupted',
  error: 'Something went wrong',
};

const SUBLABELS: Partial<Record<MobileVoiceState, string>> = {
  idle: 'Voice is the primary input. Keyboard is available when needed.',
  listening: 'Keep talking, or stop when you are done.',
  processing: 'Working through what you just asked.',
  speaking: 'Interrupt at any time.',
  error: 'Try again or switch to text input.',
};

export function VoiceStatus({ state, overlay = false }: { state: MobileVoiceState; overlay?: boolean }) {
  return (
    <div className={`mx-auto flex max-w-[26rem] flex-col items-center gap-3 text-center ${
      overlay ? 'rounded-full px-1 py-1' : ''
    }`}>
      <Chip
        label={LABELS[state]}
        size="sm"
        variant={state === 'error' ? 'danger' : state === 'speaking' ? 'success' : state === 'listening' ? 'primary' : 'default'}
        className="px-3 py-1"
      />
      {!overlay && SUBLABELS[state] && (
        <p className="max-w-[30ch] text-[0.82rem] leading-relaxed text-sc-text-muted">
          {SUBLABELS[state]}
        </p>
      )}
    </div>
  );
}
