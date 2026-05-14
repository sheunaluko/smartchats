'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import type { MobileVoiceState } from '../../../types/mobileVoice';

type OrbStageProps = {
  state: MobileVoiceState;
  level?: number;
  audioLevelRef?: React.MutableRefObject<number>;
  onActivate?: () => void;
};

function buildWaveLinePath(width: number, height: number, phase: number, amplitude: number) {
  const midY = height * 0.5;
  const points = 24;
  let path = `M 0 ${midY.toFixed(2)}`;

  for (let i = 1; i <= points; i += 1) {
    const x = (i / points) * width;
    const radians = ((i / points) * Math.PI * 2.2) + phase;
    const y = midY - (Math.sin(radians) * amplitude);
    path += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }

  return path;
}

function buildWaveFillPath(width: number, height: number, phase: number, amplitude: number) {
  const linePath = buildWaveLinePath(width, height, phase, amplitude);
  return `${linePath} L ${width} ${height} L 0 ${height} Z`;
}

export function OrbStage({ state, level = 0, audioLevelRef, onActivate }: OrbStageProps) {
  const instanceId = useId().replace(/:/g, '');
  const waveGradientId = `voice-stage-wave-gradient-${instanceId}`;
  const waveDotsId = `voice-stage-wave-dots-${instanceId}`;
  const waveMaskId = `voice-stage-wave-mask-${instanceId}`;
  const shellRef = useRef<HTMLDivElement>(null);
  const waveLineRef = useRef<SVGPathElement>(null);
  const waveFillRef = useRef<SVGPathElement>(null);
  const waveTextureRef = useRef<SVGPathElement>(null);
  const speckAngle1Ref = useRef(0);
  const speckAngle2Ref = useRef(180);
  const lastFrameTimeRef = useRef<number | null>(null);
  const wavePhaseRef = useRef(0);
  const [ctaDismissed, setCtaDismissed] = useState(false);
  const showActivateButton = (state === 'idle' || state === 'ready') && Boolean(onActivate);

  useEffect(() => {
    if (state === 'idle' || state === 'ready') {
      setCtaDismissed(false);
    }
  }, [state]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    let frameId = 0;
    let smoothed = 0;
    const isAudioReactiveState = state === 'listening';

    const getSpeckSpeeds = () => {
      if (state === 'loading') {
        return { speck1: -220, speck2: 220 };
      }
      if (state === 'listening') {
        return { speck1: 11, speck2: -11 };
      }
      if (state === 'processing') {
        return { speck1: -108, speck2: 108 };
      }
      if (state === 'speaking') {
        return { speck1: 11, speck2: -11 };
      }
      return { speck1: 0, speck2: 0 };
    };

    const getWaveSpeed = () => {
      if (state === 'speaking') return 3.8;
      return 0;
    };

    const animate = (timestamp: number) => {
      const lastFrameTime = lastFrameTimeRef.current ?? timestamp;
      const deltaSeconds = Math.min((timestamp - lastFrameTime) / 1000, 0.05);
      lastFrameTimeRef.current = timestamp;

      const rawLevel = isAudioReactiveState ? (audioLevelRef?.current ?? 0) : 0;
      const normalized = Math.max(0, Math.min(1, rawLevel * 4.5));
      smoothed += (normalized - smoothed) * 0.24;
      shell.style.setProperty('--voice-audio-power', smoothed.toFixed(3));

      const speeds = getSpeckSpeeds();
      speckAngle1Ref.current = (speckAngle1Ref.current + (speeds.speck1 * deltaSeconds) + 360) % 360;
      speckAngle2Ref.current = (speckAngle2Ref.current + (speeds.speck2 * deltaSeconds) + 360) % 360;
      shell.style.setProperty('--voice-speck-angle-1', `${speckAngle1Ref.current.toFixed(3)}deg`);
      shell.style.setProperty('--voice-speck-angle-2', `${speckAngle2Ref.current.toFixed(3)}deg`);

      const waveSpeed = getWaveSpeed();
      wavePhaseRef.current += waveSpeed * deltaSeconds;
      if (waveLineRef.current && waveFillRef.current && waveTextureRef.current) {
        const width = 100;
        const height = 100;
        const amplitude = state === 'speaking'
          ? 7 + (Math.sin(wavePhaseRef.current * 0.8) * 1.4)
          : 0;
        const linePath = buildWaveLinePath(width, height, wavePhaseRef.current, amplitude);
        const fillPath = buildWaveFillPath(width, height, wavePhaseRef.current, amplitude);
        waveLineRef.current.setAttribute('d', linePath);
        waveFillRef.current.setAttribute('d', fillPath);
        waveTextureRef.current.setAttribute('d', fillPath);
      }

      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [audioLevelRef, state]);

  return (
    <div
      ref={shellRef}
      className="voice-stage-shell relative mx-auto flex h-[290px] w-[290px] items-center justify-center"
      data-state={state}
      data-variant="orb"
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
        <div className="voice-stage-core-speck-orbit voice-stage-core-speck-orbit-1 absolute inset-0">
          <div className="voice-stage-core-speck voice-stage-core-speck-1 absolute rounded-full" />
        </div>
        <div className="voice-stage-core-speck-orbit voice-stage-core-speck-orbit-2 absolute inset-0">
          <div className="voice-stage-core-speck voice-stage-core-speck-2 absolute rounded-full" />
        </div>
        <div className="voice-stage-core-glow absolute inset-0 rounded-full" />
        <div className="voice-stage-core-center absolute inset-[24%] rounded-full">
          <div className="voice-stage-core-audio absolute inset-0 rounded-full" />
          <div className="voice-stage-core-wave absolute inset-[16%]" aria-hidden="true">
            <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
              <defs>
                <linearGradient id={waveGradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.26" />
                  <stop offset="20%" stopColor="currentColor" stopOpacity="0.12" />
                  <stop offset="38%" stopColor="currentColor" stopOpacity="0.035" />
                  <stop offset="50%" stopColor="currentColor" stopOpacity="0" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
                <pattern id={waveDotsId} width="7" height="7" patternUnits="userSpaceOnUse">
                  <circle cx="1.5" cy="2.4" r="0.9" className="voice-stage-core-wave-dot" />
                  <circle cx="5.2" cy="5.6" r="0.7" className="voice-stage-core-wave-dot voice-stage-core-wave-dot-soft" />
                </pattern>
                <mask id={waveMaskId}>
                  <rect width="100" height="100" fill={`url(#${waveGradientId})`} />
                </mask>
              </defs>
              <path ref={waveFillRef} className="voice-stage-core-wave-fill" fill={`url(#${waveGradientId})`} />
              <path
                ref={waveTextureRef}
                className="voice-stage-core-wave-texture"
                fill={`url(#${waveDotsId})`}
                mask={`url(#${waveMaskId})`}
              />
              <path ref={waveLineRef} className="voice-stage-core-wave-line" />
            </svg>
          </div>
        </div>
      </div>
      {showActivateButton && (
        <button
          type="button"
          aria-label="Start voice session"
          onClick={() => {
            setCtaDismissed(true);
            onActivate?.();
          }}
          className={`voice-stage-cta status-focused absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--sc-primary)_24%,transparent)] bg-[color-mix(in_srgb,var(--sc-surface)_72%,transparent)] text-sc-text shadow-sc-lg backdrop-blur-md transition-[opacity,transform,filter] duration-sc-fast ease-sc ${
            ctaDismissed ? 'pointer-events-none scale-90 opacity-0 blur-[2px]' : 'voice-stage-cta-attention'
          }`}
        >
          <span className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(180deg,color-mix(in_srgb,var(--sc-primary)_84%,white_16%),color-mix(in_srgb,var(--sc-primary)_96%,black_4%))] text-white shadow-sc-md">
            <span className="voice-stage-cta-sheen absolute inset-0 rounded-full" aria-hidden="true" />
            <Play size={18} className="ml-0.5" fill="currentColor" />
          </span>
        </button>
      )}
    </div>
  );
}
