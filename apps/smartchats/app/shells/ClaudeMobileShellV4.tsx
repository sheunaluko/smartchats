'use client';

/**
 * ClaudeMobileShellV4 — Orbital Moments layout.
 *
 * Instead of a separate list, moments appear as floating chips that radiate
 * outward from the pulse ring dot associated with their category. Thinking
 * moments burst from 12 o'clock, tool moments from 9 o'clock, etc.
 * The orb area IS the entire visualization — no separate list needed.
 * Chips fade after a few seconds. Only the activity band persists below.
 */

import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import type { ShellProps } from '../../core/types/shell';
import {
  AssistantMoment, SessionMiniHeader, TranscriptLine,
  VoiceStage, VoiceStatus,
} from '../ui/recipes';
import {
  ensureKeyframes, deriveState, useMomentStream,
  EventPulseRing, ActivityBand, ShellChrome,
  StatusIcon, PULSE_COLORS,
  type StreamMoment, type PulseCategory,
} from './pulse-stream-shared';

// ── Orbital position offsets (where chips radiate TO, relative to orb center) ──

const ORBITAL_OFFSETS: Record<PulseCategory, { x: number; y: number }> = {
  thinking:   { x: 0,    y: -90 },   // above
  responding: { x: 100,  y: 0 },     // right
  executing:  { x: 0,    y: 90 },    // below
  tools:      { x: -100, y: 0 },     // left
  process:    { x: -80,  y: -60 },   // upper-left
};

function kindToCategory(kind: StreamMoment['kind']): PulseCategory {
  switch (kind) {
    case 'thinking': return 'thinking';
    case 'response': return 'responding';
    case 'action': return 'executing';
    case 'process': return 'process';
    case 'info': return 'tools';
  }
}

// ── OrbitalChip — single floating moment chip ─────────────────────────────────

function OrbitalChip({ moment }: { moment: StreamMoment }) {
  const Icon = moment.icon;
  const cat = kindToCategory(moment.kind);
  const offset = ORBITAL_OFFSETS[cat];
  const color = PULSE_COLORS[cat];

  const isExiting = moment.phase === 'exiting';
  const isCompact = moment.phase === 'compact';

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%', top: '50%',
        transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
        display: 'flex', alignItems: 'center', gap: 6,
        padding: isCompact ? '4px' : '5px 10px 5px 6px',
        borderRadius: 16,
        backgroundColor: 'var(--sc-surface, rgba(255,255,255,0.06))',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderLeft: isCompact ? 'none' : `2px solid ${color}`,
        opacity: isExiting ? 0 : 1,
        transition: 'opacity 400ms ease, padding 300ms ease',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        animation: moment.phase === 'active' ? 'sc-slide-in-up 300ms ease-out' : undefined,
        zIndex: moment.phase === 'active' ? 2 : 1,
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <StatusIcon status={moment.status} fallback={Icon} />
      </div>
      {!isCompact && (
        <span style={{
          fontSize: 11, fontWeight: 500, color: 'var(--sc-text)',
          maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {moment.title}
        </span>
      )}
    </div>
  );
}

// ── OrbitalField — renders all orbital chips in the orb area ───────────────────

function OrbitalField({ moments }: { moments: StreamMoment[] }) {
  // Group by category, show only latest per category + any active
  const visible = useMemo(() => {
    const byCategory = new Map<PulseCategory, StreamMoment>();
    const result: StreamMoment[] = [];

    // Collect latest per category
    for (const m of moments) {
      const cat = kindToCategory(m.kind);
      byCategory.set(cat, m);
    }

    // Show all active moments + latest per-category for compact/exiting
    const seen = new Set<string>();
    for (const m of moments) {
      if (m.phase === 'active') {
        result.push(m);
        seen.add(m.id);
      }
    }
    for (const m of byCategory.values()) {
      if (!seen.has(m.id)) {
        result.push(m);
      }
    }

    return result.slice(-6);
  }, [moments]);

  if (visible.length === 0) return null;

  return (
    <>
      {visible.map(m => (
        <OrbitalChip key={m.id} moment={m} />
      ))}
    </>
  );
}

// ── ClaudeMobileShellV4 ────────────────────────────────────────────────────────

export function ClaudeMobileShellV4({ voice, ui, settings, widgetConfig, widgetProps, actions, meta }: ShellProps) {
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
          {/* Orb + orbital field share the same relative container */}
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
            <EventPulseRing pulseFnRef={pulseFnRef}>
              <VoiceStage
                state={state}
                level={level}
                variant="orb"
                audioLevelRef={voice.audioLevelRef}
                onActivate={actions.onStartStop}
              />
            </EventPulseRing>
            <OrbitalField moments={moments} />
          </div>

          <VoiceStatus state={state} />

          <ActivityBand activity={activity} />

          <div className="mx-auto flex min-h-[7rem] w-full max-w-[28rem] flex-col gap-3">
            <TranscriptLine text={state === 'listening' ? voice.interimResult : ''} variant="interim" />
            <TranscriptLine text={state !== 'listening' ? lastUserMessage : ''} variant="final" />
            <AssistantMoment text={assistantText} />
          </div>
        </div>
      </main>

      <ShellChrome
        canInterrupt={canInterrupt} composerOpen={composerOpen} setComposerOpen={setComposerOpen}
        voice={voice} ui={ui} settings={settings} widgetConfig={widgetConfig} actions={actions} meta={meta}
      />
    </div>
  );
}
