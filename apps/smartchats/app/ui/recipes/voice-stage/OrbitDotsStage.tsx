'use client';

import React from 'react';
import type { MobileVoiceState } from '../../../types/mobileVoice';

type OrbitDotsStageProps = {
  state: MobileVoiceState;
  level?: number;
};

const orbitDots = Array.from({ length: 10 }, (_, index) => ({
  angle: `${index * 36}deg`,
  delay: `${index * 0.11}s`,
}));

export function OrbitDotsStage({ state, level = 0 }: OrbitDotsStageProps) {
  return (
    <div
      className="voice-stage-shell relative mx-auto flex h-[290px] w-[290px] items-center justify-center"
      data-state={state}
      data-variant="orbit-dots"
      style={{ ['--voice-level' as string]: String(level) }}
    >
      <div className="voice-stage-halo absolute inset-0 rounded-full" />
      <div className="voice-stage-ring-3 absolute inset-1 rounded-full" />
      <div className="voice-stage-ring-2 absolute inset-7 rounded-full" />
      <div className="voice-stage-ring absolute inset-14 rounded-full" />

      <div className="voice-stage-orbit-dot-field absolute inset-0">
        {orbitDots.map((dot, index) => (
          <div
            key={index}
            className="voice-stage-orbit-dot-lane absolute inset-0"
            style={{
              ['--voice-angle' as string]: dot.angle,
              ['--voice-delay' as string]: dot.delay,
            }}
          >
            <span className="voice-stage-orbit-dot block rounded-full" />
          </div>
        ))}
      </div>

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
    </div>
  );
}
