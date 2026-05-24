'use client';

/**
 * ClaudeMobileShellV2 — Edge Rail layout.
 *
 * Orb is an absolute background element (top-aligned behind header).
 * Content zone starts at ~35dvh and overlaps the orb naturally.
 * Floating action menu in bottom-right provides stop + keyboard.
 * Keyboard mode fades the orb and shows a full chat view.
 */

import React, { useMemo, useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import type { ShellProps } from '../../core/types/shell';
import type { MobileVoiceState } from '../types/mobileVoice';
import { Keyboard, Square, Mic, Plus, Settings2, User, UserCheck, Pause, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { SessionBrowser } from '../components/SessionBrowser';
import { SettingsPanel } from '../components/SettingsPanel';
import { AccountPanel } from '../components/AccountPanel';
import {
  AssistantMoment, FallbackComposer,
  SessionMiniHeader, TranscriptLine,
  VoiceStage, VoiceStatus,
  ChatComposer,
} from '../ui/recipes';
import { VisualizationRenderer } from '../visualizations';
import type { Visualization } from '../visualizations';
import { HTMLViewer } from '../visualizations/HTMLViewer';
import { TourOverlay } from '../components/TourOverlay';
import { useSmartChatsStore } from '../store/useSmartChatsStore';
import { useInsights } from '@/context/InsightsContext';
import { useTrackedClick } from '../hooks/useTrackedClick';
import {
  ensureKeyframes, deriveState, useMomentStream,
  EventPulseRing,
  StatusIcon, PULSE_COLORS,
  type StreamMoment, type PulseCategory,
} from './pulse-stream-shared';

// ── useIsNarrow (iPhone-class screens ≤430px) ─────────────────────────────────

const NARROW_BREAKPOINT = 430;

function subscribeToResize(cb: () => void) {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

function getIsNarrow() {
  return typeof window !== 'undefined' ? window.innerWidth <= NARROW_BREAKPOINT : true;
}

function useIsNarrow() {
  return useSyncExternalStore(subscribeToResize, getIsNarrow, () => true);
}

// ── Category color mapping for moment kinds ────────────────────────────────────

function kindToCategory(kind: StreamMoment['kind']): PulseCategory {
  switch (kind) {
    case 'thinking': return 'thinking';
    case 'response': return 'responding';
    case 'action': return 'executing';
    case 'process': return 'process';
    case 'info': return 'tools';
  }
}

// ── EdgeRailMoment ─────────────────────────────────────────────────────────────

function EdgeRailMoment({ moment, narrow }: { moment: StreamMoment; narrow: boolean }) {
  const Icon = moment.icon;
  const cat = kindToCategory(moment.kind);
  const color = PULSE_COLORS[cat];

  const dotSize = narrow ? 14 : 22;
  const iconSize = narrow ? 7 : 10;

  if (moment.phase === 'exiting') {
    return (
      <div style={{ animation: 'sc-fade-out-left 400ms ease-out forwards' }}>
        <div style={{
          width: dotSize, height: dotSize, borderRadius: '50%', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'var(--sc-surface, rgba(255,255,255,0.06))',
        }}>
          <Icon size={iconSize} style={{ color: 'var(--sc-text-muted)' }} />
        </div>
      </div>
    );
  }

  if (moment.phase === 'compact') {
    return (
      <div
        title={moment.title}
        style={{
          width: dotSize, height: dotSize, borderRadius: '50%', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'var(--sc-surface, rgba(255,255,255,0.06))',
          borderLeft: `${narrow ? 1 : 2}px solid ${color}`,
          transition: 'all 300ms ease',
        }}
      >
        <StatusIcon status={moment.status} fallback={Icon} size={iconSize} />
      </div>
    );
  }

  // Active phase — expanded card
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: narrow ? 3 : 5,
        padding: narrow ? '2px 5px 2px 4px' : '4px 8px 4px 5px',
        borderRadius: narrow ? 8 : 11,
        backgroundColor: 'var(--sc-surface, rgba(255,255,255,0.06))',
        borderLeft: `${narrow ? 1 : 2}px solid ${color}`,
        animation: 'sc-slide-in-left 300ms ease-out',
        maxWidth: narrow ? 110 : 160, whiteSpace: 'nowrap',
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <StatusIcon status={moment.status} fallback={Icon} size={narrow ? 7 : 10} />
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{
          fontSize: narrow ? 7 : 10, fontWeight: 500, color: 'var(--sc-text)',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {moment.title}
        </div>
        {!narrow && moment.meta && (
          <div style={{ fontSize: 8, color: 'var(--sc-text-muted)' }}>
            {moment.meta}
          </div>
        )}
      </div>
    </div>
  );
}

// ── EdgeRail (kept for reference, currently unused) ───────────────────────────

function EdgeRail({ moments }: { moments: StreamMoment[] }) {
  const narrow = useIsNarrow();
  const maxItems = narrow ? 4 : 5;
  const visible = moments.slice(-maxItems);

  return (
    <div style={{
      position: 'absolute', left: narrow ? 2 : 4, top: '10dvh', height: '23dvh',
      justifyContent: 'center',
      display: 'flex', flexDirection: 'column', gap: narrow ? 3 : 5,
      zIndex: 10, pointerEvents: 'none',
    }}>
      {visible.map(m => (
        <div key={m.id} style={{ pointerEvents: 'auto' }}>
          <EdgeRailMoment moment={m} narrow={narrow} />
        </div>
      ))}
    </div>
  );
}

// ── InlineMomentCard ──────────────────────────────────────────────────────────

function InlineMomentCard({ moment }: { moment: StreamMoment }) {
  const Icon = moment.icon;
  const cat = kindToCategory(moment.kind);
  const color = PULSE_COLORS[cat];

  const isExiting = moment.phase === 'exiting';
  const isCompact = moment.phase === 'compact';

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: isCompact ? '4px 12px' : '8px 14px',
        borderRadius: 12,
        backgroundColor: 'var(--sc-surface, rgba(255,255,255,0.06))',
        borderLeft: `3px solid ${color}`,
        animation: isExiting
          ? 'sc-fade-out 400ms ease-out forwards'
          : 'sc-slide-in-left 300ms ease-out',
        opacity: isExiting ? 0 : 1,
        transition: 'padding 200ms ease, opacity 200ms ease',
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <StatusIcon status={moment.status} fallback={Icon} size={isCompact ? 12 : 15} />
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{
          fontSize: isCompact ? 11 : 13, fontWeight: 500, color: 'var(--sc-text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {moment.title}
        </div>
        {!isCompact && moment.meta && (
          <div style={{ fontSize: 11, color: 'var(--sc-text-muted)', marginTop: 2 }}>
            {moment.meta}
          </div>
        )}
      </div>
      {moment.status === 'success' && moment.meta && (
        <span style={{ fontSize: 10, color: 'var(--sc-text-muted)', flexShrink: 0 }}>
          {moment.meta}
        </span>
      )}
    </div>
  );
}

// ── InlineMomentStream ────────────────────────────────────────────────────────

function InlineMomentStream({ moments }: { moments: StreamMoment[] }) {
  const visible = moments.slice(-6);
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {visible.map(m => (
        <InlineMomentCard key={m.id} moment={m} />
      ))}
    </div>
  );
}

import { AppContainer } from '../components/AppContainer';

// ── MiniOrb — tiny orb for header with orbiting dots, wave, and audio reactivity

function MiniOrb({ state, audioLevelRef }: { state: MobileVoiceState; audioLevelRef?: React.MutableRefObject<number> }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const coreRef = useRef<HTMLSpanElement>(null);
  const orbit1Ref = useRef<HTMLDivElement>(null);
  const waveRef = useRef<SVGPathElement>(null);
  const smoothRef = useRef(0);
  const speckAngle1Ref = useRef(0);
  const wavePhaseRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    lastTimeRef.current = null;
    let frameId = 0;

    const animate = (timestamp: number) => {
      const lastTime = lastTimeRef.current ?? timestamp;
      const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
      lastTimeRef.current = timestamp;

      // Audio level smoothing (heavy smoothing to avoid jitter)
      const raw = audioLevelRef?.current || 0;
      const normalized = Math.max(0, Math.min(1, raw * 3));
      smoothRef.current += (normalized - smoothRef.current) * 0.1;
      const level = smoothRef.current;

      // Core glow + scale (audio-reactive for listening/speaking)
      if (coreRef.current) {
        const isActive = state === 'listening' || state === 'speaking';
        if (isActive && audioLevelRef) {
          const scale = 1 + level * 0.18;
          const spread = 2 + level * 8;
          const opacity = 0.3 + level * 0.5;
          const rgb = state === 'listening' ? '59,130,246' : '168,85,247';
          coreRef.current.style.transform = `scale(${scale})`;
          coreRef.current.style.boxShadow = `0 0 ${spread}px ${1 + level * 3}px rgba(${rgb},${opacity}), inset 0 1px 2px rgba(255,255,255,0.12)`;
        } else {
          coreRef.current.style.transform = 'scale(1)';
          coreRef.current.style.boxShadow = '';
        }
      }

      // Speck rotation speeds
      const speckSpeed =
        state === 'loading' ? 220 :
        state === 'processing' ? 108 :
        state === 'listening' || state === 'speaking' ? 18 : 0;

      speckAngle1Ref.current = (speckAngle1Ref.current + speckSpeed * dt + 360) % 360;

      if (orbit1Ref.current) orbit1Ref.current.style.transform = `rotate(${speckAngle1Ref.current.toFixed(1)}deg)`;

      // Wave (speaking only)
      if (waveRef.current) {
        if (state === 'speaking') {
          wavePhaseRef.current += 3.8 * dt;
          const w = 28, h = 28, midY = h * 0.5;
          const amp = 3 + Math.sin(wavePhaseRef.current * 0.8) * 0.8;
          let d = `M 0 ${midY.toFixed(1)}`;
          for (let i = 1; i <= 16; i++) {
            const x = (i / 16) * w;
            const y = midY - Math.sin((i / 16) * Math.PI * 2.2 + wavePhaseRef.current) * amp;
            d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
          }
          waveRef.current.setAttribute('d', d);
          waveRef.current.style.opacity = '0.6';
        } else {
          waveRef.current.style.opacity = '0';
        }
      }

      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [state, audioLevelRef]);

  const glowColor =
    state === 'listening' ? 'var(--sc-primary, #3b82f6)' :
    state === 'processing' ? 'var(--sc-warning, #f59e0b)' :
    state === 'speaking' ? 'var(--sc-accent, #a855f7)' :
    'var(--sc-text-muted, #6b7280)';

  const isActive = state === 'listening' || state === 'speaking';
  const showSpecks = state !== 'idle' && state !== 'ready' && state !== 'error';

  return (
    <span ref={containerRef} className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center">
      {/* Core orb */}
      <span
        ref={coreRef}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        style={{
          background: [
            'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.18), transparent 34%)',
            'radial-gradient(circle, color-mix(in srgb, var(--sc-primary) 28%, var(--sc-surface-secondary)), var(--sc-surface))',
          ].join(', '),
          boxShadow: isActive && audioLevelRef ? undefined : `0 0 8px 2px color-mix(in srgb, ${glowColor} 30%, transparent), inset 0 1px 2px rgba(255,255,255,0.12)`,
          animation: state === 'processing' ? 'sc-mini-orb-pulse 1.5s ease-in-out infinite' : undefined,
          transition: 'box-shadow 400ms ease',
        }}
      >
        {/* Sine wave overlay (speaking) */}
        <svg viewBox="0 0 28 28" className="absolute inset-0 h-full w-full overflow-visible" style={{ pointerEvents: 'none' }}>
          <path
            ref={waveRef}
            fill="none"
            stroke="color-mix(in srgb, white 26%, var(--sc-accent))"
            strokeWidth="1.5"
            strokeLinecap="round"
            style={{ opacity: 0, transition: 'opacity 200ms ease' }}
          />
        </svg>
      </span>

      {/* Orbiting speck — rendered above core, centered on radius */}
      {showSpecks && (
        <div ref={orbit1Ref} className="pointer-events-none absolute inset-0 z-10">
          <div className="absolute left-1/2 rounded-full" style={{
            top: -1, width: 3, height: 3, transform: 'translateX(-50%) scale(0.833)',
            background: 'color-mix(in srgb, white 58%, var(--sc-primary))',
            boxShadow: '0 0 3px color-mix(in srgb, var(--sc-primary) 50%, transparent)',
            opacity: 0.9,
          }} />
        </div>
      )}
    </span>
  );
}

// ── ThinkingWave — animated sine wave for pending assistant bubble ────────────

function ThinkingWave() {
  const pathRef = useRef<SVGPathElement>(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    let frameId = 0;
    const animate = () => {
      phaseRef.current += 0.035;
      if (pathRef.current) {
        const w = 200, h = 32, mid = h / 2;
        let d = `M 0 ${mid}`;
        for (let i = 1; i <= 30; i++) {
          const x = (i / 30) * w;
          const y = mid - Math.sin((i / 30) * Math.PI * 2.8 + phaseRef.current) * 7;
          d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
        }
        pathRef.current.setAttribute('d', d);
      }
      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <svg viewBox="0 0 200 32" className="h-6 w-full" style={{ opacity: 0.35 }}>
      <path
        ref={pathRef}
        fill="none"
        stroke="var(--sc-primary)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── PendingAssistantBubble — shows wave + action moments while agent works ───

function PendingAssistantBubble({ moments }: { moments: StreamMoment[] }) {
  // Only action/process/info moments — no thinking or response
  const actionMoments = moments.filter(
    m => (m.kind === 'action' || m.kind === 'process' || m.kind === 'info')
      && m.phase !== 'exiting'
  );
  const hasActions = actionMoments.length > 0;

  return (
    <div className="flex justify-start" style={{ animation: 'sc-slide-in-up 300ms ease-out' }}>
      <div className="max-w-[85%] rounded-2xl bg-[var(--sc-surface-secondary)] px-3.5 py-2.5">
        {!hasActions ? (
          /* Pure thinking — show wave */
          <ThinkingWave />
        ) : (
          /* Actions arrived — show moments with wave above */
          <div className="flex flex-col gap-2">
            <ThinkingWave />
            {actionMoments.slice(-4).map(m => (
              <InlineMomentCard key={m.id} moment={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── FloatingActionMenu — Vertical magnetic spring ──────────────────────────────

const FAB_GAP = 56;

type FABAction = {
  id: string;
  icon: React.ComponentType<any>;
  label: string;
  variant: 'default' | 'danger';
  onClick: () => void;
};

function FloatingActionMenu({ isSpeaking, canStop, onInterrupt, onStop, onKeyboard, onSettings, chatMode }: {
  isSpeaking: boolean;
  canStop: boolean;
  onInterrupt: () => void;
  onStop: () => void;
  onKeyboard: () => void;
  onSettings: () => void;
  chatMode?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [ripple, setRipple] = useState(false);
  const { client: insightsClient } = useInsights();

  const toggle = useCallback(() => {
    insightsClient?.addEvent?.('ui_click', { name: 'fab.toggle', surface: 'mobile_v2_fab' }).catch?.(() => {});
    setOpen(v => {
      if (!v) {
        setRipple(true);
        setTimeout(() => setRipple(false), 500);
      }
      return !v;
    });
  }, [insightsClient]);

  const wrap = useCallback((fn: () => void, name: string) => () => {
    insightsClient?.addEvent?.('ui_click', { name, surface: 'mobile_v2_fab' }).catch?.(() => {});
    fn();
    setOpen(false);
  }, [insightsClient]);

  const fabActions: FABAction[] = useMemo(() => chatMode ? [
    {
      id: 'mic',
      icon: Mic,
      label: 'Voice mode',
      variant: 'default' as const,
      onClick: wrap(onKeyboard, 'fab.mic_from_chat'),
    },
    {
      id: 'settings',
      icon: Settings2,
      label: 'Settings',
      variant: 'default' as const,
      onClick: wrap(onSettings, 'fab.settings_from_chat'),
    },
  ] : [
    ...(isSpeaking ? [{
      id: 'interrupt',
      icon: Pause,
      label: 'Interrupt',
      variant: 'default' as const,
      onClick: wrap(onInterrupt, 'fab.interrupt'),
    }] : []),
    {
      id: 'keyboard',
      icon: Keyboard,
      label: 'Keyboard',
      variant: 'default' as const,
      onClick: wrap(onKeyboard, 'fab.keyboard'),
    },
    ...(canStop ? [{
      id: 'stop',
      icon: Square,
      label: 'Stop',
      variant: 'danger' as const,
      onClick: wrap(onStop, 'fab.stop'),
    }] : []),
    {
      id: 'settings',
      icon: Settings2,
      label: 'Settings',
      variant: 'default' as const,
      onClick: wrap(onSettings, 'fab.settings'),
    },
  ], [chatMode, isSpeaking, canStop, wrap, onInterrupt, onStop, onKeyboard, onSettings]);

  return (
    <div data-tour="fab" className="fixed right-4 z-30 safe-area-bottom" style={{ bottom: chatMode ? 70 : 24 }}>
      <div className="relative flex items-center justify-center" style={{ width: 48, height: 48 }}>

        {/* Ripple ring */}
        {ripple && (
          <div
            className="pointer-events-none absolute rounded-full border border-[var(--sc-primary)]"
            style={{
              width: 48, height: 48,
              left: 0, top: 0,
              animation: 'fab-ripple 500ms ease-out forwards',
            }}
          />
        )}

        {/* Action buttons — straight up */}
        {fabActions.map((action, i) => {
          const Icon = action.icon;
          const slot = i + 1;
          const targetY = -(slot * FAB_GAP);
          const delay = i * 60;
          const isDanger = action.variant === 'danger';

          return (
            <button
              key={action.id}
              onClick={action.onClick}
              className={`absolute flex h-11 w-11 items-center justify-center rounded-full shadow-sc-md backdrop-blur-md active:scale-90 ${
                isDanger
                  ? 'bg-[color-mix(in_srgb,var(--sc-danger)_18%,var(--sc-surface)_82%)] text-[var(--sc-danger)]'
                  : 'bg-[color-mix(in_srgb,var(--sc-surface-secondary)_80%,transparent)] text-sc-text'
              }`}
              style={{
                transform: open
                  ? `translateY(${targetY}px) scale(1)`
                  : 'translateY(0px) scale(0)',
                opacity: open ? 1 : 0,
                transition: open
                  ? `transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}ms, opacity 250ms ease ${delay}ms`
                  : `transform 250ms cubic-bezier(0.55, 0, 1, 0.45) ${(fabActions.length - 1 - i) * 40}ms, opacity 150ms ease`,
              }}
              aria-label={action.label}
            >
              <Icon size={16} />
            </button>
          );
        })}

        {/* FAB trigger */}
        <button
          onClick={toggle}
          className="relative flex h-12 w-12 items-center justify-center rounded-full text-sc-text-muted backdrop-blur-md transition-all duration-300 active:scale-90"
          style={{
            background: open
              ? 'color-mix(in srgb, var(--sc-primary) 15%, var(--sc-surface) 85%)'
              : chatMode
                ? 'color-mix(in srgb, var(--sc-surface-secondary) 40%, transparent)'
                : 'color-mix(in srgb, var(--sc-surface-secondary) 65%, transparent)',
            boxShadow: open
              ? '0 0 20px color-mix(in srgb, var(--sc-primary) 25%, transparent), var(--sc-shadow-lg)'
              : 'var(--sc-shadow-lg)',
            opacity: chatMode && !open ? 0.35 : 1,
            transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
          }}
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          <Plus size={20} strokeWidth={2} style={{ transition: 'transform 300ms ease' }} />
        </button>
      </div>
    </div>
  );
}

// Inject FAB ripple keyframe
function ensureFabKeyframes() {
  if (typeof document === 'undefined') return;
  const id = 'fab-ripple-kf';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = [
    `@keyframes fab-ripple { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(4); opacity: 0; } }`,
    `@keyframes fab-fade-in { 0% { opacity: 0; transform: translateY(-50%) scale(0.92); } 100% { opacity: 0.85; transform: translateY(-50%) scale(1); } }`,
    `@keyframes sc-mini-orb-pulse { 0%, 100% { box-shadow: 0 0 8px 2px color-mix(in srgb, var(--sc-warning) 30%, transparent), inset 0 1px 2px rgba(255,255,255,0.12); } 50% { box-shadow: 0 0 14px 4px color-mix(in srgb, var(--sc-warning) 50%, transparent), inset 0 1px 2px rgba(255,255,255,0.12); } }`,
    `@keyframes sc-mini-orb-speak { 0%, 100% { box-shadow: 0 0 8px 2px color-mix(in srgb, var(--sc-accent) 30%, transparent), inset 0 1px 2px rgba(255,255,255,0.12); transform: scale(1); } 50% { box-shadow: 0 0 12px 3px color-mix(in srgb, var(--sc-accent) 45%, transparent), inset 0 1px 2px rgba(255,255,255,0.12); transform: scale(1.08); } }`,
  ].join('\n');
  document.head.appendChild(style);
}

// ── ClaudeMobileShellV2 ────────────────────────────────────────────────────────

export function ClaudeMobileShellV2({ voice, ui, auth, settings, widgetConfig, widgetProps, actions, meta }: ShellProps) {
  const [chatMode, setChatMode] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [momentDismissed, setMomentDismissed] = useState(false);

  // Shell mode from store — controllable by functions/orchestrator
  const shellMode = useSmartChatsStore(s => s.shellMode);
  const setShellMode = useSmartChatsStore(s => s.setShellMode);
  // Map shellMode to orbSize equivalent for layout calculations
  const orbSize: 'full' | 'half' | 'icon' = shellMode === 'guided' ? 'half' : shellMode;

  useEffect(() => { ensureKeyframes(); ensureFabKeyframes(); }, []);

  // Listen for dismiss events from agent's dismiss_display function
  useEffect(() => {
    const handler = () => setMomentDismissed(true);
    window.addEventListener('smartchats:dismiss', handler);
    return () => window.removeEventListener('smartchats:dismiss', handler);
  }, []);

  const { moments, pulseFnRef, activity } = useMomentStream(widgetProps, voice, settings);

  const initLoading = useSmartChatsStore(s => s.initLoading);
  const state = useMemo(() => deriveState({
    started: voice.started,
    voiceStatus: voice.voiceStatus,
    executionError: widgetProps.executionError,
    initLoading,
  }), [voice.started, voice.voiceStatus, widgetProps.executionError, initLoading]);

  const lastUserMessage = useMemo(() => {
    return [...widgetProps.chatHistory].reverse().find(m => m.role === 'user')?.content || '';
  }, [widgetProps.chatHistory]);

  const assistantText = useMemo(() => {
    const last = widgetProps.chatHistory.length > 0
      ? widgetProps.chatHistory[widgetProps.chatHistory.length - 1]
      : null;
    return last?.role === 'assistant' ? last.content || '' : '';
  }, [widgetProps.chatHistory]);

  // Reset dismiss state when assistant text changes (new response)
  useEffect(() => {
    if (assistantText) setMomentDismissed(false);
  }, [assistantText]);

  // Welcome screen: show orb in animated "processing" state when logged out and pre-activation
  const showWelcome = !auth.isAuthenticated && !voice.started;
  const orbState = showWelcome ? 'listening' as const : state;
  const canInterrupt = state === 'speaking' || state === 'listening' || state === 'processing' || state === 'loading';
  const level = showWelcome ? 0.45 : state === 'loading' ? 0.45 : state === 'listening' ? 0.9 : state === 'speaking' ? 0.6 : state === 'processing' ? 0.45 : 0.18;

  // Track whether user has ever activated — orb starts centered, moves up after first tap
  const [hasActivated, setHasActivated] = useState(false);
  useEffect(() => {
    if (voice.started && !hasActivated) setHasActivated(true);
  }, [voice.started, hasActivated]);

  // Orb size cycle: full → half → icon (tap orb), icon → full (tap header)
  const cycleOrbSize = useCallback(() => {
    setShellMode(shellMode === 'full' ? 'half' : shellMode === 'half' ? 'icon' : 'full');
  }, [shellMode, setShellMode]);
  const restoreOrbFull = useCallback(() => setShellMode('full'), [setShellMode]);

  // Reset shell mode when voice stops (unless guided — that's function-controlled)
  useEffect(() => {
    if (!voice.started && shellMode !== 'guided') setShellMode('full');
  }, [voice.started, shellMode, setShellMode]);

  // App platform
  const activeAppId = useSmartChatsStore(s => s.activeAppId);
  const activeAppSandbox = useSmartChatsStore(s => s.activeAppSandbox);
  const activeAppName = useSmartChatsStore(s => s.activeApp?.name);
  // Check if any visualizations or HTML are active — hide transcript/assistant when they are
  const hasViz = useSmartChatsStore(s => s.vizStack.length > 0);
  const hasContent = hasViz || !!widgetProps.activeHtml;

  // Split moments: edge rail gets nothing (thoughts/speak filtered out), inline gets actions minus code-execution
  const edgeMoments = useMemo(() => [] as typeof moments, []);
  const inlineMoments = useMemo(() => moments.filter(m => {
    if (m.kind === 'action') {
      // Keep function calls (title: "Using ..."), filter out code execution moments
      return m.title.startsWith('Using ');
    }
    return m.kind === 'process' || m.kind === 'info';
  }), [moments]);

  // Determine if we're in the "working" phase — action/process moments are actively streaming
  const hasActiveInline = inlineMoments.some(m => m.phase === 'active' || m.status === 'running');
  const isWorking = hasActiveInline;
  const hasActiveMoments = moments.some(m => m.phase === 'active' || m.status === 'running');

  // ── Pending assistant bubble (chat mode) ──
  // Show when last message is from user and agent is actively working
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastMsgRole = widgetProps.chatHistory.length > 0
    ? widgetProps.chatHistory[widgetProps.chatHistory.length - 1]?.role
    : null;
  const showPendingBubble = lastMsgRole === 'user' && (hasActiveMoments || state === 'processing');

  // Auto-scroll chat after interactions: new messages, vizzes, pending bubble
  useEffect(() => {
    if (chatMode && chatScrollRef.current) {
      requestAnimationFrame(() => {
        chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
  }, [chatMode, showPendingBubble, moments.length, widgetProps.chatHistory.length]);

  // Scroll-to-expand: track scroll progress to blur orb and expand content
  const mainRef = useRef<HTMLElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const threshold = 120; // px of scroll to fully expand
    function onScroll() {
      const progress = Math.min(1, el!.scrollTop / threshold);
      setScrollProgress(progress);
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Only apply scroll expansion when viz/html content is active
  const expandProgress = hasContent ? scrollProgress : 0;
  // Orb zone sizing per orbSize state
  const orbZoneHeight = orbSize === 'full' ? 35 : orbSize === 'half' ? 20 : 0;
  const orbOverlap = orbSize === 'full' ? 28 : orbSize === 'half' ? 14 : 0;
  const scrollShrink = orbSize === 'full' ? 27 : orbSize === 'half' ? 12 : 0;
  const expandedMargin = orbSize === 'icon'
    ? '48px'
    : `calc(${orbZoneHeight}dvh - ${orbOverlap}px - ${expandProgress * scrollShrink}dvh)`;
  const orbBlur = expandProgress * 10; // 0 to 10px blur
  const orbScale = orbSize === 'full' ? 1 : orbSize === 'half' ? 0.5 : 0;

  const handleToggleChatMode = useCallback(() => {
    setShellMode('full');
    setChatMode(prev => {
      if (!prev) {
        // Entering chat mode — stop voice and cancel speech
        actions.onCancelSpeech();
        if (voice.started) actions.onStartStop();
      } else {
        // Leaving chat mode — if there's been any interaction, skip the welcome/centered-orb state
        if (widgetProps.chatHistory.length > 0) setHasActivated(true);
      }
      return !prev;
    });
  }, [actions, voice.started, widgetProps.chatHistory.length]);

  const handleStop = useCallback(() => {
    actions.onCancelSpeech();
    actions.onStartStop();
  }, [actions]);

  // ── Click telemetry wrappers (non-FAB clicks in this shell) ──
  // FAB clicks are tracked inside FloatingActionMenu's wrap() helper.
  const trackedHandleToggleChatMode = useTrackedClick(handleToggleChatMode, 'header.title_toggle_chat', 'mobile_v2');
  const trackedCycleOrbSize = useTrackedClick(cycleOrbSize, 'orb.resize', 'mobile_v2');
  const trackedRestoreOrbFull = useTrackedClick(restoreOrbFull, 'header.restore_orb', 'mobile_v2');
  const trackedOrbStartStop = useTrackedClick(actions.onStartStop, 'orb.start_stop', 'mobile_v2');
  const trackedOrbLogin = useTrackedClick(actions.onLogin, 'orb.login', 'mobile_v2');
  const trackedWelcomeLogin = useTrackedClick(actions.onLogin, 'welcome.signin_button', 'mobile_v2');

  // ── Chat mode: full chat view, orb hidden ──
  if (chatMode) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-[var(--sc-background)]" style={{ position: 'fixed', inset: 0, overscrollBehavior: 'none', touchAction: 'manipulation' }}>
        <SessionMiniHeader
          title="SmartChats.AI"
          activity={activity}
          credits={auth.totalAvailable}
          authAction={auth.isAuthenticated ? actions.onOpenSettings : actions.onLogin}
          authIcon={auth.isAuthenticated ? 'authenticated' : 'unauthenticated'}
          brandElement={<MiniOrb state={state} audioLevelRef={voice.audioLevelRef} />}
          onTitleClick={trackedHandleToggleChatMode}
        />

        {/* Chat messages — scrollable, full height */}
        <div ref={chatScrollRef} className="flex flex-1 flex-col overflow-y-auto px-4 pb-2">
          <div className="mx-auto flex w-full max-w-[28rem] flex-1 flex-col justify-end gap-3">
            {widgetProps.chatHistory
              .filter((msg: any) => {
                if (msg.role === 'system') return false;
                if (msg.role === 'user') {
                  if (!msg.content) return false;
                  try { const p = JSON.parse(msg.content); if (p.type !== 'text') return false; } catch {}
                }
                if (msg.role === 'assistant' && !msg.content) return false;
                return true;
              })
              .map((msg: any, i: number) =>
                msg.role === 'viz' ? (
                  <div key={`viz-${msg._ts}`} className="flex justify-start">
                    <div className="w-full rounded-2xl bg-[var(--sc-surface-secondary)] overflow-hidden">
                      <VisualizationRenderer
                        viz={{ type: msg.vizType, props: msg.vizProps } as Visualization}
                        onDismiss={() => {}}
                      />
                    </div>
                  </div>
                ) : (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-[var(--sc-primary)] text-white'
                        : 'bg-[var(--sc-surface-secondary)] text-sc-text'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                )
            )}

            {/* Pending assistant bubble — wave + action moments while agent works */}
            {showPendingBubble && (
              <PendingAssistantBubble moments={moments} />
            )}
          </div>
        </div>

        {/* FAB — mic + settings in chat mode, just above composer */}
        <FloatingActionMenu
          isSpeaking={false}
          canStop={false}
          onInterrupt={() => {}}
          onStop={() => {}}
          onKeyboard={handleToggleChatMode}
          onSettings={actions.onOpenSettings}
          chatMode
        />

        {/* Composer at bottom */}
        <div className="safe-area-bottom border-t surface-divider bg-[color-mix(in_srgb,var(--sc-surface)_94%,transparent)] px-4 pt-2 backdrop-blur-xl" style={{ paddingBottom: 10 }}>
          <div className="mx-auto flex max-w-[28rem] items-center gap-2">
            <div className="flex-1">
              <ChatComposer
                value={actions.chatInput}
                onChange={actions.setChatInput}
                onSend={actions.handleChatSend}
                onKeyDown={actions.handleChatKeyPress}
              />
            </div>
          </div>
        </div>

        <SettingsPanel
          variant="fullscreen"
          widgets={widgetConfig.widgets as any}
          toggleWidget={actions.toggleWidget}
          onApplyPreset={actions.applyPreset}
          onResetLayout={actions.resetLayout}
          open={ui.settingsOpen}
          onClose={actions.onCloseSettings}
          tiviParams={meta.tiviSettings}
          onTiviParamsChange={meta.updateTiviSettings}
          tivi={meta.tivi}
          speechProbRef={voice.speechProbRef}
          audioLevelRef={voice.audioLevelRef}
          speechCooldownMs={settings.speechCooldownMs}
          onSpeechCooldownChange={actions.onSpeechCooldownChange}
          playbackRate={settings.playbackRate}
          onPlaybackRateChange={actions.onPlaybackRateChange}
          isListening={voice.isListening}
          designPackId={settings.designPackId}
          onDesignPackChange={actions.onDesignPackChange}
          availableDesignPacks={meta.availableDesignPacks}
          colorMode={settings.colorMode}
          onColorModeToggle={actions.onColorModeToggle}
          activeShell={meta.activeShell}
          onShellChange={meta.onShellChange}
          availableShells={meta.availableShells}
          aiModel={settings.aiModel}
          onModelChange={actions.onModelChange}
        />

        <SessionBrowser
          open={ui.sessionsOpen}
          onClose={actions.onCloseSessions}
          listSessions={actions.listSessions}
          loadSession={actions.loadSession}
        />

        <AccountPanel open={accountOpen} onClose={() => setAccountOpen(false)} />
      </div>
    );
  }

  // ── Voice mode: orb background + content overlay ──
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--sc-background)]" style={{ position: 'fixed', inset: 0, overscrollBehavior: 'none', touchAction: 'manipulation' }}>
      {/* Header — z-30, above everything */}
      <SessionMiniHeader
        title={activeAppName ? `SmartChats.AI › ${activeAppName}` : 'SmartChats.AI'}
        activity={activity}
        credits={auth.totalAvailable}
        authAction={auth.isAuthenticated ? () => setAccountOpen(true) : actions.onLogin}
        authIcon={auth.isAuthenticated ? 'authenticated' : 'unauthenticated'}
        brandElement={orbSize === 'icon' ? <MiniOrb state={state} audioLevelRef={voice.audioLevelRef} /> : undefined}
        onTitleClick={orbSize === 'icon' ? trackedRestoreOrbFull : undefined}
      />

      {/* Orb — absolute background, fades in centered then repositions after activation */}
      <div
        ref={orbRef}
        className="pointer-events-none absolute inset-x-0 flex items-center justify-center"
        style={{
          top: hasActivated ? 48 : '50%',
          transform: hasActivated ? 'none' : 'translateY(-50%)',
          height: hasActivated ? `${orbZoneHeight}dvh` : 'auto',
          opacity: orbSize === 'icon' ? 0 : hasActivated ? Math.max(0.3, 1 - expandProgress * 0.5) : 0.85,
          filter: orbBlur > 0 ? `blur(${orbBlur}px)` : 'none',
          zIndex: 5,
          pointerEvents: orbSize === 'icon' ? 'none' : undefined,
          transition: orbBlur > 0
            ? 'filter 150ms ease, opacity 150ms ease'
            : 'top 600ms ease-out, transform 600ms ease-out, height 400ms ease, opacity 400ms ease, filter 300ms ease',
          animation: !hasActivated ? 'fab-fade-in 1s ease-out' : undefined,
        }}
      >
        <div
          className="pointer-events-auto"
          onClick={hasActivated && voice.started ? trackedCycleOrbSize : undefined}
          role={hasActivated && voice.started ? 'button' : undefined}
          aria-label={hasActivated && voice.started ? 'Resize orb' : undefined}
          style={{
            cursor: hasActivated && voice.started ? 'pointer' : undefined,
            transform: `scale(${orbScale})`,
            transformOrigin: 'center center',
            transition: 'transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          <EventPulseRing pulseFnRef={pulseFnRef}>
            <VoiceStage
              state={orbState}
              level={level}
              variant="orb"
              audioLevelRef={voice.audioLevelRef}
              onActivate={showWelcome ? trackedOrbLogin : trackedOrbStartStop}
            />
          </EventPulseRing>
        </div>
      </div>

      {/* Status label — overlays bottom of orb zone (only full size) */}
      {hasActivated && orbSize === 'full' && (
        <div
          className="pointer-events-none absolute inset-x-0 flex items-end justify-center"
          style={{ top: 42, height: '35dvh', zIndex: 15 }}
        >
          <span className="text-[0.6875rem] italic text-sc-text-muted">
            {state === 'idle' ? 'Ready' : state === 'loading' ? 'Loading...' : state === 'listening' ? 'Listening...' : state === 'processing' ? 'Thinking...' : state === 'speaking' ? 'Speaking — interrupt anytime' : ''}
          </span>
        </div>
      )}

      {/* Welcome prompt — shown below centered orb when not authenticated and not yet activated */}
      {!hasActivated && !auth.isAuthenticated && (
        <div
          className="pointer-events-auto absolute inset-x-0 flex flex-col items-center gap-4"
          style={{ top: 'calc(50% + 170px)', zIndex: 25, animation: 'fab-fade-in 1.2s ease-out' }}
        >
          <p className="max-w-[26ch] text-center text-[0.9rem] leading-relaxed text-sc-text-muted">
            Sign in to experience the future
          </p>
          <button
            onClick={trackedWelcomeLogin}
            className="rounded-full px-6 py-2.5 text-sm font-medium text-white shadow-sc-md transition-all duration-200 active:scale-95"
            style={{
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--sc-primary) 90%, white 10%), var(--sc-primary))',
            }}
          >
            Sign in
          </button>
        </div>
      )}

      {/* Edge rail — thinking/response moments only */}
      {hasActivated && <EdgeRail moments={edgeMoments} />}

      {/* Content zone — starts at 35dvh, overlaps orb, scrollable. Expands upward on scroll when viz active. */}
      <main
        ref={mainRef}
        className={`flex flex-col px-4 pb-4 pt-7 ${activeAppId ? 'flex-1 overflow-hidden' : 'flex-1 overflow-y-auto'}`}
        style={{
          marginTop: hasActivated ? expandedMargin : '70dvh',
          zIndex: 20,
          position: 'relative',
          transition: hasContent ? 'margin-top 150ms ease' : 'margin-top 400ms ease',
          ...(activeAppId ? {} : {
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 28px)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 28px)',
          }),
        }}
      >
        {activeAppId && activeAppSandbox ? (
          /* App mode — app fills remaining vertical space */
          <AppContainer sandbox={activeAppSandbox} />
        ) : (
          <div className="mx-auto flex w-full max-w-[28rem] flex-col gap-3">
            {isWorking ? (
              /* Phase 2 — Working: inline action/process moments take over */
              <InlineMomentStream moments={inlineMoments} />
            ) : (
              /* Transcript always visible; assistant response hidden when viz/html active (unless guided mode) */
              <>
                <TranscriptLine text={state === 'listening' ? voice.interimResult : ''} variant="interim" />
                <TranscriptLine text={state !== 'listening' ? lastUserMessage : ''} variant="final" />
                {(!hasContent || shellMode === 'guided') && !momentDismissed && (
                  <AssistantMoment text={assistantText} onDismiss={() => setMomentDismissed(true)} />
                )}
              </>
            )}

            {/* Visualization stack — up to 3, scrollable, FIFO */}
            <VizStack vizContext={{ tivi: meta.tivi, tiviSettings: meta.tiviSettings, updateTiviSettings: meta.updateTiviSettings }} />

            {/* HTML display — renders below text when active */}
            {widgetProps.activeHtml && (
              <HTMLViewer
                htmlDisplay={widgetProps.activeHtml}
                onDismiss={widgetProps.clearHtml}
              />
            )}
          </div>
        )}
      </main>

      {/* Floating action menu — bottom right */}
      <FloatingActionMenu
        isSpeaking={state === 'speaking'}
        canStop={canInterrupt}
        onInterrupt={actions.onCancelSpeech}
        onStop={handleStop}
        onKeyboard={handleToggleChatMode}
        onSettings={actions.onOpenSettings}
      />

      <SettingsPanel
        variant="fullscreen"
        widgets={widgetConfig.widgets as any}
        toggleWidget={actions.toggleWidget}
        onApplyPreset={actions.applyPreset}
        onResetLayout={actions.resetLayout}
        open={ui.settingsOpen}
        onClose={actions.onCloseSettings}
        tiviParams={meta.tiviSettings}
        onTiviParamsChange={meta.updateTiviSettings}
        tivi={meta.tivi}
        speechProbRef={voice.speechProbRef}
        audioLevelRef={voice.audioLevelRef}
        speechCooldownMs={settings.speechCooldownMs}
        onSpeechCooldownChange={actions.onSpeechCooldownChange}
        playbackRate={settings.playbackRate}
        onPlaybackRateChange={actions.onPlaybackRateChange}
        isListening={voice.isListening}
        designPackId={settings.designPackId}
        onDesignPackChange={actions.onDesignPackChange}
        availableDesignPacks={meta.availableDesignPacks}
        colorMode={settings.colorMode}
        onColorModeToggle={actions.onColorModeToggle}
        activeShell={meta.activeShell}
        onShellChange={meta.onShellChange}
        availableShells={meta.availableShells}
        aiModel={settings.aiModel}
        onModelChange={actions.onModelChange}
      />

      <SessionBrowser
        open={ui.sessionsOpen}
        onClose={actions.onCloseSessions}
        listSessions={actions.listSessions}
        loadSession={actions.loadSession}
      />

      <AccountPanel open={accountOpen} onClose={() => setAccountOpen(false)} />

      <TourOverlay />

    </div>
  );
}

function VizStack({ vizContext }: { vizContext?: import('../visualizations').VizContext }) {
  const vizStack = useSmartChatsStore(s => s.vizStack);
  const dismissViz = useSmartChatsStore(s => s.dismissViz);
  if (vizStack.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {[...vizStack].reverse().map(v => (
        <VisualizationRenderer
          key={v._ts}
          viz={v as Visualization}
          onDismiss={() => dismissViz(v._ts)}
          context={vizContext}
        />
      ))}
    </div>
  );
}
