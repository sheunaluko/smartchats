'use client';

import React from 'react';

type SelectOption = {
  value: string;
  label: string;
};

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: string;
  'aria-label'?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
};

export function Select({ value, onChange, options, label, 'aria-label': ariaLabel, size = 'md', disabled = false, className = '' }: SelectProps) {
  const padding = size === 'sm' ? 'h-9 px-3 text-xs' : 'h-11 px-3.5 text-sm';

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-sc-text-muted">{label}</span>}
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          aria-label={ariaLabel}
          className={`field-base status-focused-field status-disabled ${padding} w-full rounded-[14px] text-sc-text shadow-sm
            outline-none
            transition-[background-color,border-color,box-shadow,color] duration-sc-fast
            cursor-pointer appearance-none pr-11`}
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-11 items-center justify-center text-sc-text-muted">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 4l4 4 4-4"/>
          </svg>
        </div>
      </div>
    </div>
  );
}
