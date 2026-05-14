'use client';

import React from 'react';

type FieldGroupProps = {
  label?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

export function FieldGroup({ label, description, children, className = '' }: FieldGroupProps) {
  return (
    <div className={`surface-panel surface-panel-secondary rounded-[22px] p-4 space-y-3 ${className}`}>
      {(label || description) && (
        <div>
          {label && <div className="text-sm font-semibold text-sc-text">{label}</div>}
          {description && <div className="mt-1 text-xs text-sc-text-muted">{description}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
