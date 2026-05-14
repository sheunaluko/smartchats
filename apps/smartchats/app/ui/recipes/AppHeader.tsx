'use client';

import React, { useRef, useEffect } from 'react';
import Link from 'next/link';
import type { AuthUser } from 'smartchats-backend';
import { Pause, Play, Save, History, Settings, Square, UserCheck, User as UserIcon } from 'lucide-react';
import AudioVisualization from '../../components/AudioVisualization';
import { Tooltip } from '../Tooltip';
import { Select } from '../Select';

import { Chip } from '../Chip';
import { ControlGroup } from './ControlGroup';
import { ToolbarButton } from './ToolbarButton';
import { useSmartChatsStore } from '../../store/useSmartChatsStore';
import { MODEL_REGISTRY } from 'cortex';


type AppHeaderProps = {
  started: boolean;
  onStartStop: () => void;
  transcribe: boolean;
  onTranscribeToggle: () => void;
  isSpeaking: boolean;
  onCancelSpeech: () => void;
  aiModel: string;
  onModelChange: (model: string) => void;
  onOpenSettings: () => void;
  onSaveSession: () => void;
  onOpenSessions: () => void;
  audioLevelRef: React.MutableRefObject<number>;
  voiceStatus: 'idle' | 'listening' | 'processing' | 'speaking';
  interimResult?: string;
  contextUsage?: {
    usagePercent: number;
    totalUsed: number;
    contextWindow: number;
  } | null;
  conversationStarted?: boolean;
  user?: AuthUser | null;
  totalAvailable?: number;
  creditsLoading?: boolean;
  onLogin?: () => void;
  onAccount?: () => void;
  compact?: boolean;
  extraActions?: React.ReactNode;
  /** Ref updated with raw stream text — rendered as cybernetic underline under the title without triggering re-renders */
  streamTextRef?: React.MutableRefObject<string>;
};

function getVoiceStatusLabel(status: AppHeaderProps['voiceStatus'], initLoading?: boolean) {
  if (initLoading && status === 'listening') return 'Loading';
  switch (status) {
    case 'listening': return 'Listening';
    case 'processing': return 'Thinking';
    case 'speaking': return 'Speaking';
    default: return 'Ready';
  }
}

