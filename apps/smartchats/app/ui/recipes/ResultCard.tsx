'use client';

import React from 'react';
import { Sparkles, CircleHelp, CheckCircle2 } from 'lucide-react';
import type { VoiceMoment } from '../../types/mobileVoice';
import { DataCard } from './DataCard';

export function ResultCard({ moment }: { moment: VoiceMoment }) {
  const icon = moment.kind === 'confirmation'
    ? <CircleHelp size={13} />
    : moment.kind === 'action'
      ? <CheckCircle2 size={13} />
      : <Sparkles size={13} />;

  const tone = moment.kind === 'confirmation'
    ? 'warning'
    : moment.kind === 'action'
      ? 'success'
      : 'primary';

  return (
    <DataCard
      tone={tone}
      className="animate-sc-slide-in-up"
      header={
        <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-sc-primary">
          {icon}
          {moment.title || 'Result'}
        </div>
      }
    >
      {moment.body && <p className="text-sm text-sc-text">{moment.body}</p>}
      {moment.meta && <p className="text-xs uppercase tracking-[0.12em] text-sc-text-muted">{moment.meta}</p>}
    </DataCard>
  );
}
