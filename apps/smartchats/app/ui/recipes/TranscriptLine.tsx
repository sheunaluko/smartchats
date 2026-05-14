'use client';

import React from 'react';

type TranscriptLineProps = {
  text: string;
  variant?: 'interim' | 'final' | 'assistant';
};

export function TranscriptLine({ text, variant = 'final' }: TranscriptLineProps) {
  if (!text) return null;

  const styles = variant === 'interim'
    ? 'text-sc-text-muted italic'
    : variant === 'assistant'
      ? 'text-sc-primary'
      : 'text-sc-text';

  const label = variant === 'interim'
    ? 'Listening now'
    : variant === 'assistant'
      ? 'Assistant'
      : 'You said';

  return (
    <div className="animate-sc-slide-in-up">
      <div className="mb-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-sc-text-muted">
        {label}
      </div>
      <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${styles}`}>
        {text}
      </p>
    </div>
  );
}
