'use client';

import React from 'react';

type SettingsRowProps = {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

export function SettingsRow({ label, description, children, className = '' }: SettingsRowProps) {
  return (
    <div className={`surface-panel surface-panel-tertiary rounded-[18px] p-3 ${className}`}>
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-sc-text">{label}</div>
          {description && <div className="mt-1 text-xs text-sc-text-muted">{description}</div>}
        </div>
        <div className="w-full">{children}</div>
      </div>
    </div>
  );
}
