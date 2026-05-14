'use client';

/**
 * Dev-only prototype gallery: /dev/viz-bars
 * 5 prototype bar chart designs — sharper, more modern aesthetics.
 */

import React from 'react';

// ── Shared mock data ──────────────────────────────────────────────────────────

const DAYS = [
  { label: 'Mon', value: 3.2 },
  { label: 'Tue', value: 5.1 },
  { label: 'Wed', value: 2.8 },
  { label: 'Thu', value: 6.4 },
  { label: 'Fri', value: 4.7 },
  { label: 'Sat', value: 8.1 },
  { label: 'Sun', value: 3.9 },
];

const MAX = Math.max(...DAYS.map(d => d.value));
const MIN = Math.min(...DAYS.map(d => d.value));

// ── 1. Glass Slab ─────────────────────────────────────────────────────────────
// Frosted-glass vertical bars with a subtle inner glow and value floating inside.

function GlassSlab() {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-1.5" style={{ height: 160 }}>
        {DAYS.map((d, i) => {
          const pct = (d.value / MAX) * 100;
          return (
            <div key={i} className="flex flex-1 flex-col items-center justify-end h-full">
              <div
                className="relative w-full rounded-[3px] overflow-hidden transition-all duration-500"
                style={{
                  height: `${pct}%`,
                  background: `linear-gradient(180deg, color-mix(in srgb, var(--sc-primary) 50%, transparent) 0%, color-mix(in srgb, var(--sc-primary) 18%, transparent) 100%)`,
                  backdropFilter: 'blur(12px)',
                  boxShadow: `inset 0 1px 0 color-mix(in srgb, var(--sc-primary) 30%, transparent), 0 0 12px color-mix(in srgb, var(--sc-primary) 10%, transparent)`,
                  borderTop: '1px solid color-mix(in srgb, var(--sc-primary) 40%, transparent)',
                }}
              >
                <span
                  className="absolute inset-x-0 top-1.5 text-center font-mono text-[9px] font-bold"
                  style={{ color: 'var(--sc-text)', opacity: pct > 25 ? 1 : 0 }}
                >
                  {d.value}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between gap-1.5">
        {DAYS.map((d, i) => (
          <span key={i} className="flex-1 text-center text-[9px] font-medium" style={{ color: 'var(--sc-text-muted)' }}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

// ── 1b. Glass Slab (Extremes) ─────────────────────────────────────────────────
// Same as Glass Slab but max and min values are tinted differently.

function GlassSlabExtremes() {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-1.5" style={{ height: 160 }}>
        {DAYS.map((d, i) => {
          const pct = (d.value / MAX) * 100;
          const isMax = d.value === MAX;
          const isMin = d.value === MIN;
          const numColor = isMax ? 'var(--sc-primary)' : isMin ? 'var(--sc-danger)' : 'var(--sc-text)';
          return (
            <div key={i} className="flex flex-1 flex-col items-center justify-end h-full">
              <div
                className="relative w-full rounded-[3px] overflow-hidden transition-all duration-500"
                style={{
                  height: `${pct}%`,
                  background: `linear-gradient(180deg, color-mix(in srgb, var(--sc-primary) 50%, transparent) 0%, color-mix(in srgb, var(--sc-primary) 18%, transparent) 100%)`,
                  backdropFilter: 'blur(12px)',
                  boxShadow: `inset 0 1px 0 color-mix(in srgb, var(--sc-primary) 30%, transparent), 0 0 12px color-mix(in srgb, var(--sc-primary) 10%, transparent)`,
                  borderTop: '1px solid color-mix(in srgb, var(--sc-primary) 40%, transparent)',
                }}
              >
                <span
                  className="absolute inset-x-0 top-1.5 text-center font-mono text-[9px] font-bold"
                  style={{
                    color: numColor,
                    opacity: pct > 25 ? 1 : 0,
                    textDecoration: isMax || isMin ? 'underline' : 'none',
                    textUnderlineOffset: '2px',
                    textDecorationColor: numColor,
                  }}
                >
                  {d.value}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between gap-1.5">
        {DAYS.map((d, i) => (
          <span key={i} className="flex-1 text-center text-[9px] font-medium" style={{ color: 'var(--sc-text-muted)' }}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

// ── 2. Neon Edge ──────────────────────────────────────────────────────────────
// Thin vertical bars with a neon top-edge glow and a dot accent at the peak.

function NeonEdge() {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3" style={{ height: 160 }}>
        {DAYS.map((d, i) => {
          const pct = (d.value / MAX) * 100;
          const isMax = d.value === MAX;
          return (
            <div key={i} className="flex flex-1 flex-col items-center justify-end h-full gap-1">
              <span className="text-[9px] font-mono font-semibold" style={{ color: isMax ? 'var(--sc-primary)' : 'var(--sc-text-muted)' }}>
                {d.value}
              </span>
              <div className="relative w-full flex justify-center">
                <div
                  className="rounded-[2px] transition-all duration-500"
                  style={{
                    width: 6,
                    height: `${(pct / 100) * 140}px`,
                    background: `linear-gradient(0deg, color-mix(in srgb, var(--sc-primary) 12%, var(--sc-surface-secondary)) 0%, var(--sc-primary) 100%)`,
                    boxShadow: isMax
                      ? `0 -4px 16px color-mix(in srgb, var(--sc-primary) 50%, transparent), 0 -1px 4px color-mix(in srgb, var(--sc-primary) 70%, transparent)`
                      : `0 -2px 8px color-mix(in srgb, var(--sc-primary) 20%, transparent)`,
                  }}
                />
                {/* Peak dot */}
                <div
                  className="absolute -top-[3px] rounded-full"
                  style={{
                    width: 6,
                    height: 6,
                    backgroundColor: 'var(--sc-primary)',
                    boxShadow: `0 0 8px var(--sc-primary)`,
                    opacity: isMax ? 1 : 0.6,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between gap-3">
        {DAYS.map((d, i) => (
          <span key={i} className="flex-1 text-center text-[9px] font-medium tracking-wide uppercase" style={{ color: 'var(--sc-text-muted)' }}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

// ── 3. Razor Horizontal ───────────────────────────────────────────────────────
// Horizontal slim bars with sharp left edge, value right-aligned, subtle gradient fill.

function RazorHorizontal() {
  return (
    <div className="space-y-[6px]">
      {DAYS.map((d, i) => {
        const pct = (d.value / MAX) * 100;
        const isMax = d.value === MAX;
        return (
          <div key={i} className="flex items-center gap-2">
            <span
              className="w-8 shrink-0 text-right text-[9px] font-mono font-semibold tracking-tight"
              style={{ color: isMax ? 'var(--sc-primary)' : 'var(--sc-text-muted)' }}
            >
              {d.label}
            </span>
            <div className="relative h-[14px] flex-1 overflow-hidden" style={{ borderRadius: '0 3px 3px 0' }}>
              {/* Track */}
              <div className="absolute inset-0" style={{ background: 'color-mix(in srgb, var(--sc-surface-secondary) 60%, transparent)' }} />
              {/* Fill */}
              <div
                className="absolute inset-y-0 left-0 transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  borderRadius: '0 3px 3px 0',
                  background: isMax
                    ? `linear-gradient(90deg, var(--sc-primary), var(--sc-accent))`
                    : `linear-gradient(90deg, color-mix(in srgb, var(--sc-primary) 70%, var(--sc-surface)) 0%, var(--sc-primary) 100%)`,
                  boxShadow: isMax ? `4px 0 12px color-mix(in srgb, var(--sc-accent) 30%, transparent)` : 'none',
                }}
              />
              {/* Left edge accent */}
              <div className="absolute inset-y-0 left-0 w-[2px]" style={{ backgroundColor: 'var(--sc-primary)' }} />
            </div>
            <span
              className="w-8 shrink-0 text-right font-mono text-[10px] font-bold"
              style={{ color: isMax ? 'var(--sc-text)' : 'var(--sc-text-muted)' }}
            >
              {d.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── 4. Stepped Pillars ────────────────────────────────────────────────────────
// Wide vertical columns with a subtle stepped/layered fill effect, rounded tops,
// and a floating metric chip above the peak bar.

function SteppedPillars() {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-[5px]" style={{ height: 160 }}>
        {DAYS.map((d, i) => {
          const pct = (d.value / MAX) * 100;
          const isMax = d.value === MAX;
          return (
            <div key={i} className="flex flex-1 flex-col items-center justify-end h-full">
              {/* Floating chip for max */}
              {isMax && (
                <div
                  className="mb-1 rounded-full px-2 py-[1px] text-[8px] font-bold"
                  style={{
                    background: 'var(--sc-primary)',
                    color: 'var(--sc-background)',
                    boxShadow: `0 2px 8px color-mix(in srgb, var(--sc-primary) 40%, transparent)`,
                  }}
                >
                  {d.value} km
                </div>
              )}
              <div
                className="relative w-full overflow-hidden transition-all duration-500"
                style={{
                  height: `${pct}%`,
                  borderRadius: '6px 6px 2px 2px',
                  background: isMax
                    ? `linear-gradient(180deg, var(--sc-primary) 0%, color-mix(in srgb, var(--sc-primary) 60%, var(--sc-background)) 100%)`
                    : `linear-gradient(180deg, color-mix(in srgb, var(--sc-text-muted) 22%, var(--sc-surface-secondary)) 0%, var(--sc-surface-secondary) 100%)`,
                }}
              >
                {/* Inner highlight layer */}
                <div
                  className="absolute inset-x-0 top-0 h-[40%]"
                  style={{
                    background: isMax
                      ? 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 100%)'
                      : 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 100%)',
                    borderRadius: '6px 6px 0 0',
                  }}
                />
                {/* Value inside bar (non-max) */}
                {!isMax && pct > 30 && (
                  <span className="absolute inset-x-0 top-2 text-center text-[9px] font-mono font-semibold" style={{ color: 'var(--sc-text-muted)' }}>
                    {d.value}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between gap-[5px]">
        {DAYS.map((d, i) => (
          <span key={i} className="flex-1 text-center text-[9px] font-semibold" style={{ color: d.value === MAX ? 'var(--sc-primary)' : 'var(--sc-text-muted)' }}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

// ── 6. Outlined Pillars ───────────────────────────────────────────────────────
// Like Stepped Pillars but narrower, outlined instead of filled, with both
// max (primary) and min (danger) highlighted.

function OutlinedPillars() {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-[4px]" style={{ height: 160 }}>
        {DAYS.map((d, i) => {
          const pct = (d.value / MAX) * 100;
          const isMax = d.value === MAX;
          const isMin = d.value === MIN;
          const borderColor = isMax ? 'var(--sc-primary)' : isMin ? 'var(--sc-danger)' : 'color-mix(in srgb, var(--sc-text-muted) 22%, transparent)';

          return (
            <div key={i} className="flex flex-1 flex-col items-center justify-end h-full" style={{ maxWidth: 42 }}>
              {/* Floating chip for max / min */}
              {(isMax || isMin) && (
                <div
                  className="mb-1 rounded-full px-1.5 py-[1px] text-[8px] font-bold"
                  style={{
                    background: isMax ? 'var(--sc-primary)' : 'var(--sc-danger)',
                    color: 'var(--sc-background)',
                    boxShadow: `0 2px 8px color-mix(in srgb, ${isMax ? 'var(--sc-primary)' : 'var(--sc-danger)'} 40%, transparent)`,
                  }}
                >
                  {d.value}
                </div>
              )}
              <div
                className="relative w-full overflow-hidden transition-all duration-500"
                style={{
                  height: `${pct}%`,
                  borderRadius: '5px 5px 2px 2px',
                  border: `1.5px solid ${borderColor}`,
                  background: `linear-gradient(180deg, color-mix(in srgb, var(--sc-text-muted) 18%, var(--sc-surface-secondary)) 0%, var(--sc-surface-secondary) 100%)`,
                }}
              >
                {/* Inner highlight layer */}
                <div
                  className="absolute inset-x-0 top-0 h-[40%]"
                  style={{
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 100%)',
                    borderRadius: '5px 5px 0 0',
                  }}
                />
                {/* Value inside bar (non-highlighted) */}
                {!isMax && !isMin && pct > 30 && (
                  <span
                    className="absolute inset-x-0 top-2 text-center text-[9px] font-mono font-semibold"
                    style={{ color: 'var(--sc-text-muted)' }}
                  >
                    {d.value}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between gap-[4px]">
        {DAYS.map((d, i) => {
          const isMax = d.value === MAX;
          const isMin = d.value === MIN;
          return (
            <span
              key={i}
              className="flex-1 text-center text-[9px] font-semibold"
              style={{ maxWidth: 42, color: isMax ? 'var(--sc-primary)' : isMin ? 'var(--sc-danger)' : 'var(--sc-text-muted)' }}
            >
              {d.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── 5. Arc Gauge Bars ─────────────────────────────────────────────────────────
// Each bar is a mini arc/gauge segment — radial feel in a row layout, with
// value shown beneath in a crisp monospace font.

function ArcGaugeBars() {
  const R = 28;
  const STROKE = 5;
  const ARC_SPAN = Math.PI * 0.85; // How much of a semicircle to use
  const circumference = R * ARC_SPAN;

  return (
    <div className="flex items-end justify-between gap-1">
      {DAYS.map((d, i) => {
        const pct = d.value / MAX;
        const isMax = d.value === MAX;
        const dashOffset = circumference * (1 - pct);

        // Arc path: semicircle from left to right
        const startAngle = Math.PI / 2 + (Math.PI - ARC_SPAN) / 2;
        const endAngle = startAngle + ARC_SPAN;
        const cx = R + STROKE;
        const cy = R + STROKE;
        const x1 = cx + R * Math.cos(startAngle);
        const y1 = cy + R * Math.sin(startAngle);
        const x2 = cx + R * Math.cos(endAngle);
        const y2 = cy + R * Math.sin(endAngle);
        const largeArc = ARC_SPAN > Math.PI ? 1 : 0;
        const pathD = `M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 0 ${x2} ${y2}`;

        const size = (R + STROKE) * 2;

        return (
          <div key={i} className="flex flex-1 flex-col items-center">
            <svg width={size} height={size * 0.62} viewBox={`0 0 ${size} ${size * 0.7}`} className="w-full" style={{ maxWidth: 64 }}>
              {/* Track */}
              <path
                d={pathD}
                fill="none"
                stroke="var(--sc-surface-secondary)"
                strokeWidth={STROKE}
                strokeLinecap="round"
              />
              {/* Fill */}
              <path
                d={pathD}
                fill="none"
                stroke={isMax ? 'var(--sc-primary)' : 'color-mix(in srgb, var(--sc-primary) 55%, var(--sc-text-muted))'}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{
                  transition: 'stroke-dashoffset 0.6s ease-out',
                  filter: isMax ? `drop-shadow(0 0 6px var(--sc-primary))` : 'none',
                }}
              />
              {/* Center value */}
              <text
                x={cx}
                y={cy - 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                fontWeight={700}
                fontFamily="var(--sc-font-mono, monospace)"
                fill={isMax ? 'var(--sc-primary)' : 'var(--sc-text)'}
              >
                {d.value}
              </text>
            </svg>
            <span
              className="text-[9px] font-semibold tracking-wide uppercase"
              style={{ color: isMax ? 'var(--sc-primary)' : 'var(--sc-text-muted)', marginTop: -2 }}
            >
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Proto({ num, name, desc, children }: { num: number | string; name: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] font-bold tracking-widest uppercase" style={{ color: 'var(--sc-primary)' }}>
            {String(num).padStart(2, '0')}
          </span>
          <h2 className="text-sm font-bold" style={{ color: 'var(--sc-text)' }}>{name}</h2>
        </div>
        <p className="text-[10px] leading-relaxed" style={{ color: 'var(--sc-text-muted)' }}>{desc}</p>
      </div>
      <div
        className="rounded-xl p-4"
        style={{
          background: 'var(--sc-surface-secondary)',
          border: '1px solid var(--sc-separator)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VizBarsPage() {
  return (
    <div style={{ minHeight: '100dvh', backgroundColor: 'var(--sc-background)', padding: 16, maxWidth: 480, margin: '0 auto' }}>
      <div className="mb-6">
        <h1 className="text-base font-extrabold tracking-tight" style={{ color: 'var(--sc-text)' }}>
          Bar Chart Prototypes
        </h1>
        <p className="text-[11px]" style={{ color: 'var(--sc-text-muted)' }}>
          5 design explorations — weekly running distance (km)
        </p>
      </div>

      <div className="space-y-6">
        <Proto num={1} name="Glass Slab" desc="Frosted vertical bars with inner glow and embedded values.">
          <GlassSlab />
        </Proto>

        <Proto num={"01b"} name="Glass Slab (Extremes)" desc="Same frosted glass — max bar tinted primary, min bar tinted danger, values colored to match.">
          <GlassSlabExtremes />
        </Proto>

        <Proto num={2} name="Neon Edge" desc="Thin pillars with a luminous top-edge glow and peak dot accent.">
          <NeonEdge />
        </Proto>

        <Proto num={3} name="Razor Horizontal" desc="Slim horizontal bars with a sharp left edge and gradient fill.">
          <RazorHorizontal />
        </Proto>

        <Proto num={4} name="Stepped Pillars" desc="Wide columns with layered fill, rounded tops, and a floating chip on the peak.">
          <SteppedPillars />
        </Proto>

        <Proto num={6} name="Outlined Pillars" desc="Narrower outlined columns — max and min highlighted, ghost fill only on extremes.">
          <OutlinedPillars />
        </Proto>

        <Proto num={5} name="Arc Gauge" desc="Radial gauge arcs — each bar becomes a mini meter with a center readout.">
          <ArcGaugeBars />
        </Proto>
      </div>

      <div className="mt-8 pb-8 text-center text-[9px]" style={{ color: 'var(--sc-text-muted)' }}>
        All prototypes use --sc-* design tokens from the active theme pack.
      </div>
    </div>
  );
}
