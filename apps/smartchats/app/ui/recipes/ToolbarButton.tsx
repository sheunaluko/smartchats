'use client';

import React from 'react';
import { useInsights } from '@/context/InsightsContext';

type ToolbarButtonProps = {
  children: React.ReactNode;
  active?: boolean;
  variant?: 'neutral' | 'primary' | 'success' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
  /** When set, fires a `ui_click` insights event with this name on click. */
  trackAs?: string;
  /** Optional surface label for the insights event payload. Defaults to 'toolbar'. */
  trackSurface?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const variantClasses = {
  neutral: 'text-sc-text-muted hover:bg-[var(--sc-default-hover)] hover:text-sc-text',
  primary: 'border-sc-primary/30 bg-[var(--sc-accent-soft)] text-[var(--sc-accent-soft-foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] hover:brightness-[0.98]',
  success: 'border-sc-success/28 bg-[color-mix(in_srgb,var(--sc-success)_15%,var(--sc-surface)_85%)] text-sc-text shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] hover:brightness-[0.98]',
  danger: 'border-sc-danger/28 bg-[color-mix(in_srgb,var(--sc-danger)_14%,var(--sc-surface)_86%)] text-sc-text shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] hover:brightness-[0.98]',
};

export const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton({
  children,
  active = false,
  variant = 'neutral',
  size = 'md',
  className = '',
  type = 'button',
  trackAs,
  trackSurface = 'toolbar',
  onClick,
  ...rest
}, ref) {
  const { client } = useInsights();
  const wrappedOnClick = React.useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (trackAs) {
      client?.addEvent?.('ui_click', { name: trackAs, surface: trackSurface }).catch?.(() => {});
    }
    onClick?.(e);
  }, [trackAs, trackSurface, client, onClick]);
  return (
    <button
      ref={ref}
      type={type}
      onClick={wrappedOnClick}
      className={`status-focused status-disabled inline-flex items-center justify-center gap-2 rounded-[10px] border border-transparent font-medium
        transition-[background-color,color,border-color,transform,box-shadow] duration-sc-fast ease-sc
        active:scale-[0.985]
        ${size === 'sm' ? 'h-8 min-w-8 px-2.5 text-xs' : 'h-9 min-w-9 px-3.5 text-sm'}
        ${active ? 'border-sc-primary/28 bg-[var(--sc-accent-soft)] text-[var(--sc-accent-soft-foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]' : variantClasses[variant]}
        ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