export function AppHeader({
  started,
  onStartStop,
  transcribe,
  onTranscribeToggle,
  isSpeaking,
  onCancelSpeech,
  aiModel,
  onModelChange,
  onOpenSettings,
  onSaveSession,
  onOpenSessions,
  audioLevelRef,
  voiceStatus,
  interimResult,
  contextUsage,
  conversationStarted = false,
  user,
  /** When `undefined`, the credits chip is hidden entirely — used for backends without billing. */
  totalAvailable,
  creditsLoading = false,
  onLogin,
  onAccount,
  compact = false,
  extraActions,
  streamTextRef,
}: AppHeaderProps) {
  const initLoading = useSmartChatsStore(s => s.initLoading);
  const statusTone = initLoading ? 'text-sc-warning' : voiceStatus === 'listening'
    ? 'text-sc-success'
    : voiceStatus === 'processing'
      ? 'text-sc-warning'
      : voiceStatus === 'speaking'
        ? 'text-sc-primary'
        : 'text-sc-text-muted';

  // Scroll-hints: detect if the appbar content overflows and show left/right arrows
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollHintRef = useRef<HTMLDivElement>(null);
  const scrollHintLeftRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollContainerRef.current;
    const hintRight = scrollHintRef.current;
    const hintLeft = scrollHintLeftRef.current;
    if (!el || !hintRight || !hintLeft) return;
    const check = () => {
      const canScroll = el.scrollWidth > el.clientWidth + 2;
      const atStart = el.scrollLeft <= 2;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      hintRight.style.opacity = canScroll && !atEnd ? '1' : '0';
      hintLeft.style.opacity = canScroll && !atStart ? '1' : '0';
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', check); ro.disconnect(); };
  }, []);

  // Scroll-on-hover: smoothly scroll while hovering a scroll hint
  const scrollRafRef = useRef<number>(0);
  const startScrollRight = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const step = () => {
      el.scrollLeft += 3;
      scrollRafRef.current = requestAnimationFrame(step);
    };
    scrollRafRef.current = requestAnimationFrame(step);
  };
  const startScrollLeft = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const step = () => {
      el.scrollLeft -= 3;
      scrollRafRef.current = requestAnimationFrame(step);
    };
    scrollRafRef.current = requestAnimationFrame(step);
  };
  const stopScrollOnHover = () => {
    cancelAnimationFrame(scrollRafRef.current);
  };

  // Cybernetic stream underline — reads ref, writes DOM directly (no re-renders)
  const streamElRef = useRef<HTMLDivElement>(null);
  const prevTextRef = useRef('');
  useEffect(() => {
    if (!streamTextRef) return;
    let raf: number;
    const tick = () => {
      const el = streamElRef.current;
      if (el && streamTextRef.current !== prevTextRef.current) {
        // Take last ~40 chars of accumulated stream text
        const raw = streamTextRef.current;
        const tail = raw.length > 40 ? raw.slice(-40) : raw;
        el.textContent = tail.replace(/\n/g, ' ');
        el.style.opacity = tail.trim() ? '0.35' : '0';
        prevTextRef.current = streamTextRef.current;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [streamTextRef]);

  return (
    <header className="sticky top-0 z-30">
      <div className="mx-auto max-w-[1100px] px-3 py-2 pr-[calc(0.75rem+12px)] lg:px-4 lg:pr-[calc(1rem+12px)]">
        <div ref={scrollContainerRef} className={`relative flex items-center gap-3 overflow-x-auto rounded-2xl border border-white/[0.06] bg-white/[0.015] px-4 shadow-[0_4px_20px_rgba(0,0,0,0.15),inset_0_0.5px_0_rgba(255,255,255,0.12)] backdrop-blur-sm backdrop-saturate-[1.4] ${compact ? 'py-2' : 'py-2.5'}`} style={{ scrollbarWidth: 'none' }}>
          {/* Scroll hint left — sticky arrow inside the bar */}
          <div
            ref={scrollHintLeftRef}
            onMouseEnter={startScrollLeft}
            onMouseLeave={stopScrollOnHover}
            className="sticky left-0 flex shrink-0 self-start items-center pr-3 mt-[20px] cursor-pointer"
            style={{
              opacity: 0,
              transition: 'opacity 200ms ease',
              marginLeft: '-0.75rem',
              background: 'linear-gradient(to left, transparent, color-mix(in srgb, var(--sc-surface) 90%, transparent) 40%)',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" className="text-sc-text-muted animate-pulse">
              <path d="M7 1 L3 5 L7 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* 1. SMARTCHATS title */}
          <div className="shrink-0">
            <div className={`${compact ? 'text-sm' : 'text-[1rem]'} font-semibold tracking-[0.13em] text-sc-text`}>
              SMARTCHATS
            </div>
            <div
              ref={streamElRef}
              className="max-w-[7.5rem] truncate font-mono text-[0.45rem] leading-none text-sc-primary tracking-wider"
              style={{ opacity: 0, transition: 'opacity 0.3s' }}
            />
          </div>

          {/* 2. Start/Stop + cancel */}
          <div className="flex shrink-0 items-center gap-2">
            <ToolbarButton
              variant={started ? 'danger' : 'primary'}
              onClick={onStartStop}
              className="min-w-[5.5rem]"
              data-tour="start-stop"
            >
              {started ? <Square size={15} /> : <Play size={15} />}
              <span>{started ? 'Stop' : 'Start'}</span>
            </ToolbarButton>

            {isSpeaking && (
              <Tooltip content="Stop voice playback">
                <ToolbarButton variant="danger" onClick={onCancelSpeech} aria-label="Stop speaking">
                  <Pause size={15} />
                </ToolbarButton>
              </Tooltip>
            )}
          </div>

          {/* 3. Status / transcription */}
          <div className="flex shrink-0 min-w-[14rem] items-center gap-3">
            <div className="w-20 shrink-0">
              <AudioVisualization
                audioLevelRef={audioLevelRef}
                paused={!started}
                width={80}
                height={24}
                backgroundColor="transparent"
              />
            </div>
            <span className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${initLoading ? 'bg-sc-warning' : voiceStatus === 'idle' ? 'bg-sc-text-muted/55' : voiceStatus === 'listening' ? 'bg-sc-success' : voiceStatus === 'processing' ? 'bg-sc-warning' : 'bg-sc-primary'}`} />
            <div className="min-w-0 flex-1">
              <div className={`text-[0.68rem] font-semibold uppercase tracking-[0.14em] ${statusTone}`}>
                {getVoiceStatusLabel(voiceStatus, initLoading)}
              </div>
              <div className="truncate text-[0.85rem] text-sc-text-muted">
                {interimResult
                  ? (interimResult.length > 60 ? '…' + interimResult.slice(-60) : interimResult)
                  : initLoading ? 'Initializing...' : 'Ready.'}
              </div>
            </div>
          </div>

          {/* 4. Context usage — hidden below xl */}
          <div className="flex shrink-0 items-center">
            {contextUsage && (
              <Tooltip content={`${contextUsage.totalUsed.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()} tokens`}>
                <Chip
                  label={`${contextUsage.usagePercent.toFixed(0)}% context`}
                  size="sm"
                  variant={contextUsage.usagePercent >= 80 ? 'warning' : 'default'}
                  className="shrink-0"
                />
              </Tooltip>
            )}
          </div>

          {/* 5. Model selector */}
          <div className="w-[10rem] shrink-0">
            <Select
              value={aiModel}
              onChange={onModelChange}
              disabled={started || conversationStarted}
              size="sm"
              options={Object.entries(MODEL_REGISTRY).map(([key, info]) => ({
                value: key,
                label: key,
              }))}
              aria-label="AI model"
              className="w-full"
            />
          </div>

          {/* 6. Credits — hidden entirely when the backend has no billing capability. */}
          <div className="shrink-0">
            {user && totalAvailable !== undefined ? (
              onAccount ? (
                <button onClick={onAccount} className="no-underline bg-transparent border-none p-0 cursor-pointer">
                  {creditsLoading ? (
                    <div className="rounded-full border border-[var(--sc-separator)] bg-[var(--sc-surface-tertiary)] px-3 py-1.5 text-xs text-sc-text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                      Loading…
                    </div>
                  ) : (
                    <Chip
                      label={`${totalAvailable.toLocaleString()} credits`}
                      size="sm"
                      variant={totalAvailable < 100 ? 'danger' : 'default'}
                      className="cursor-pointer border border-[var(--sc-separator)] bg-[var(--sc-surface-tertiary)] px-3 py-1.5 text-sc-text shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                    />
                  )}
                </button>
              ) : (
                <Link href="/settings/billing" className="no-underline">
                  {creditsLoading ? (
                    <div className="rounded-full border border-[var(--sc-separator)] bg-[var(--sc-surface-tertiary)] px-3 py-1.5 text-xs text-sc-text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                      Loading…
                    </div>
                  ) : (
                    <Chip
                      label={`${totalAvailable.toLocaleString()} credits`}
                      size="sm"
                      variant={totalAvailable < 100 ? 'danger' : 'default'}
                      className="cursor-pointer border border-[var(--sc-separator)] bg-[var(--sc-surface-tertiary)] px-3 py-1.5 text-sc-text shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                    />
                  )}
                </Link>
              )
            ) : !user ? (
              <ToolbarButton variant="primary" onClick={onLogin}>
                Log In
              </ToolbarButton>
            ) : null}
          </div>

          {/* 7. Control buttons */}
          <ControlGroup>
            {onAccount && (
              <Tooltip content="Account">
                <ToolbarButton onClick={onAccount} aria-label="Account" data-tour="account">
                  {user ? <UserCheck size={15} /> : <UserIcon size={15} />}
                </ToolbarButton>
              </Tooltip>
            )}
            <Tooltip content="Browse saved sessions">
              <ToolbarButton onClick={onOpenSessions} aria-label="Browse saved sessions" data-tour="load-sessions">
                <History size={15} />
              </ToolbarButton>
            </Tooltip>
            <Tooltip content="Open settings">
              <ToolbarButton onClick={onOpenSettings} aria-label="Open settings" data-tour="settings">
                <Settings size={15} />
              </ToolbarButton>
            </Tooltip>
            {extraActions}
          </ControlGroup>

          {/* Scroll hint — sticky arrow inside the bar */}
          <div
            ref={scrollHintRef}
            onMouseEnter={startScrollRight}
            onMouseLeave={stopScrollOnHover}
            className="sticky right-0 flex shrink-0 self-start items-center pl-3 mt-[20px] cursor-pointer"
            style={{
              opacity: 0,
              transition: 'opacity 200ms ease',
              marginRight: '-0.75rem',
              background: 'linear-gradient(to right, transparent, color-mix(in srgb, var(--sc-surface) 90%, transparent) 40%)',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" className="text-sc-text-muted animate-pulse">
              <path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>
    </header>
  );
}
