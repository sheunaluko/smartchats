'use client';

import React from 'react';

type InspectorSectionTone = 'default' | 'primary' | 'success' | 'danger' | 'warning';

type InspectorSectionProps = {
  label: string;
  tone?: InspectorSectionTone;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
};

const toneClasses: Record<InspectorSectionTone, string> = {
  default: 'text-sc-text-muted',
  primary: 'text-sc-primary',
  success: 'text-sc-success',
  danger: 'text-sc-danger',
  warning: 'text-sc-warning',
};

export function InspectorSection({
  label,
  tone = 'default',
  children,
  className = '',
  contentClassName = '',
}: InspectorSectionProps) {
  return (
    <section className={`space-y-2 ${className}`}>
      <span className={`block text-[0.62rem] font-semibold uppercase tracking-[0.16em] ${toneClasses[tone]}`}>
        {label}
      </span>
      <div className={contentClassName}>
        {children}
      </div>
    </section>
  );
}
