'use client';

/**
 * ClaudeMobileShellV3 — Bottom Tray layout.
 *
 * Moments live in a collapsed tray at the bottom. A thin "peek bar" always shows
 * the latest moment title + activity metrics. Tapping expands to reveal the full
 * MomentStream. The orb stays perfectly centered with zero space cost at rest.
 */

import React, { useMemo, useState, useEffect } from 'react';
import type { ShellProps } from '../../core/types/shell';
import { ChevronUp, ChevronDown } from 'lucide-react';
import {
  AssistantMoment, SessionMiniHeader, TranscriptLine,
  VoiceStage, VoiceStatus,
} from '../ui/recipes';
import {
  ensureKeyframes, deriveState, useMomentStream,
  EventPulseRing, ActivityBand, MomentStream, ShellChrome,
  StatusIcon,
  type StreamMoment,
} from './pulse-stream-shared';

// ── PeekBar (always visible at bottom, shows latest moment) ────────────────────

function PeekBar({
  latest,
  expanded,
  onToggle,
  momentCount,
}: {
  latest: StreamMoment | null;
  expanded: boolean;
  onToggle: () => void;
  momentCount: number;
}) {
  const Icon = latest?.icon;
  const Chevron = expanded ? ChevronDown : ChevronUp;

  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '8px 16px',
        backgroundColor: 'var(--sc-surface, rgba(255,255,255,0.06))',
        borderTop: '1px solid var(--sc-border, rgba(255,255,255,0.08))',
        border: 'none', cursor: 'pointer', color: 'var(--sc-text)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Handle bar */}
      <div style={{
        position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)',
        width: 32, height: 3, borderRadius: 2,
        backgroundColor: 'var(--sc-text-muted)',
        opacity: 0.3,
      }} />

      {latest && Icon ? (
        <>
          <StatusIcon status={latest.status} fallback={Icon} />
          <span style={{
            flex: 1, fontSize: 12, textAlign: 'left',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {latest.title}
          </span>
        </>
      ) : (
        <span style={{ flex: 1, fontSize: 12, color: 'var(--sc-text-muted)' }}>
          No activity yet
        </span>
      )}

      {momentCount > 1 && (
        <span style={{
          fontSize: 10, color: 'var(--sc-text-muted)',
          backgroundColor: 'var(--sc-background, rgba(0,0,0,0.2))',
          padding: '2px 6px', borderRadius: 8,
        }}>
          {momentCount}
        </span>
      )}

      <Chevron size={14} style={{ color: 'var(--sc-text-muted)', flexShrink: 0 }} />
    </button>
  );
}

// ── BottomTray ─────────────────────────────────────────────────────────────────

function BottomTray({
  moments,
  activity,
}: {
  moments: StreamMoment[];
  activity: import('./pulse-stream-shared').ActivityMetrics;
}) {
  const [expanded, setExpanded] = useState(false);
  const latest = moments.length > 0 ? moments[moments.length - 1] : null;

  // Auto-expand briefly when first moment arrives
  useEffect(() => {
    if (moments.length === 1 && moments[0].phase === 'active') {
      setExpanded(true);
      const t = setTimeout(() => setExpanded(false), 3000);
      return () => clearTimeout(t);
    }
  }, [moments.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: 'relative' }}>
      <PeekBar
        latest={latest}
        expanded={expanded}
        onToggle={() => setExpanded(v => !v)}
        momentCount={moments.length}
      />

      {/* Expandable tray content */}
      <div style={{
        maxHeight: expanded ? 280 : 0,
        overflow: 'hidden',
        transition: 'max-height 300ms ease',
        backgroundColor: 'var(--sc-surface, rgba(255,255,255,0.06))',
      }}>
        <div style={{ padding: '8px 12px' }}>
          <ActivityBand activity={activity} />
          <div style={{ marginTop: 8 }}>
            <MomentStream moments={moments} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ClaudeMobileShellV3 ────────────────────────────────────────────────────────

export function ClaudeMobileShellV3({ voice, ui, settings, widgetConfig, widgetProps, actions, meta }: ShellProps) {
  const [composerOpen, setComposerOpen] = useState(false);

  useEffect(() => { ensureKeyframes(); }, []);

  const { moments, pulseFnRef, activity } = useMomentStream(widgetProps, voice, settings);

  const state = useMemo(() => deriveState({
    started: voice.started,
    voiceStatus: voice.voiceStatus,
    executionError: widgetProps.executionError,
  }), [voice.started, voice.voiceStatus, widgetProps.executionError]);

  const lastUserMessage = useMemo(() => {
    return [...widgetProps.chatHistory].reverse().find(m => m.role === 'user')?.content || '';
  }, [widgetProps.chatHistory]);

  const assistantText = useMemo(() => {
    const last = widgetProps.chatHistory.length > 0
      ? widgetProps.chatHistory[widgetProps.chatHistory.length - 1]
      : null;
    return last?.role === 'assistant' ? last.content || '' : '';
  }, [widgetProps.chatHistory]);

  const canInterrupt = state === 'speaking' || state === 'listening' || state === 'processing';
  const level = state === 'listening' ? 0.9 : state === 'speaking' ? 0.6 : state === 'processing' ? 0.45 : 0.18;

  return (
    <div className="flex min-h-dvh flex-col overflow-hidden bg-[var(--sc-background)]">
      <SessionMiniHeader title="SmartChats.AI" onSettings={actions.onOpenSettings} />

      <main className="flex flex-1 flex-col px-4 pb-4">
        <div className="mx-auto flex w-full max-w-[28rem] flex-1 flex-col justify-center gap-5">
          <EventPulseRing pulseFnRef={pulseFnRef}>
            <VoiceStage
              state={state}
              level={level}
              variant="orb"
              audioLevelRef={voice.audioLevelRef}
              onActivate={actions.onStartStop}
            />
          </EventPulseRing>

          <VoiceStatus state={state} />

          <div className="mx-auto flex min-h-[7rem] w-full max-w-[28rem] flex-col gap-3">
            <TranscriptLine text={state === 'listening' ? voice.interimResult : ''} variant="interim" />
            <TranscriptLine text={state !== 'listening' ? lastUserMessage : ''} variant="final" />
            <AssistantMoment text={assistantText} />
          </div>
        </div>
      </main>

      {/* Bottom tray — sits between main content and chrome */}
      <BottomTray moments={moments} activity={activity} />

      <ShellChrome
        canInterrupt={canInterrupt} composerOpen={composerOpen} setComposerOpen={setComposerOpen}
        voice={voice} ui={ui} settings={settings} widgetConfig={widgetConfig} actions={actions} meta={meta}
      />
    </div>
  );
}
