'use client';

import React, { useEffect, useRef } from 'react';
import { Send } from 'lucide-react';
import { Button } from '../Button';

type ChatComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
};

export function ChatComposer({ value, onChange, onSend, onKeyDown }: ChatComposerProps) {
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = (target: HTMLTextAreaElement) => {
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 180)}px`;
  };

  useEffect(() => {
    if (textAreaRef.current) {
      resize(textAreaRef.current);
    }
  }, [value]);

  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--sc-separator)] bg-[color-mix(in_srgb,var(--sc-surface-secondary)_92%,white_8%)] py-1 pl-3.5 pr-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
      <textarea
        ref={textAreaRef}
        value={value}
        rows={1}
        onChange={(event) => {
          onChange(event.target.value);
          resize(event.target);
        }}
        onKeyDown={onKeyDown}
        placeholder="Message…"
        className="min-h-[28px] w-full resize-none border-0 bg-transparent py-1 text-sm text-sc-text outline-none ring-0 focus:outline-none focus:ring-0 placeholder:text-[var(--sc-field-placeholder)]"
      />
      <Button
        variant="soft"
        size="sm"
        disabled={!value.trim()}
        onClick={onSend}
        className="h-7 min-w-7 shrink-0 rounded-full px-0"
        aria-label="Send message"
      >
        <Send size={13} />
      </Button>
    </div>
  );
}
