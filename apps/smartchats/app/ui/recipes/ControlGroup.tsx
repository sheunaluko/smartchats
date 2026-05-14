'use client';

import React from 'react';

type ControlGroupProps = {
  children: React.ReactNode;
  className?: string;
};

export function ControlGroup({ children, className = '' }: ControlGroupProps) {
  return (
    <div
      className={`inline-flex min-h-[42px] items-center gap-1 rounded-[14px] border border-[var(--sc-separator)] bg-[var(--sc-surface-tertiary)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),var(--sc-shadow-sm)] backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}
