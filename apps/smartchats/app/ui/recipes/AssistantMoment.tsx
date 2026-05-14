'use client';

import React from 'react';
import { Volume2, X } from 'lucide-react';
import { DataCard } from './DataCard';

export function AssistantMoment({ text, onDismiss }: { text: string; onDismiss?: () => void }) {
  if (!text) return null;

  return (
    <div className="relative">
      <DataCard
        tone="primary"
        className="animate-sc-slide-in-up"
        header={
          <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-sc-primary">
            <Volume2 size={13} />
            Assistant response
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-sc-text">{text}</p>
      </DataCard>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full text-sc-text-muted transition-colors duration-sc-fast hover:bg-sc-surface-secondary hover:text-sc-text"
          aria-label="Dismiss response"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
