'use client';

import React from 'react';

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  size?: 'sm' | 'md';
  'aria-label'?: string;
};

export function Switch({ checked, onChange, disabled = false, label, size = 'md', 'aria-label': ariaLabel }: SwitchProps) {
  const w = size === 'sm' ? 'w-8' : 'w-10';
  const h = size === 'sm' ? 'h-4' : 'h-5';
  const dot = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const translate = size === 'sm' ? 'translate-x-4' : 'translate-x-5';

  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
        className={`status-focused status-disabled ${w} ${h} relative inline-flex shrink-0 rounded-full
        border shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]
        transition-[background-color,box-shadow,transform] duration-sc-fast ease-sc
        ${checked
          ? 'border-transparent bg-sc-primary shadow-sm'
          : 'border-[var(--sc-separator)] bg-[var(--sc-surface-secondary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'}
        ${disabled ? '' : 'cursor-pointer'}`}
    >
      <span
        className={`${dot} inline-block rounded-full border border-[var(--sc-separator)] bg-[var(--sc-surface)] shadow-sm transform
          transition-transform duration-sc-fast ease-sc
          ${checked ? translate : 'translate-x-0'}`}
      />
    </button>
  );

  if (!label) return toggle;

  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="text-sm text-sc-text">{label}</span>
      {toggle}
    </label>
  );
}
