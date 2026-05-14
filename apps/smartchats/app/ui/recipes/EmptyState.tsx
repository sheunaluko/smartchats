'use client';

import React from 'react';
import { SurfacePanel } from './SurfacePanel';

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  className?: string;
};

export function EmptyState({
  title,
  description,
  icon,
  className = '',
}: EmptyStateProps) {
  return (
    <SurfacePanel
      variant="tertiary"
      className={`flex min-h-[120px] flex-col items-center justify-center px-6 py-8 text-center ${className}`}
    >
      {icon && <div className="mb-3 text-sc-text-muted/80">{icon}</div>}
      <p className="text-sm font-medium text-sc-text/92">{title}</p>
      {description && (
        <p className="mt-1 max-w-[28ch] text-xs leading-relaxed text-sc-text-muted">
          {description}
        </p>
      )}
    </SurfacePanel>
  );
}
