'use client';

import React, { forwardRef, useId } from 'react';
import { useDesignPack } from '../../core/DesignPackContext';

type InputSize = 'sm' | 'md';

type InputProps = {
  label?: string;
  error?: string;
  helperText?: string;
  size?: InputSize;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>;

const sizeClasses: Record<InputSize, string> = {
  sm: 'text-xs px-2.5 py-1.5 min-h-[32px]',
  md: 'text-sm px-3 py-2 min-h-[40px]',
};

const inputStyleClasses = {
  outlined: 'field-base rounded-[12px]',
  filled: 'rounded-[12px] border border-transparent bg-[var(--sc-surface-secondary)]',
  underlined: 'border-0 border-b border-[var(--sc-field-border)] rounded-none bg-transparent px-0 shadow-none',
} as const;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, helperText, size = 'md', className = '', disabled, id, ...rest },
  ref,
) {
  const { pack } = useDesignPack();
  const autoId = useId();
  const inputId = id || autoId;
  const errorId = error ? `${inputId}-error` : undefined;
  const helperId = helperText && !error ? `${inputId}-helper` : undefined;

  const input = (
    <input
      ref={ref}
      id={inputId}
      disabled={disabled}
      aria-invalid={!!error}
      aria-describedby={errorId || helperId}
      className={`status-focused-field status-invalid-field status-disabled block w-full text-sc-text
        ${inputStyleClasses[pack.componentRules.inputStyle]}
        placeholder:text-[var(--sc-field-placeholder)]
        transition-[background-color,border-color,box-shadow,color] duration-sc-fast ease-sc
        focus:outline-none
        ${error ? 'border-[var(--sc-status-invalid-border)]' : ''}
        ${sizeClasses[size]}
        ${className}`}
      {...rest}
    />
  );

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sc-text-muted text-sc-sm">
          {label}
        </label>
      )}
      {input}
      {error && (
        <p id={errorId} role="alert" className="text-sc-danger text-xs mt-1">
          {error}
        </p>
      )}
      {helperText && !error && (
        <p id={helperId} className="text-sc-text-muted text-xs mt-1">
          {helperText}
        </p>
      )}
    </div>
  );
});
