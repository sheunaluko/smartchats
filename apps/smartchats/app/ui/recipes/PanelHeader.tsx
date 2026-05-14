'use client';

import React from 'react';

type PanelHeaderProps = {
  title: string;
  leading?: React.ReactNode;
  controls?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

export function PanelHeader({
  title,
  leading,
  controls,
  action,
  className = '',
}: PanelHeaderProps) {
  return (
    <div className={`surface-header flex items-center justify-between gap-3 px-4 py-3.5 ${className}`}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {leading}
        <span className="truncate text-[0.84rem] font-semibold tracking-[-0.01em] text-sc-text/88">
          {title}
        </span>
      </div>

      {controls}
      {action}
    </div>
  );
}
