'use client';

import React from 'react';
import { SurfacePanel } from './SurfacePanel';

type DataCardTone = 'default' | 'primary' | 'success' | 'danger' | 'warning';

type DataCardProps = {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  tone?: DataCardTone;
  interactive?: boolean;
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>;

const toneClasses: Record<DataCardTone, string> = {
  default: '',
  primary: 'border-[color-mix(in_srgb,var(--sc-primary)_22%,var(--sc-separator))] bg-[color-mix(in_srgb,var(--sc-accent-soft)_58%,var(--sc-surface-tertiary))]',
  success: 'border-[color-mix(in_srgb,var(--sc-success)_24%,var(--sc-separator))] bg-[color-mix(in_srgb,var(--sc-success)_10%,var(--sc-surface-tertiary))]',
  danger: 'border-[color-mix(in_srgb,var(--sc-danger)_28%,var(--sc-separator))] bg-[color-mix(in_srgb,var(--sc-danger)_10%,var(--sc-surface-tertiary))]',
  warning: 'border-[color-mix(in_srgb,var(--sc-warning)_24%,var(--sc-separator))] bg-[color-mix(in_srgb,var(--sc-warning)_10%,var(--sc-surface-tertiary))]',
};

export function DataCard({
  header,
  footer,
  tone = 'default',
  interactive = false,
  children,
  className = '',
  ...rest
}: DataCardProps) {
  return (
    <SurfacePanel
      variant="tertiary"
      interactive={interactive}
      className={`overflow-hidden p-4 ${toneClasses[tone]} ${className}`}
      {...rest}
    >
      {header && <div className="mb-3 flex items-start justify-between gap-3">{header}</div>}
      <div className="space-y-3">{children}</div>
      {footer && <div className="mt-3 border-t surface-divider pt-3">{footer}</div>}
    </SurfacePanel>
  );
}
