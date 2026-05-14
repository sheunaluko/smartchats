'use client';

import React from 'react';

type MetricRowTone = 'default' | 'primary' | 'success' | 'danger' | 'warning';

type MetricRowProps = {
  label: string;
  value: React.ReactNode;
  tone?: MetricRowTone;
  className?: string;
};

const valueToneClasses: Record<MetricRowTone, string> = {
  default: 'text-sc-text',
  primary: 'text-sc-primary',
  success: 'text-sc-success',
  danger: 'text-sc-danger',
  warning: 'text-sc-warning',
};

export function MetricRow({
  label,
  value,
  tone = 'default',
  className = '',
}: MetricRowProps) {
  return (
    <div className={`flex items-center justify-between gap-3 text-xs ${className}`}>
      <span className="text-sc-text-muted">{label}</span>
      <span className={`tabular-nums font-medium ${valueToneClasses[tone]}`}>
        {value}
      </span>
    </div>
  );
}
