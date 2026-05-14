'use client';

/**
 * Dev-only gallery page: /dev/logo-gallery
 * Shows various SmartChats logo options — "S" inlaid inside a circular "C".
 * No auth, no store, no agent — just pure SVG rendering.
 */

import React, { useState } from 'react';

// ── Logo variants ────────────────────────────────────────────────────────────

type LogoProps = { size?: number; fg?: string; bg?: string; accent?: string };

/** V1: Clean geometric — C as outer ring, S centered with matched stroke weight */
function LogoV1({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      {/* C — open circle arc */}
      <path
        d="M 72 30 A 30 30 0 1 0 72 70"
        fill="none"
        stroke={fg}
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* S — centered, slightly smaller */}
      <path
        d="M 60 36 C 52 30, 38 32, 38 40 C 38 48, 62 46, 62 56 C 62 66, 46 68, 38 62"
        fill="none"
        stroke={fg}
        strokeWidth="5.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V2: Monoline — single continuous-feel stroke, ultra minimal */
function LogoV2({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      {/* C — thinner, more open */}
      <path
        d="M 70 28 A 32 32 0 1 0 70 72"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {/* S — flowing, matches C weight */}
      <path
        d="M 59 37 C 53 31, 40 33, 40 40 C 40 47, 60 46, 60 55 C 60 64, 46 67, 39 61"
        fill="none"
        stroke={fg}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V3: Bold fill — C as thick arc, S as a filled glyph */
function LogoV3({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      {/* C — bold arc */}
      <path
        d="M 73 27 A 33 33 0 1 0 73 73"
        fill="none"
        stroke={fg}
        strokeWidth="8"
        strokeLinecap="round"
      />
      {/* S — bold */}
      <path
        d="M 61 35 C 53 27, 36 30, 36 40 C 36 50, 64 47, 64 58 C 64 68, 47 72, 37 64"
        fill="none"
        stroke={fg}
        strokeWidth="7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V4: Gradient accent — C ring with gradient, S in solid white */
function LogoV4({ size = 120, fg = '#ffffff', bg = '#0a0a0a', accent = '#6366f1' }: LogoProps) {
  const id = `grad-v4-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={accent} />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={bg} />
      {/* C — gradient stroke */}
      <path
        d="M 72 28 A 31 31 0 1 0 72 72"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* S — white */}
      <path
        d="M 60 36 C 52 30, 38 32, 38 40 C 38 48, 62 46, 62 56 C 62 66, 46 68, 38 62"
        fill="none"
        stroke={fg}
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V5: Nested — S curves echo the C curvature, feels like one shape */
function LogoV5({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      {/* C — wide sweep */}
      <path
        d="M 74 25 A 35 35 0 1 0 74 75"
        fill="none"
        stroke={fg}
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* S — curves mirror C's radius */}
      <path
        d="M 62 35 C 56 28, 38 28, 36 38 C 34 48, 66 48, 64 60 C 62 70, 44 72, 36 64"
        fill="none"
        stroke={fg}
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V6: Cutout — filled C with S knocked out (negative space) */
function LogoV6({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  const id = `mask-v6-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <mask id={id}>
          <rect width="100" height="100" fill="white" />
          {/* S cutout */}
          <path
            d="M 60 36 C 52 30, 38 32, 38 40 C 38 48, 62 46, 62 56 C 62 66, 46 68, 38 62"
            fill="none"
            stroke="black"
            strokeWidth="7"
            strokeLinecap="round"
          />
        </mask>
      </defs>
      <circle cx="50" cy="50" r="48" fill={bg} />
      {/* C shape as filled arc with S masked out */}
      <path
        d="M 72 28 A 31 31 0 1 0 72 72"
        fill="none"
        stroke={fg}
        strokeWidth="10"
        strokeLinecap="round"
        mask={`url(#${id})`}
      />
      {/* S drawn on top, thinner */}
      <path
        d="M 60 36 C 52 30, 38 32, 38 40 C 38 48, 62 46, 62 56 C 62 66, 46 68, 38 62"
        fill="none"
        stroke={fg}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V7: Double stroke — C outer ring + inner ring, S between */
function LogoV7({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      {/* C — outer */}
      <path
        d="M 74 24 A 36 36 0 1 0 74 76"
        fill="none"
        stroke={fg}
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity={0.35}
      />
      {/* C — inner */}
      <path
        d="M 70 30 A 28 28 0 1 0 70 70"
        fill="none"
        stroke={fg}
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* S */}
      <path
        d="M 60 37 C 53 31, 40 33, 40 40 C 40 47, 60 46, 60 55 C 60 64, 46 67, 39 61"
        fill="none"
        stroke={fg}
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V8: Pill/rounded — C as rounded rectangle border, S inside */
function LogoV8({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <rect x="4" y="4" width="92" height="92" rx="24" fill={bg} />
      {/* C — arc inside rounded container */}
      <path
        d="M 70 28 A 30 30 0 1 0 70 72"
        fill="none"
        stroke={fg}
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* S */}
      <path
        d="M 60 37 C 53 31, 40 33, 40 40 C 40 47, 60 46, 60 55 C 60 64, 46 67, 39 61"
        fill="none"
        stroke={fg}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V9: Intertwined — S and C share a continuous stroke impression */
function LogoV9({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      {/* Combined path — C flows into S */}
      <path
        d="M 72 30 A 30 30 0 1 0 72 70
           M 61 35 C 54 28, 38 30, 38 40 C 38 50, 62 48, 62 58 C 62 68, 46 70, 38 63"
        fill="none"
        stroke={fg}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V10: Glow — gradient bg, glowing S inside C */
function LogoV10({ size = 120, fg = '#ffffff', accent = '#6366f1' }: LogoProps) {
  const gid = `glow-v10-${size}`;
  const bgid = `bg-v10-${size}`;
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
      {/* C */}
      <path
        d="M 72 28 A 31 31 0 1 0 72 72"
        fill="none"
        stroke={accent}
        strokeWidth="5"
        strokeLinecap="round"
        filter={`url(#${gid})`}
        opacity={0.7}
      />
      {/* S — glowing */}
      <path
        d="M 60 36 C 52 30, 38 32, 38 40 C 38 48, 62 46, 62 56 C 62 66, 46 68, 38 62"
        fill="none"
        stroke={fg}
        strokeWidth="5"
        strokeLinecap="round"
        filter={`url(#${gid})`}
      />
    </svg>
  );
}

/** V11: Stencil — thick C, thin precise S inside */
function LogoV11({ size = 120, fg = '#ffffff', bg = '#0a0a0a' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      {/* C — very thick */}
      <path
        d="M 73 26 A 34 34 0 1 0 73 74"
        fill="none"
        stroke={fg}
        strokeWidth="10"
        strokeLinecap="round"
        opacity={0.2}
      />
      {/* S — crisp thin */}
      <path
        d="M 60 36 C 52 30, 38 32, 38 40 C 38 48, 62 46, 62 56 C 62 66, 46 68, 38 62"
        fill="none"
        stroke={fg}
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** V12: Duo-tone — C in accent, S in white, both bold */
function LogoV12({ size = 120, fg = '#ffffff', bg = '#0a0a0a', accent = '#22d3ee' }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={bg} />
      {/* C — accent color */}
      <path
        d="M 72 28 A 31 31 0 1 0 72 72"
        fill="none"
        stroke={accent}
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* S — white */}
      <path
        d="M 60 36 C 52 30, 38 32, 38 40 C 38 48, 62 46, 62 56 C 62 66, 46 68, 38 62"
        fill="none"
        stroke={fg}
        strokeWidth="5.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── All variants ────────────────────────────────────────────────────────────

const VARIANTS = [
  { name: 'V1 — Clean Geometric', desc: 'Matched stroke weight, classic proportions', Component: LogoV1 },
  { name: 'V2 — Monoline', desc: 'Ultra-thin single weight, minimal', Component: LogoV2 },
  { name: 'V3 — Bold', desc: 'Heavy strokes, high impact', Component: LogoV3 },
  { name: 'V4 — Gradient Accent', desc: 'Gradient C ring, solid S', Component: LogoV4 },
  { name: 'V5 — Nested Curves', desc: 'S mirrors C curvature, one-shape feel', Component: LogoV5 },
  { name: 'V6 — Cutout Layer', desc: 'Thick C with thin S overlay', Component: LogoV6 },
  { name: 'V7 — Double Stroke', desc: 'Outer ghost ring + inner ring + S', Component: LogoV7 },
  { name: 'V8 — Rounded Square', desc: 'Squircle container, app-icon ready', Component: LogoV8 },
  { name: 'V9 — Intertwined', desc: 'C and S as parallel paths', Component: LogoV9 },
  { name: 'V10 — Glow', desc: 'Radial gradient bg, glowing strokes', Component: LogoV10 },
  { name: 'V11 — Stencil', desc: 'Fat ghost C, crisp thin S', Component: LogoV11 },
  { name: 'V12 — Duo-tone', desc: 'Cyan C + white S, color contrast', Component: LogoV12 },
];

const PALETTES = [
  { label: 'Dark', fg: '#ffffff', bg: '#0a0a0a', accent: '#6366f1' },
  { label: 'Midnight', fg: '#e0e7ff', bg: '#1e1b4b', accent: '#818cf8' },
  { label: 'Warm', fg: '#fef3c7', bg: '#1c1917', accent: '#f59e0b' },
  { label: 'Light', fg: '#1e1b4b', bg: '#f8fafc', accent: '#6366f1' },
  { label: 'Ocean', fg: '#ffffff', bg: '#0c1222', accent: '#22d3ee' },
];

const SIZES = [32, 48, 80, 120];

export default function LogoGalleryPage() {
  const [palette, setPalette] = useState(PALETTES[0]);
  const [selectedSize, setSelectedSize] = useState(120);

  return (
    <div className="min-h-screen bg-neutral-950 p-6 text-white">
      <h1 className="mb-2 text-2xl font-bold tracking-tight">SmartChats Logo Gallery</h1>
      <p className="mb-6 text-sm text-neutral-400">S inlaid inside a circular C — 12 variants across palettes and sizes</p>

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
