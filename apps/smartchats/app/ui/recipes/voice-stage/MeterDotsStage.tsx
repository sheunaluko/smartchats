'use client';

import React from 'react';
import type { MobileVoiceState } from '../../../types/mobileVoice';

type MeterDotsStageProps = {
  state: MobileVoiceState;
  level?: number;
};

const meterDots = Array.from({ length: 7 }, (_, index) => ({
  delay: `${index * 0.08}s`,
  height: `${18 + ((index % 4) * 4)}px`,
}));

export function MeterDotsStage({ state, level = 0 }: MeterDotsStageProps) {
  return (
    <div
      className="voice-stage-shell relative mx-auto flex h-[290px] w-[290px] items-center justify-center"
      data-state={state}
      data-variant="meter-dots"
      style={{ ['--voice-level' as string]: String(level) }}
    >
      <div className="voice-stage-halo absolute inset-0 rounded-full" />
      <div className="voice-stage-ring-3 absolute inset-1 rounded-full" />
      <div className="voice-stage-ring-2 absolute inset-7 rounded-full" />
      <div className="voice-stage-ring absolute inset-14 rounded-full" />
      <div
        data-state={state}
        className="voice-stage-core relative h-36 w-36 rounded-full"
        style={{ ['--voice-level' as string]: String(level) }}
      >
        <div className="voice-stage-core-speck voice-stage-core-speck-1 absolute rounded-full" />
        <div className="voice-stage-core-speck voice-stage-core-speck-2 absolute rounded-full" />
        <div className="voice-stage-core-glow absolute inset-0 rounded-full" />
        <div className="voice-stage-core-center absolute inset-[24%] rounded-full" />
      </div>

      <div className="voice-stage-meter absolute left-1/2 top-[74%] flex h-12 -translate-x-1/2 items-end gap-2">
        {meterDots.map((dot, index) => (
          <span
            key={index}
            className="voice-stage-meter-dot block rounded-full"
            style={{
              height: dot.height,
              ['--voice-delay' as string]: dot.delay,
              ['--voice-level' as string]: String(level),
            }}
          />
        ))}
      </div>
    </div>
  );
}
