'use client';

import React, { useEffect, useRef, useState } from 'react';

type InterruptBarProps = {
  visible: boolean;
  onInterrupt: () => void;
  onStop: () => void;
};

const HOLD_TO_STOP_MS = 2600;

export function InterruptBar({ visible, onInterrupt, onStop }: InterruptBarProps) {
  const frameRef = useRef<number | null>(null);
  const holdStartRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [pressing, setPressing] = useState(false);

  const resetHold = () => {
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    holdStartRef.current = null;
    holdTriggeredRef.current = false;
    setProgress(0);
    setPressing(false);
  };

  useEffect(() => {
    if (!visible) {
      resetHold();
    }

    return () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [visible]);

  const startHold = () => {
    if (!visible || pressing) return;
    setPressing(true);
    holdTriggeredRef.current = false;
    holdStartRef.current = null;

    const tick = (timestamp: number) => {
      if (holdStartRef.current == null) {
        holdStartRef.current = timestamp;
      }

      const elapsed = timestamp - holdStartRef.current;
      const nextProgress = Math.min(elapsed / HOLD_TO_STOP_MS, 1);
      setProgress(nextProgress);

      if (nextProgress >= 1) {
        holdTriggeredRef.current = true;
        onStop();
        resetHold();
        return;
      }

      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
  };

  const releaseHold = () => {
    const shouldInterrupt = pressing && !holdTriggeredRef.current;
    resetHold();
    if (shouldInterrupt) {
      onInterrupt();
    }
  };

  return (
    <div className="h-12 px-4">
      <div
        className={`rounded-full bg-[var(--sc-accent-soft)] p-1.5 transition-[opacity,transform] duration-sc-fast ease-sc ${
          visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
        }`}
      >
        <button
          type="button"
          onPointerDown={startHold}
          onPointerUp={releaseHold}
          onPointerCancel={resetHold}
          onPointerLeave={() => {
            if (pressing) releaseHold();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onInterrupt();
            }
          }}
          className="status-focused relative flex w-full items-center justify-center overflow-hidden rounded-full border border-[color-mix(in_srgb,var(--sc-primary)_6%,transparent)] bg-transparent px-4 py-2 text-sm font-medium text-sc-text shadow-sc-sm transition-[background-color,border-color,color,transform] duration-sc-fast ease-sc active:scale-[0.99]"
          aria-label="Interrupt. Hold to stop."
        >
          <span
            className="absolute inset-0 rounded-full bg-[color-mix(in_srgb,var(--sc-surface)_92%,transparent)]"
            aria-hidden="true"
          />
          <span
            className="absolute inset-0 origin-left rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--sc-warning)_78%,var(--sc-primary)_22%),color-mix(in_srgb,var(--sc-danger)_84%,var(--sc-primary)_16%))] opacity-95 will-change-transform"
            style={{ transform: `scaleX(${progress})` }}
            aria-hidden="true"
          />
          <span
            className="absolute inset-0 rounded-full bg-[linear-gradient(180deg,color-mix(in_srgb,white_12%,transparent),transparent)]"
            aria-hidden="true"
          />
          <span className="absolute inset-0 rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]" aria-hidden="true" />
          <span className="relative z-10">
            {pressing ? 'Hold to Stop' : 'Interrupt'}
          </span>
        </button>
      </div>
    </div>
  );
}
