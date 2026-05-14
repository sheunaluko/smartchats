'use client';

import React from 'react';
import { ChatComposer } from './ChatComposer';

type FallbackComposerProps = {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
};

export function FallbackComposer({
  open,
  value,
  onChange,
  onSend,
  onKeyDown,
}: FallbackComposerProps) {
  if (!open) return null;

  return (
    <div className="safe-area-bottom border-t surface-divider bg-[color-mix(in_srgb,var(--sc-surface)_94%,transparent)] px-4 pt-2 backdrop-blur-xl" style={{ paddingBottom: 10 }}>
      <ChatComposer
        value={value}
        onChange={onChange}
        onSend={onSend}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
