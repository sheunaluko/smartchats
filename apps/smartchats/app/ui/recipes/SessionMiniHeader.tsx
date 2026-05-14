'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Settings2, User, UserCheck } from 'lucide-react';
import { ToolbarButton } from './ToolbarButton';

/** SmartChats logo — gradient C (primary→accent) + S (text), theme-aware.
 *  S and C alternate spinning: S spins → idle → C spins → idle → repeat (24s cycle). */
function SCLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <linearGradient id="sc-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: 'var(--sc-primary, #22d3ee)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--sc-accent, #6366f1)' }} />
        </linearGradient>
      </defs>
      <style>{`
        @keyframes sc-s-spin {
          0%, 4.17% { transform: rotate(0deg); }
          20.83% { transform: rotate(360deg); }
          20.84%, 100% { transform: rotate(360deg); }
        }
        @keyframes sc-c-spin {
          0%, 20.83% { transform: rotate(0deg); }
          37.5%, 100% { transform: rotate(-360deg); }
        }
      `}</style>
      <circle cx="50" cy="50" r="48" style={{ fill: 'var(--sc-background, #0c1222)' }} />
      <g style={{ transformOrigin: '50px 50px', animation: 'sc-c-spin 24s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}>
        <path
          d="M 72 28 A 31 31 0 1 0 72 72"
          fill="none"
          stroke="url(#sc-logo-grad)"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </g>
      <path
        d="M 60 36 C 52 30, 38 32, 38 40 C 38 48, 62 46, 62 56 C 62 66, 46 68, 38 62"
        fill="none"
        style={{
          stroke: 'var(--sc-text, #ffffff)',
          transformOrigin: '50px 50px',
          animation: 'sc-s-spin 24s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        }}
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

type ActivityInfo = {
  contextPercent: number;
  latencyStartRef: React.MutableRefObject<number>;
  loopCount: number;
  isActive: boolean;
};

type SessionMiniHeaderProps = {
  title?: string;
  /** @deprecated Use authAction instead */
  onSettings?: () => void;
  activity?: ActivityInfo;
  /** Called when the auth indicator is tapped */
  authAction?: () => void;
  /** Which icon to show: authenticated (checkmark user) or unauthenticated (outline user) */
  authIcon?: 'authenticated' | 'unauthenticated';
  /** Custom element to replace the default RadioTower icon (e.g. mini orb) */
  brandElement?: React.ReactNode;
  /** Called when the title or brand icon is tapped */
  onTitleClick?: () => void;
  /** Total available credits for toggle display */
  credits?: number;
};

function CompactActivity({ activity, credits }: { activity: ActivityInfo; credits?: number }) {
  const timerRef = useRef<HTMLSpanElement>(null);
  const rafId = useRef(0);
  const [showCredits, setShowCredits] = useState(false);

  useEffect(() => {
    function tick() {
      if (timerRef.current) {
        if (activity.isActive && activity.latencyStartRef.current > 0) {
          const elapsed = Date.now() - activity.latencyStartRef.current;
          timerRef.current.textContent = `${(elapsed / 1000).toFixed(1)}s`;
        } else {
          timerRef.current.textContent = '';
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

  const formatCredits = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <button
      onClick={() => setShowCredits(v => !v)}
      className="flex items-center gap-1 text-[0.5625rem] text-sc-text-muted transition-opacity duration-300"
      style={{ opacity: activity.isActive || showCredits ? 1 : 0.4 }}
    >
      {showCredits && credits != null ? (
        <>
          <span className="inline-block h-[5px] w-[5px] rounded-full" style={{ backgroundColor: 'var(--sc-primary)' }} />
          <span>{formatCredits(credits)} c</span>
        </>
      ) : (
        <>
          <span className="inline-block h-[5px] w-[5px] rounded-full" style={{ backgroundColor: contextColor }} />
          <span>{Math.round(activity.contextPercent)}%</span>
          <span ref={timerRef} />
        </>
      )}
    </button>
  );
}

export function SessionMiniHeader({
  title = 'SmartChats.AI',
  onSettings,
  activity,
  authAction,
  authIcon,
  brandElement,
  onTitleClick,
  credits,
}: SessionMiniHeaderProps) {
  // Resolve action: prefer authAction, fall back to onSettings
  const handleClick = authAction || onSettings;
  const isAuthed = authIcon === 'authenticated';

  return (
    <header className="px-4 py-3" style={{ position: 'relative', zIndex: 30 }}>
      <style>{`
        @keyframes sc-title-shimmer {
          0%, 58.33% { background-position: -100% 0; color: var(--sc-text); }
          70.83% { background-position: 200% 0; color: transparent; }
          83.33%, 100% { background-position: 200% 0; color: var(--sc-text); }
        }
      `}</style>
      <div className="mx-auto flex max-w-[28rem] items-center justify-between">
        {onTitleClick ? (
          <button onClick={onTitleClick} className="flex min-w-0 items-center gap-2.5 active:opacity-70 transition-opacity" aria-label="Switch to voice mode">
            {brandElement || (
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full">
                <SCLogo size={28} />
              </span>
            )}
            <h1
              className="truncate text-sm font-semibold tracking-[0.01em]"
              style={{
                color: 'var(--sc-text)',
                backgroundImage: 'linear-gradient(90deg, transparent 0%, var(--sc-primary, #22d3ee) 45%, var(--sc-accent, #6366f1) 55%, transparent 100%)',
                backgroundSize: '250% 100%',
                backgroundPosition: '-100% 0',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                animation: 'sc-title-shimmer 12s ease-in-out infinite',
                animationDelay: '6s',
              }}
            >{title}</h1>
          </button>
        ) : (
          <div className="flex min-w-0 items-center gap-2.5">
            {brandElement || (
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full">
                <SCLogo size={28} />
              </span>
            )}
            <h1
              className="truncate text-sm font-semibold tracking-[0.01em]"
              style={{
                color: 'var(--sc-text)',
                backgroundImage: 'linear-gradient(90deg, transparent 0%, var(--sc-primary, #22d3ee) 45%, var(--sc-accent, #6366f1) 55%, transparent 100%)',
                backgroundSize: '250% 100%',
                backgroundPosition: '-100% 0',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                animation: 'sc-title-shimmer 12s ease-in-out infinite',
                animationDelay: '6s',
              }}
            >{title}</h1>
          </div>
        )}
        <div className="flex items-center gap-2">
          {activity && <CompactActivity activity={activity} credits={credits} />}
          {authAction ? (
            <ToolbarButton onClick={handleClick} aria-label={isAuthed ? 'Account' : 'Sign in'} data-tour="account">
              {isAuthed ? <UserCheck size={16} /> : <User size={16} />}
            </ToolbarButton>
          ) : (
            <ToolbarButton onClick={onSettings} aria-label="Open settings">
              <Settings2 size={16} />
            </ToolbarButton>
          )}
        </div>
      </div>
    </header>
  );
}
