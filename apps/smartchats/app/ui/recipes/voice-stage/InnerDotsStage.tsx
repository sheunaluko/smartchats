'use client';

import React from 'react';
import type { MobileVoiceState } from '../../../types/mobileVoice';

type InnerDotsStageProps = {
  state: MobileVoiceState;
  level?: number;
};

const innerDots = [
  { top: '22%', left: '48%', size: '8px', delay: '0s' },
  { top: '36%', left: '66%', size: '10px', delay: '0.14s' },
  { top: '50%', left: '34%', size: '7px', delay: '0.28s' },
  { top: '62%', left: '58%', size: '9px', delay: '0.42s' },
  { top: '68%', left: '40%', size: '6px', delay: '0.56s' },
  { top: '42%', left: '50%', size: '5px', delay: '0.7s' },
];

export function InnerDotsStage({ state, level = 0 }: InnerDotsStageProps) {
  return (
    <div
      className="voice-stage-shell relative mx-auto flex h-[290px] w-[290px] items-center justify-center"
      data-state={state}
      data-variant="inner-dots"
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
        <div className="voice-stage-core-glow absolute inset-0 rounded-full" />
        <div className="voice-stage-core-center absolute inset-[24%] rounded-full" />
        <div className="voice-stage-inner-dot-field absolute inset-[18%] rounded-full">
          {innerDots.map((dot, index) => (
            <span
              key={index}
              className="voice-stage-inner-dot absolute rounded-full"
              style={{
                top: dot.top,
                left: dot.left,
                width: dot.size,
                height: dot.size,
                ['--voice-delay' as string]: dot.delay,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
