'use client';

import React from 'react';

type SliderProps = {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  label?: string;
  valueSuffix?: string;
};

export function Slider({ value, onChange, min, max, step = 1, disabled = false, label, valueSuffix = '' }: SliderProps) {
  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-sc-text-muted">{label}</span>
          <span className="text-xs text-sc-text-muted tabular-nums">{value}{valueSuffix}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        className="slider-base status-disabled h-5 w-full appearance-none cursor-pointer bg-transparent accent-sc-primary"
      />
    </div>
  );
}
