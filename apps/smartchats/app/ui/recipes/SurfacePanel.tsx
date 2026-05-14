'use client';

import React from 'react';
import { useDesignPack } from '../../../core/DesignPackContext';

type SurfacePanelProps = {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'secondary' | 'tertiary';
  interactive?: boolean;
  style?: React.CSSProperties;
} & React.HTMLAttributes<HTMLDivElement>;

export function SurfacePanel({
  children,
  className = '',
  variant = 'default',
  interactive = false,
  style,
  ...rest
}: SurfacePanelProps) {
  const { pack } = useDesignPack();

  const variantClass = variant === 'secondary'
    ? 'surface-panel surface-panel-secondary'
    : variant === 'tertiary'
      ? 'surface-panel surface-panel-tertiary'
      : 'surface-panel';

  const panelStyle: React.CSSProperties = {
    ...style,
  };

  if (pack.componentRules.panelStyle === 'flat') {
    panelStyle.background = variant === 'tertiary'
      ? 'var(--sc-surface-tertiary)'
      : 'var(--sc-surface-secondary)';
    panelStyle.boxShadow = 'inset 0 1px 0 rgba(255, 255, 255, 0.08)';
  }

  if (pack.componentRules.panelStyle === 'outlined') {
    panelStyle.background = variant === 'tertiary' ? 'var(--sc-surface-tertiary)' : 'transparent';
    panelStyle.boxShadow = 'none';
  }

  if (pack.componentRules.panelStyle === 'glass') {
    panelStyle.background = 'color-mix(in srgb, var(--sc-surface) 72%, transparent)';
    panelStyle.backdropFilter = 'blur(18px) saturate(160%)';
    panelStyle.WebkitBackdropFilter = 'blur(18px) saturate(160%)';
    panelStyle.boxShadow = 'var(--sc-shadow-sm), var(--sc-surface-inset-highlight)';
  }

  return (
    <div
      className={`${variantClass} ${interactive ? 'transition-[box-shadow,border-color,transform] duration-sc-base ease-sc hover:-translate-y-px hover:shadow-[var(--sc-shadow-lg),var(--sc-surface-inset-highlight)]' : ''} ${className}`}
      style={panelStyle}
      {...rest}
    >
      {children}
    </div>
  );
}
