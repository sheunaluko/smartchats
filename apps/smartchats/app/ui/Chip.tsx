'use client';

import React from 'react';
import { useDesignPack } from '../../core/DesignPackContext';

type ChipProps = {
  label: string;
  size?: 'sm' | 'md';
  variant?: 'default' | 'primary' | 'success' | 'danger' | 'warning';
  className?: string;
};

const variantClasses = {
  default: 'bg-[var(--sc-surface-secondary)] text-sc-text-muted',
  primary: 'bg-[color-mix(in_srgb,var(--sc-primary)_16%,transparent)] text-sc-primary',
  success: 'bg-[color-mix(in_srgb,var(--sc-success)_16%,transparent)] text-sc-success',
  danger: 'bg-[color-mix(in_srgb,var(--sc-danger)_16%,transparent)] text-sc-danger',
  warning: 'bg-[color-mix(in_srgb,var(--sc-warning)_16%,transparent)] text-sc-warning',
};

const badgeStyleDefaults = {
  solid: 'bg-sc-text text-[var(--sc-background)]',
  soft: 'bg-[var(--sc-surface-secondary)] text-sc-text-muted',
  outline: 'bg-transparent border border-[var(--sc-separator)] text-sc-text-muted',
} as const;

export const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(function Chip({ label, size = 'sm', variant = 'default', className = '', ...rest }, ref) {
  const { pack } = useDesignPack();
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';

  const resolvedClasses = variant === 'default'
    ? badgeStyleDefaults[pack.componentRules.badgeStyle]
    : variantClasses[variant];

  return (
    <span ref={ref} {...rest} className={`inline-flex items-center rounded-full border border-transparent font-medium
      ${sizeClass} ${resolvedClasses} ${className}`}>
      {label}
    </span>
  );
});
