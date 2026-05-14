'use client';

import React from 'react';
import { useDesignPack } from '../../core/DesignPackContext';

type ButtonVariant = 'solid' | 'outline' | 'ghost' | 'soft';
type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'>;

const variantClasses: Record<ButtonVariant, string> = {
  solid: 'border border-transparent bg-[var(--sc-primary)] text-white shadow-sc-sm hover:brightness-105',
  outline: 'border border-[var(--sc-separator)] bg-transparent text-sc-text hover:bg-[var(--sc-default-hover)]',
  ghost: 'border border-transparent bg-transparent text-sc-text-muted hover:bg-[var(--sc-default-hover)] hover:text-sc-text',
  soft: 'border border-transparent bg-[var(--sc-accent-soft)] text-[var(--sc-accent-soft-foreground)] hover:brightness-[0.98]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'text-xs px-2.5 py-1 min-h-[32px] min-w-[44px]',
  md: 'text-sm px-4 py-2 min-h-[40px]',
  lg: 'text-base px-6 py-2.5 min-h-[44px]',
};

export function Button({
  variant,
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const { pack } = useDesignPack();
  const resolvedVariant = variant || pack.componentRules.buttonStyle;
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      data-pending={loading ? 'true' : undefined}
      className={`status-focused status-disabled status-pending inline-flex items-center justify-center gap-2 rounded-[12px] font-medium
        transition-[transform,background-color,border-color,box-shadow,color,filter] duration-sc-fast ease-sc
        active:scale-[0.97]
        ${sizeClasses[size]}
        ${variantClasses[resolvedVariant]}
        ${isDisabled ? '' : 'cursor-pointer'}
        ${className}`}
      {...rest}
    >
      {loading && (
        <svg
          className="animate-spin h-4 w-4 shrink-0"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
