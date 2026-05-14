'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { useDesignPack } from '../../../core/DesignPackContext';

type MessageBubbleProps = {
  role: string;
  content: string;
  className?: string;
};

export function MessageBubble({ role, content, className = '' }: MessageBubbleProps) {
  const { pack } = useDesignPack();
  const isAssistant = role === 'assistant';
  const alignClass = isAssistant ? 'justify-start' : 'justify-end';

  const messageStyleClasses = {
    bubble: isAssistant
      ? 'bg-sc-surface border border-sc-border/70 shadow-sc-sm'
      : 'bg-sc-primary/20 text-sc-text border border-sc-primary/40 shadow-sc-sm',
    flat: isAssistant
      ? 'bg-sc-surface-alt/80 border border-sc-border/50'
      : 'bg-sc-accent/14 border border-sc-accent/25',
    bordered: isAssistant
      ? 'bg-transparent border border-sc-primary/35'
      : 'bg-transparent border border-sc-accent/35',
  } as const;

  return (
    <div className={`flex ${alignClass} ${className}`}>
      <article
        className={`max-w-[min(100%,52rem)] rounded-[20px] px-4 py-3 backdrop-blur-md
          transition-[transform,box-shadow,border-color] duration-sc-fast ease-sc hover:-translate-y-px
          ${messageStyleClasses[pack.componentRules.messageStyle]}`}
      >
        <div className={`mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] ${isAssistant ? 'text-sc-primary' : 'text-current/80'}`}>
          {isAssistant ? 'SmartChats' : 'You'}
        </div>
        <ReactMarkdown
          className={`line-break text-sm leading-6
            [&_code]:rounded [&_code]:bg-sc-surface-alt [&_code]:px-1.5 [&_code]:py-0.5
            [&_p]:my-1 [&_ul]:my-2 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:pl-5`}
        >
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
