'use client';

import React, { useEffect, useRef } from 'react';
import WidgetItem from '../WidgetItem';
import type { QueueEntryStatus } from '@lab-components/tivi/lib/tts_queue';
import { Chip } from '../ui/Chip';
import { DataCard, EmptyState, MetricRow } from '../ui/recipes';

interface SpeechQueueWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  entries: QueueEntryStatus[];
}

const STATUS_CONFIG: Record<string, { icon: string; colorClass: string; label: string }> = {
  queued:  { icon: '\u25CB', colorClass: 'text-sc-primary',     label: 'Ready' },
  loading: { icon: '\u25D4', colorClass: 'text-sc-warning',     label: 'Loading...' },
  playing: { icon: '\u25CF', colorClass: 'text-sc-success',     label: 'Playing' },
  done:    { icon: '\u2713', colorClass: 'text-sc-text-muted/40', label: 'Done' },
  error:   { icon: '\u2717', colorClass: 'text-sc-danger',      label: 'Error' },
};

const SpeechQueueWidget: React.FC<SpeechQueueWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  entries,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the active entry (within container only)
  useEffect(() => {
    if (scrollRef.current) {
      const active = scrollRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
      if (active) {
        const container = scrollRef.current;
        const activeTop = active.offsetTop - container.offsetTop;
        container.scrollTop = activeTop - container.clientHeight / 2 + active.clientHeight / 2;
      }
    }
  }, [entries]);


  return (
    <WidgetItem
      title="Speech Queue"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
    >
      <div ref={scrollRef} className="scrollbar-hide overflow-y-auto max-h-[95%]">
        {entries.length === 0 ? (
          <EmptyState
            title="No utterances queued"
            description="Queued speech, playback state, and cached clips will appear here."
            className="m-3"
          />
        ) : (
          entries.map((entry) => {
            const cfg = STATUS_CONFIG[entry.status] || STATUS_CONFIG.queued;
            const isActive = entry.status === 'loading' || entry.status === 'playing';
            const isDone = entry.status === 'done';

            return (
              <DataCard
                key={entry.id}
                data-active={isActive ? 'true' : undefined}
                tone={entry.status === 'error' ? 'danger' : entry.status === 'playing' ? 'success' : entry.status === 'loading' ? 'warning' : 'default'}
                className={`mb-3 ${isDone ? 'opacity-60' : ''}`}
                header={
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className={`${cfg.colorClass} shrink-0 text-sm ${entry.status === 'playing' ? 'animate-pulse' : ''}`}
                    >
                      {cfg.icon}
                    </span>
                    <Chip
                      label={cfg.label}
                      size="sm"
                      variant={entry.status === 'error' ? 'danger' : entry.status === 'playing' ? 'success' : entry.status === 'loading' ? 'warning' : 'default'}
                    />
                  </div>
                }
              >
                <MetricRow label="Cached" value={entry.cached ? 'yes' : 'no'} />
                <p className="truncate font-mono text-xs text-sc-text-muted">
                  {entry.cached ? 'cached clip' : entry.text ? (entry.text.length > 90 ? `${entry.text.slice(0, 90)}...` : entry.text) : '(cached)'}
                </p>
              </DataCard>
            );
          })
        )}
      </div>
    </WidgetItem>
  );
};

export default React.memo(SpeechQueueWidget);
