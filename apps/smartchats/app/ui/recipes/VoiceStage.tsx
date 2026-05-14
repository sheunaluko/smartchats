'use client';

import React from 'react';
import type { MobileVoiceState, VoiceFeedbackVariant } from '../../types/mobileVoice';
import { InnerDotsStage } from './voice-stage/InnerDotsStage';
import { MeterDotsStage } from './voice-stage/MeterDotsStage';
import { OrbStage } from './voice-stage/OrbStage';
import { OrbitDotsStage } from './voice-stage/OrbitDotsStage';

type VoiceStageProps = {
  state: MobileVoiceState;
  level?: number;
  variant?: VoiceFeedbackVariant;
  audioLevelRef?: React.MutableRefObject<number>;
  onActivate?: () => void;
};

export function VoiceStage({ state, level = 0, variant = 'orb', audioLevelRef, onActivate }: VoiceStageProps) {
  switch (variant) {
    case 'orbit-dots':
      return <OrbitDotsStage state={state} level={level} />;
    case 'inner-dots':
      return <InnerDotsStage state={state} level={level} />;
    case 'meter-dots':
      return <MeterDotsStage state={state} level={level} />;
    default:
      return <OrbStage state={state} level={level} audioLevelRef={audioLevelRef} onActivate={onActivate} />;
  }
}
