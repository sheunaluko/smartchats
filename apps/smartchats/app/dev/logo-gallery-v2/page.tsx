'use client';

/**
 * Dev-only gallery page: /dev/logo-gallery-v2
 * Yin-yang concept: S spans the full circle, top and bottom curves
 * align with the circle's top and bottom edges.
 */

import React, { useState } from 'react';

type LogoProps = { size?: number; fg?: string; bg?: string; accent?: string };

/**
 * Yin-Yang S inside C.
 * The S divides the circle from top to bottom — its upper lobe
 * reaches the top of the circle, its lower lobe reaches the bottom.
 * The C is the outer circle with an opening on the right.
 */

/** V1: Classic yin-yang — S spans full circle, clean equal weight */
function LogoV1({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  // Circle center at (50,50), radius 32 for the C arc
  // S goes from top of circle (50, 18) to bottom (50, 82)
  // using two semicircular lobes
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      {/* C — arc with opening on the right */}
      <path
        d="M 70 28 A 32 32 0 1 0 70 72"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {/* S — yin-yang divider, top to bottom of circle */}
      <path
        d="M 50 18 C 26 18, 26 50, 50 50 C 74 50, 74 82, 50 82"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V2: Tighter S — lobes don't extend as wide, more subtle */
function LogoV2({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      <path
        d="M 70 28 A 32 32 0 1 0 70 72"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {/* S — narrower lobes */}
      <path
        d="M 50 18 C 32 18, 32 50, 50 50 C 68 50, 68 82, 50 82"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V3: Offset S — S center shifted right toward C opening */
function LogoV3({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      <path
        d="M 70 28 A 32 32 0 1 0 70 72"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {/* S — shifted right, top lobe left, bottom lobe right */}
      <path
        d="M 55 18 C 30 18, 30 50, 55 50 C 80 50, 80 82, 55 82"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V4: Bold weight — heavier strokes for impact */
function LogoV4({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      <path
        d="M 72 26 A 34 34 0 1 0 72 74"
        fill="none"
        stroke={fg}
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* S — bold yin-yang */}
      <path
        d="M 50 16 C 24 16, 24 50, 50 50 C 76 50, 76 84, 50 84"
        fill="none"
        stroke={fg}
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V5: Gradient C, solid S */
function LogoV5({ size = 120, fg = '#ffffff', bg = '#0a0a0a', accent = '#6366f1' }: LogoProps) {
  const id = `grad-yy5-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={accent} />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={bg} />
      <path
        d="M 70 28 A 32 32 0 1 0 70 72"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M 50 18 C 26 18, 26 50, 50 50 C 74 50, 74 82, 50 82"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V6: Duo-tone — C in accent, S in white */
function LogoV6({ size = 120, fg = '#ffffff', bg = '#0a0a0a', accent = '#22d3ee' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      <path
        d="M 70 28 A 32 32 0 1 0 70 72"
        fill="none"
        stroke={accent}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M 50 18 C 26 18, 26 50, 50 50 C 74 50, 74 82, 50 82"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V7: Asymmetric S — top lobe wider, bottom lobe tighter */
function LogoV7({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      <path
        d="M 70 28 A 32 32 0 1 0 70 72"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {/* S — wider top lobe, tighter bottom */}
      <path
        d="M 50 18 C 22 18, 22 50, 50 50 C 66 50, 66 82, 50 82"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V8: S connects to C — S endpoints join the C arc endpoints */
function LogoV8({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      <path
        d="M 70 28 A 32 32 0 1 0 70 72"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {/* S — starts and ends at C's opening points */}
      <path
        d="M 70 28 C 36 28, 28 50, 50 50 C 72 50, 64 72, 70 72"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V9: Glow yin-yang */
function LogoV9({ size = 120, fg = '#ffffff', accent = '#6366f1' }: LogoProps) {
  const gid = `glow-yy9-${size}`;
  const bgid = `bg-yy9-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <radialGradient id={bgid}>
          <stop offset="0%" stopColor="#1e1b4b" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </radialGradient>
        <filter id={gid}>
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#${bgid})`} />
      <path
        d="M 70 28 A 32 32 0 1 0 70 72"
        fill="none"
        stroke={accent}
        strokeWidth="4"
        strokeLinecap="round"
        filter={`url(#${gid})`}
        opacity={0.7}
      />
      <path
        d="M 50 18 C 26 18, 26 50, 50 50 C 74 50, 74 82, 50 82"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
        filter={`url(#${gid})`}
      />
    </svg>
  );
}

/** V10: Rounded square container */
function LogoV10({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <rect x="4" y="4" width="92" height="92" rx="24" fill={bg} />
      <path
        d="M 70 28 A 32 32 0 1 0 70 72"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path
        d="M 50 18 C 26 18, 26 50, 50 50 C 74 50, 74 82, 50 82"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V11: Filled lobes — yin-yang with filled halves */
function LogoV11({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      {/* C arc */}
      <path
        d="M 70 28 A 32 32 0 1 0 70 72"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {/* Filled top lobe (left side) */}
      <path
        d="M 50 18 C 26 18, 26 50, 50 50 Z"
        fill={fg}
        opacity={0.12}
      />
      {/* Filled bottom lobe (right side) */}
      <path
        d="M 50 50 C 74 50, 74 82, 50 82 Z"
        fill={fg}
        opacity={0.12}
      />
      {/* S stroke on top */}
      <path
        d="M 50 18 C 26 18, 26 50, 50 50 C 74 50, 74 82, 50 82"
        fill="none"
        stroke={fg}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V12: Double stroke C + yin-yang S */
function LogoV12({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      {/* C — outer ghost */}
      <path
        d="M 74 24 A 36 36 0 1 0 74 76"
        fill="none"
        stroke={fg}
        strokeWidth="2"
        strokeLinecap="round"
        opacity={0.3}
      />
      {/* C — inner */}
      <path
        d="M 70 28 A 32 32 0 1 0 70 72"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {/* S — yin-yang */}
      <path
        d="M 50 18 C 26 18, 26 50, 50 50 C 74 50, 74 82, 50 82"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── All variants ────────────────────────────────────────────────────────────

const VARIANTS = [
  { name: 'V1 — Classic', desc: 'Full-span S, wide symmetric lobes', Component: LogoV1 },
  { name: 'V2 — Tight', desc: 'Narrower lobes, more subtle', Component: LogoV2 },
  { name: 'V3 — Offset', desc: 'S shifted right toward C opening', Component: LogoV3 },
  { name: 'V4 — Bold', desc: 'Heavy strokes, high impact', Component: LogoV4 },
  { name: 'V5 — Gradient', desc: 'Gradient C ring, solid S', Component: LogoV5 },
  { name: 'V6 — Duo-tone', desc: 'Cyan C + white S', Component: LogoV6 },
  { name: 'V7 — Asymmetric', desc: 'Wider top lobe, tighter bottom', Component: LogoV7 },
  { name: 'V8 — Connected', desc: 'S joins C at the gap endpoints', Component: LogoV8 },
  { name: 'V9 — Glow', desc: 'Radial gradient bg, glowing strokes', Component: LogoV9 },
  { name: 'V10 — Squircle', desc: 'Rounded square container', Component: LogoV10 },
  { name: 'V11 — Filled Lobes', desc: 'Subtle fill in the yin-yang halves', Component: LogoV11 },
  { name: 'V12 — Double Ring', desc: 'Ghost outer ring + inner C + S', Component: LogoV12 },
];

const PALETTES = [
  { label: 'Dark', fg: '#ffffff', bg: '#0a0a0a', accent: '#6366f1' },
  { label: 'Midnight', fg: '#e0e7ff', bg: '#1e1b4b', accent: '#818cf8' },
  { label: 'Warm', fg: '#fef3c7', bg: '#1c1917', accent: '#f59e0b' },
  { label: 'Light', fg: '#1e1b4b', bg: '#f8fafc', accent: '#6366f1' },
  { label: 'Ocean', fg: '#ffffff', bg: '#0c1222', accent: '#22d3ee' },
];

const SIZES = [32, 48, 80, 120];

export default function LogoGalleryV2Page() {
  const [palette, setPalette] = useState(PALETTES[0]);
  const [selectedSize, setSelectedSize] = useState(120);

  return (
    <div className="min-h-screen bg-neutral-950 p-6 text-white">
      <h1 className="mb-2 text-2xl font-bold tracking-tight">SmartChats Logo — Yin-Yang Concept</h1>
      <p className="mb-6 text-sm text-neutral-400">
        S spans the full circle top-to-bottom like a yin-yang divider inside the C
      </p>

      {/* Controls */}
      <div className="mb-8 flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Palette:</span>
          {PALETTES.map(p => (
            <button
              key={p.label}
              onClick={() => setPalette(p)}
              className={`rounded-full px-3 py-1 text-xs transition-all ${
                palette.label === p.label
                  ? 'bg-white text-black'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Size:</span>
          {SIZES.map(s => (
            <button
              key={s}
              onClick={() => setSelectedSize(s)}
              className={`rounded-full px-3 py-1 text-xs transition-all ${
                selectedSize === s
                  ? 'bg-white text-black'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              {s}px
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4">
        {VARIANTS.map(({ name, desc, Component }) => (
          <div
            key={name}
            className="flex flex-col items-center gap-3 rounded-2xl bg-neutral-900 p-5 transition-transform hover:scale-[1.02]"
          >
            <Component
              size={selectedSize}
              fg={palette.fg}
              bg={palette.bg}
              accent={palette.accent}
            />
            <div className="text-center">
              <p className="text-xs font-semibold text-neutral-200">{name}</p>
              <p className="text-[0.65rem] text-neutral-500">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Size comparison strip */}
      <h2 className="mb-4 mt-12 text-lg font-semibold">Size comparison</h2>
      <div className="flex flex-wrap gap-8">
        {VARIANTS.slice(0, 6).map(({ name, Component }) => (
          <div key={name} className="flex flex-col items-center gap-2">
            <p className="text-[0.6rem] text-neutral-500">{name}</p>
            <div className="flex items-end gap-3">
              {SIZES.map(s => (
                <Component key={s} size={s} fg={palette.fg} bg={palette.bg} accent={palette.accent} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* In-context preview — simulated header bar */}
      <h2 className="mb-4 mt-12 text-lg font-semibold">In-context preview (header)</h2>
      <div className="flex flex-wrap gap-4">
        {VARIANTS.map(({ name, Component }) => (
          <div
            key={name}
            className="flex items-center gap-2.5 rounded-xl bg-neutral-900 px-4 py-2.5"
          >
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full">
              <Component size={28} fg={palette.fg} bg={palette.bg} accent={palette.accent} />
            </span>
            <span className="text-sm font-semibold tracking-[0.01em]">SmartChats.AI</span>
          </div>
        ))}
      </div>
    </div>
  );
}
