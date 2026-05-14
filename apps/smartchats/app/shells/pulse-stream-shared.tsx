'use client';

/**
 * Shared pulse-stream infrastructure for ClaudeMobileShellV1–V4.
 * Types, constants, hooks, and reusable sub-components.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { ShellProps } from '../../core/types/shell';
import type { MobileVoiceState } from '../types/mobileVoice';
import {
  Brain, Volume2, Play, CheckCircle2, XCircle, Wrench,
  Terminal, Gauge, Loader2,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export type MomentStatus = 'running' | 'success' | 'error';
export type MomentPhase = 'active' | 'compact' | 'exiting';
export type MomentKind = 'thinking' | 'response' | 'action' | 'process' | 'info';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IconComponent = React.ComponentType<any>;

export type StreamMoment = {
  id: string;
  kind: MomentKind;
  title: string;
  icon: IconComponent;
  status?: MomentStatus;
  meta?: string;
  phase: MomentPhase;
  createdAt: number;
  updatedAt: number;
};

export type PulseCategory = 'thinking' | 'responding' | 'executing' | 'tools' | 'process';

export type ActivityMetrics = {
  contextPercent: number;
  latencyStartRef: React.MutableRefObject<number>;
  loopCount: number;
  isActive: boolean;
};

// ── Constants ──────────────────────────────────────────────────────────────────

export const PULSE_POSITIONS: Record<PulseCategory, { top?: string; left?: string; right?: string; bottom?: string; transform: string }> = {
  thinking:   { top: '0', left: '50%', transform: 'translate(-50%, -50%)' },
  responding: { top: '50%', right: '0', transform: 'translate(50%, -50%)' },
  executing:  { bottom: '0', left: '50%', transform: 'translate(-50%, 50%)' },
  tools:      { top: '50%', left: '0', transform: 'translate(-50%, -50%)' },
  process:    { top: '20%', left: '3%', transform: 'translate(-50%, -50%)' },
};

export const PULSE_COLORS: Record<PulseCategory, string> = {
  thinking:   'var(--sc-warning, #f59e0b)',
  responding: 'var(--sc-primary, #3b82f6)',
  executing:  'var(--sc-success, #22c55e)',
  tools:      'var(--sc-accent, #a855f7)',
  process:    'var(--sc-text-muted, #6b7280)',
};

export const CATEGORIES: PulseCategory[] = ['thinking', 'responding', 'executing', 'tools', 'process'];

export const MAX_MOMENTS = 8;
export const ACTIVE_DURATION_MS = 5000;
export const COMPACT_DURATION_MS = 15000;
export const PULSE_DECAY_MS = 600;

// ── Keyframes ──────────────────────────────────────────────────────────────────

const KEYFRAMES_ID = 'sc-pulse-stream-keyframes';
const KEYFRAMES_CSS = `
@keyframes sc-slide-in-up {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes sc-slide-in-left {
  from { transform: translateX(-20px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes sc-slide-in-right {
  from { transform: translateX(20px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes sc-fade-out {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(8px); opacity: 0; }
}
@keyframes sc-fade-out-left {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(-12px); opacity: 0; }
}
@keyframes sc-radiate-out {
  0% { transform: translate(var(--radiate-x, 0), var(--radiate-y, 0)) scale(0.6); opacity: 0; }
  15% { transform: translate(var(--radiate-x, 0), var(--radiate-y, 0)) scale(1); opacity: 1; }
  100% { transform: translate(var(--radiate-x, 0), var(--radiate-y, 0)) scale(0.85); opacity: 0; }
}
@keyframes sc-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

export function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = KEYFRAMES_CSS;
  document.head.appendChild(style);
}

// ── deriveState ────────────────────────────────────────────────────────────────

export function deriveState(args: {
  started: boolean;
  voiceStatus: 'idle' | 'listening' | 'processing' | 'speaking';
  executionError?: string;
  initLoading?: boolean;
}): MobileVoiceState {
  if (args.executionError) return 'error';
  if (!args.started && args.voiceStatus === 'idle') return 'idle';
  if (args.initLoading && args.voiceStatus === 'listening') return 'loading';
  if (args.voiceStatus === 'listening') return 'listening';
  if (args.voiceStatus === 'processing') return 'processing';
  if (args.voiceStatus === 'speaking') return 'speaking';
  return 'ready';
}

// ── useMomentStream ────────────────────────────────────────────────────────────

export function useMomentStream(
  widgetProps: ShellProps['widgetProps'],
  voice: ShellProps['voice'],
  settings: ShellProps['settings'],
) {
  const [moments, setMoments] = useState<StreamMoment[]>([]);
  const prevRef = useRef({
    thoughtLen: 0,
    chatLen: 0,
    executionStatus: 'idle' as string,
    executionId: '',
    fnCallLen: 0,
    processLen: 0,
    contextPercent: 0,
    fnCallStatuses: [] as string[],
    processStatuses: [] as string[],
    voiceStatus: 'idle' as string,
  });

  const pulseFnRef = useRef<((category: PulseCategory) => void) | null>(null);
  const latencyStartRef = useRef(0);
  const loopCountRef = useRef(0);

  const pushMoment = useCallback((m: Omit<StreamMoment, 'phase' | 'createdAt' | 'updatedAt'>) => {
    const now = Date.now();
    setMoments(prev => {
      const idx = prev.findIndex(x => x.id === m.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...m, updatedAt: now };
        return updated;
      }
      const entry: StreamMoment = { ...m, phase: 'active', createdAt: now, updatedAt: now };
      const next = [...prev, entry];
      if (next.length > MAX_MOMENTS) {
        const compactIdx = next.findIndex(x => x.phase === 'compact');
        if (compactIdx >= 0) next.splice(compactIdx, 1);
        else next.shift();
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const prev = prevRef.current;
    const now = Date.now();

    if (widgetProps.thoughtHistory.length > prev.thoughtLen) {
      const latest = widgetProps.thoughtHistory[widgetProps.thoughtHistory.length - 1];
      pushMoment({ id: 'thinking-latest', kind: 'thinking', title: (latest || '').slice(0, 80), icon: Brain });
      pulseFnRef.current?.('thinking');
    }

    if (widgetProps.chatHistory.length > prev.chatLen) {
      const latest = widgetProps.chatHistory[widgetProps.chatHistory.length - 1];
      if (latest?.role === 'assistant') {
        pushMoment({
          id: `response-${widgetProps.chatHistory.length}`,
          kind: 'response',
          title: (latest.content || '').slice(0, 80),
          icon: Volume2,
        });
        pulseFnRef.current?.('responding');
      }
    }

    // Track voice processing latency
    if (voice.voiceStatus !== prev.voiceStatus) {
      if (voice.voiceStatus === 'processing') {
        latencyStartRef.current = now;
      } else if (prev.voiceStatus === 'processing') {
        latencyStartRef.current = 0;
      }
    }

    if (widgetProps.executionStatus !== prev.executionStatus || widgetProps.executionId !== prev.executionId) {
      const execId = `exec-${widgetProps.executionId || 'current'}`;
      if (widgetProps.executionStatus === 'running') {
        latencyStartRef.current = now;
        loopCountRef.current++;
        pushMoment({ id: execId, kind: 'action', title: 'Running code', icon: Play, status: 'running' });
        pulseFnRef.current?.('executing');
      } else if (widgetProps.executionStatus === 'success') {
        latencyStartRef.current = 0;
        pushMoment({
          id: execId, kind: 'action', title: 'Code executed', icon: CheckCircle2, status: 'success',
          meta: widgetProps.executionDuration ? `${widgetProps.executionDuration}ms` : undefined,
        });
        pulseFnRef.current?.('executing');
      } else if (widgetProps.executionStatus === 'error') {
        latencyStartRef.current = 0;
        pushMoment({
          id: execId, kind: 'action', title: 'Execution failed', icon: XCircle, status: 'error',
          meta: widgetProps.executionError || undefined,
        });
        pulseFnRef.current?.('executing');
      }
    }

    if (widgetProps.functionCalls.length > prev.fnCallLen) {
      for (let i = prev.fnCallLen; i < widgetProps.functionCalls.length; i++) {
        const fc = widgetProps.functionCalls[i];
        pushMoment({ id: `fn-${fc.callId || i}`, kind: 'action', title: `Using ${fc.name}`, icon: Wrench, status: 'running' });
        pulseFnRef.current?.('tools');
      }
    }
    for (let i = 0; i < widgetProps.functionCalls.length; i++) {
      const fc = widgetProps.functionCalls[i];
      if (fc.status && fc.status !== prev.fnCallStatuses[i]) {
        pushMoment({
          id: `fn-${fc.callId || i}`, kind: 'action', title: `Using ${fc.name}`,
          icon: fc.status === 'error' ? XCircle : fc.status === 'success' ? CheckCircle2 : Wrench,
          status: fc.status as MomentStatus,
          meta: fc.duration ? `${fc.duration}ms` : undefined,
        });
      }
    }

    if (widgetProps.processes.length > prev.processLen) {
      for (let i = prev.processLen; i < widgetProps.processes.length; i++) {
        const proc = widgetProps.processes[i];
        pushMoment({ id: `proc-${proc.id}`, kind: 'process', title: `${proc.name} started`, icon: Terminal, status: 'running' });
        pulseFnRef.current?.('process');
      }
    }
    for (let i = 0; i < widgetProps.processes.length; i++) {
      const proc = widgetProps.processes[i];
      if (proc.status && proc.status !== prev.processStatuses[i]) {
        const s: MomentStatus = proc.exitCode === 0 ? 'success' : proc.exitCode != null ? 'error' : 'running';
        pushMoment({
          id: `proc-${proc.id}`, kind: 'process',
          title: s === 'running' ? `${proc.name} running` : `${proc.name} ${s}`,
          icon: Terminal, status: s,
          meta: proc.elapsed ? `${proc.elapsed}ms` : undefined,
        });
        if (s !== 'running') pulseFnRef.current?.('process');
      }
    }

    const ctxPct = settings.contextUsage?.usagePercent || 0;
    if (ctxPct > 80 && Math.abs(ctxPct - prev.contextPercent) >= 5) {
      pushMoment({ id: 'context-usage', kind: 'info', title: `Context ${Math.round(ctxPct)}%`, icon: Gauge });
    }

    prevRef.current = {
      thoughtLen: widgetProps.thoughtHistory.length,
      chatLen: widgetProps.chatHistory.length,
      executionStatus: widgetProps.executionStatus,
      executionId: widgetProps.executionId,
      fnCallLen: widgetProps.functionCalls.length,
      processLen: widgetProps.processes.length,
      contextPercent: ctxPct,
      fnCallStatuses: widgetProps.functionCalls.map((fc: any) => fc.status || ''),
      processStatuses: widgetProps.processes.map((p: any) => p.status || ''),
      voiceStatus: voice.voiceStatus,
    };
  }, [
    widgetProps.thoughtHistory, widgetProps.chatHistory,
    widgetProps.executionStatus, widgetProps.executionId, widgetProps.executionDuration,
    widgetProps.executionError, widgetProps.functionCalls, widgetProps.processes,
    settings.contextUsage, pushMoment,
  ]);

  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      setMoments(prev => {
        let changed = false;
        const next = prev.reduce<StreamMoment[]>((acc, m) => {
          const age = now - m.createdAt;
          if (m.status === 'running') { acc.push(m); return acc; }
          if (m.phase === 'active' && age > ACTIVE_DURATION_MS) {
            changed = true;
            acc.push({ ...m, phase: 'compact' });
          } else if (m.phase === 'compact' && age > COMPACT_DURATION_MS) {
            changed = true;
            acc.push({ ...m, phase: 'exiting' });
          } else if (m.phase === 'exiting' && age > COMPACT_DURATION_MS + 400) {
            changed = true;
          } else {
            acc.push(m);
          }
          return acc;
        }, []);
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const activity: ActivityMetrics = {
    contextPercent: settings.contextUsage?.usagePercent || 0,
    latencyStartRef,
    loopCount: loopCountRef.current,
    isActive: voice.voiceStatus === 'processing' || widgetProps.executionStatus === 'running',
  };

  return { moments, pulseFnRef, activity };
}

// ── EventPulseRing ─────────────────────────────────────────────────────────────

export function EventPulseRing({
  children,
  pulseFnRef,
}: {
  children: React.ReactNode;
  pulseFnRef: React.MutableRefObject<((category: PulseCategory) => void) | null>;
}) {
  const dotRefs = useRef<Record<PulseCategory, HTMLDivElement | null>>({
    thinking: null, responding: null, executing: null, tools: null, process: null,
  });
  const pulseTs = useRef<Record<PulseCategory, number>>({
    thinking: 0, responding: 0, executing: 0, tools: 0, process: 0,
  });
  const rafId = useRef(0);

  useEffect(() => {
    pulseFnRef.current = (cat: PulseCategory) => {
      pulseTs.current[cat] = performance.now();
    };
    return () => { pulseFnRef.current = null; };
  }, [pulseFnRef]);

  useEffect(() => {
    function tick() {
      const now = performance.now();
      for (const cat of CATEGORIES) {
        const el = dotRefs.current[cat];
        if (!el) continue;
        const elapsed = now - pulseTs.current[cat];
        if (elapsed < PULSE_DECAY_MS && pulseTs.current[cat] > 0) {
          const t = elapsed / PULSE_DECAY_MS;
          const scale = 1 + 0.4 * (1 - t);
          const opacity = 0.15 + 0.85 * (1 - t);
          el.style.transform = `${el.dataset.bt} scale(${scale})`;
          el.style.opacity = String(opacity);
        } else {
          el.style.transform = `${el.dataset.bt} scale(1)`;
          el.style.opacity = '0.15';
        }
      }
      rafId.current = requestAnimationFrame(tick);
    }
    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  return (
    <div style={{ position: 'relative', display: 'inline-flex', justifyContent: 'center' }}>
      {children}
      {CATEGORIES.map(cat => {
        const pos = PULSE_POSITIONS[cat];
        return (
          <div
            key={cat}
            ref={el => { dotRefs.current[cat] = el; }}
            data-bt={pos.transform}
            style={{
              position: 'absolute',
              width: 6, height: 6, borderRadius: '50%',
              backgroundColor: PULSE_COLORS[cat],
              opacity: 0.15,
              top: pos.top, left: pos.left, right: pos.right, bottom: pos.bottom,
              transform: `${pos.transform} scale(1)`,
              pointerEvents: 'none',
              willChange: 'transform, opacity',
            }}
          />
        );
      })}
    </div>
  );
}

// ── MomentCard (standard vertical) ────────────────────────────────────────────

export function MomentCard({ moment }: { moment: StreamMoment }) {
  const Icon = moment.icon;

  if (moment.phase === 'exiting') {
    return (
      <div style={{ animation: 'sc-fade-out 400ms ease-out forwards' }}>
        <CompactPill icon={Icon} title={moment.title} />
      </div>
    );
  }

  if (moment.phase === 'compact') {
    return <CompactPill icon={Icon} title={moment.title} />;
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 12px', borderRadius: 12,
        backgroundColor: 'var(--sc-surface, rgba(255,255,255,0.06))',
        animation: 'sc-slide-in-up 300ms ease-out',
      }}
    >
      <div style={{ flexShrink: 0, marginTop: 2 }}>
        <StatusIcon status={moment.status} fallback={Icon} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--sc-text)', lineHeight: '1.3' }}>
          {moment.title}
        </div>
        {moment.meta && (
          <div style={{ fontSize: 11, color: 'var(--sc-text-muted)', marginTop: 2 }}>
            {moment.meta}
          </div>
        )}
      </div>
    </div>
  );
}

export function CompactPill({ icon: Icon, title }: { icon: IconComponent; title: string }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        height: 28, padding: '0 10px', borderRadius: 14,
        backgroundColor: 'var(--sc-surface, rgba(255,255,255,0.06))',
        transition: 'height 300ms ease, opacity 300ms ease',
        overflow: 'hidden',
      }}
    >
      <Icon size={12} style={{ color: 'var(--sc-text-muted)' }} />
      <span style={{
        fontSize: 11, color: 'var(--sc-text-muted)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180,
      }}>
        {title}
      </span>
    </div>
  );
}

export function StatusIcon({ status, fallback: Fallback, size = 16 }: { status?: MomentStatus; fallback: IconComponent; size?: number }) {
  if (status === 'running') return <Loader2 size={size} style={{ color: 'var(--sc-text-muted)', animation: 'sc-spin 1s linear infinite' }} />;
  if (status === 'success') return <CheckCircle2 size={size} style={{ color: 'var(--sc-success, #22c55e)' }} />;
  if (status === 'error') return <XCircle size={size} style={{ color: 'var(--sc-danger, #ef4444)' }} />;
  return <Fallback size={size} style={{ color: 'var(--sc-text-muted)' }} />;
}

// ── MomentStream (standard vertical list) ──────────────────────────────────────

export function MomentStream({ moments }: { moments: StreamMoment[] }) {
  if (moments.length === 0) return null;
  const visible = moments.slice(-5);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {visible.map(m => <MomentCard key={m.id} moment={m} />)}
    </div>
  );
}

// ── ActivityBand ───────────────────────────────────────────────────────────────

export function ActivityBand({ activity }: { activity: ActivityMetrics }) {
  const timerRef = useRef<HTMLSpanElement>(null);
  const rafId = useRef(0);

  useEffect(() => {
    function tick() {
      if (timerRef.current) {
        if (activity.isActive && activity.latencyStartRef.current > 0) {
          const elapsed = Date.now() - activity.latencyStartRef.current;
          timerRef.current.textContent = `${(elapsed / 1000).toFixed(1)}s`;
        } else {
          timerRef.current.textContent = '--';
        }
      }
      rafId.current = requestAnimationFrame(tick);
    }
    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, [activity.isActive, activity.latencyStartRef]);

  const contextColor = activity.contextPercent > 90
    ? 'var(--sc-danger, #ef4444)'
    : activity.contextPercent > 70
      ? 'var(--sc-warning, #f59e0b)'
      : 'var(--sc-success, #22c55e)';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
      padding: '4px 12px', fontSize: 11, color: 'var(--sc-text-muted)',
      opacity: activity.isActive ? 1 : 0.5,
      transition: 'opacity 300ms ease',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          backgroundColor: contextColor, display: 'inline-block',
        }} />
        Ctx {Math.round(activity.contextPercent)}%
      </span>
      <span>Latency: <span ref={timerRef}>--</span></span>
      {activity.loopCount > 0 && <span>Loop #{activity.loopCount}</span>}
    </div>
  );
}

// ── ShellChrome (shared bottom chrome) ─────────────────────────────────────────

export function ShellChrome({
  canInterrupt, composerOpen, setComposerOpen,
  voice, ui, settings, widgetConfig, actions, meta,
}: {
  canInterrupt: boolean;
  composerOpen: boolean;
  setComposerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  voice: ShellProps['voice'];
  ui: ShellProps['ui'];
  settings: ShellProps['settings'];
  widgetConfig: ShellProps['widgetConfig'];
  actions: ShellProps['actions'];
  meta: ShellProps['meta'];
}) {
  return (
    <>
      <InterruptBar
        visible={canInterrupt}
        onInterrupt={actions.onCancelSpeech}
        onStop={() => { actions.onCancelSpeech(); actions.onStartStop(); }}
      />
      <ActionRail onKeyboard={() => setComposerOpen(v => !v)} />
      <FallbackComposer
        open={composerOpen}
        value={actions.chatInput}
        onChange={actions.setChatInput}
        onSend={actions.handleChatSend}
        onKeyDown={actions.handleChatKeyPress}
      />
      <SettingsPanel
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
      />
      <SessionBrowser
        open={ui.sessionsOpen}
        onClose={actions.onCloseSessions}
        listSessions={actions.listSessions}
        loadSession={actions.loadSession}
      />
    </>
  );
}

// Re-export recipe components used by ShellChrome (imported here to keep shells clean)
import { SessionBrowser } from '../components/SessionBrowser';
import { SettingsPanel } from '../components/SettingsPanel';
import {
  ActionRail, FallbackComposer, InterruptBar,
} from '../ui/recipes';
