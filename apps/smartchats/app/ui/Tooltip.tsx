'use client';

import React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { useDesignPack } from '../../core/DesignPackContext';

type TooltipProps = {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
};

const tooltipStyleClasses = {
  solid: 'bg-sc-surface-alt text-sc-text shadow-sc-md',
  outlined: 'bg-[color-mix(in_srgb,var(--sc-surface)_95%,transparent)] backdrop-blur-sm text-sc-text border border-sc-border shadow-sc-sm',
} as const;

export function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  const { pack } = useDesignPack();

  const side = {
    top: 'top',
    bottom: 'bottom',
    left: 'left',
    right: 'right',
  }[position] as 'top' | 'bottom' | 'left' | 'right';

  return (
    <TooltipPrimitive.Provider delayDuration={120}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={8}
            className={`z-[60] rounded-sc-sm px-2.5 py-1.5 text-xs shadow-sc-md
              ${tooltipStyleClasses[pack.componentRules.tooltipStyle]}
              animate-sc-fade-in`}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-[var(--sc-surface-alt)]" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
