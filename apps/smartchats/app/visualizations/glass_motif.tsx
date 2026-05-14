'use client';

/**
 * Glass motif — frosted, translucent visual treatment for all chart types.
 * Uses --sc-* CSS vars from the active design pack for all colors.
 * Max/min extremes: primary/danger coloring + underline on values.
 */

import React from 'react';
import type {
  BarChartProps, LineChartProps, PieChartProps,
  StatCardProps, TableDisplayProps, ImageDisplayProps,
  JitterPlotProps, CalendarProps,
} from './types';
import { splitAtGaps, computeXPosition, getDateRange, MIN_SLOT_WIDTH, ScrollableChart } from './charts';
import {
  getMonthGrid, buildDayMap, dateKey, quantitativeOpacity,
  useCalendarNav, useTooltip, DAYS_OF_WEEK, MONTH_NAMES,
} from './calendar_utils';

// ── Shared ────────────────────────────────────────────────────────────────────

const PALETTE = [
  'var(--sc-primary)',
  'var(--sc-accent)',
  'var(--sc-success)',
  'var(--sc-warning)',
  'var(--sc-danger)',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

function pick(i: number, override?: string) {
  return override || PALETTE[i % PALETTE.length];
}

function glassBg(color: string, hiPct = 50, loPct = 18) {
  return `linear-gradient(180deg, color-mix(in srgb, ${color} ${hiPct}%, transparent) 0%, color-mix(in srgb, ${color} ${loPct}%, transparent) 100%)`;
}

function glassGlow(color: string, strength = 10) {
  return `inset 0 1px 0 color-mix(in srgb, ${color} 30%, transparent), 0 0 12px color-mix(in srgb, ${color} ${strength}%, transparent)`;
}

function glassBorder(color: string, pct = 40) {
  return `1px solid color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

// ── BarChart (vertical frosted bars) ──────────────────────────────────────────

export function GlassBarChart({ title, items, unit, yMin, yMax }: BarChartProps) {
  const validValues = items.filter(d => d.value !== null).map(d => d.value as number);
  const min = yMin != null ? yMin : 0;
  const max = yMax != null ? yMax : Math.max(...validValues, 1);
  const range = max - min || 1;
  const maxVal = Math.max(...validValues);
  const minVal = Math.min(...validValues);

  const minW = items.length * MIN_SLOT_WIDTH;

  return (
    <div className="w-full space-y-3">
      {title && <h4 className="text-xs font-semibold text-sc-text">{title}</h4>}
      <ScrollableChart>
      <div style={{ minWidth: minW }}>
        <div className="flex items-end justify-between gap-1.5" style={{ height: 140 }}>
          {items.map((d, i) => {
            if (d.value === null) {
              return (
                <div key={i} className="flex flex-1 flex-col items-center justify-end h-full">
                  <div className="w-full h-px" style={{ borderBottom: '1px dashed var(--sc-separator)' }} />
                </div>
              );
            }
            const pct = ((d.value - min) / range) * 100;
            const isMax = d.value === maxVal;
            const isMin = d.value === minVal;
            const numColor = isMax ? 'var(--sc-primary)' : isMin ? 'var(--sc-danger)' : 'var(--sc-text)';
            return (
              <div key={i} className="flex flex-1 flex-col items-center justify-end h-full">
                <div
                  className="relative w-full rounded-[3px] overflow-hidden transition-all duration-500"
                  style={{
                    height: `${pct}%`,
                    background: glassBg('var(--sc-primary)'),
                    backdropFilter: 'blur(12px)',
                    boxShadow: glassGlow('var(--sc-primary)'),
                    borderTop: glassBorder('var(--sc-primary)'),
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
                    {d.value}{unit || ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between gap-1.5 mt-3">
          {items.map((d, i) => (
            <span key={i} className="flex-1 text-center text-[9px] font-medium" style={{ color: 'var(--sc-text-muted)' }}>
              {d.label}
            </span>
          ))}
        </div>
      </div>
      </ScrollableChart>
    </div>
  );
}

// ── LineChart (frosted area fill + glowing dots) ──────────────────────────────

export function GlassLineChart({ title, series, xLabel, yLabel, yMin, yMax, timeMode }: LineChartProps) {
  const numPoints = series[0]?.points.length || 0;
  const W = Math.max(280, numPoints * MIN_SLOT_WIDTH), H = 140, PAD = { t: 10, r: 10, b: 24, l: 36 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;

  const allY = series.flatMap(s => s.points.map(p => p.y)).filter((y): y is number => y !== null);
  const minY = yMin != null ? yMin : Math.min(...allY);
  const maxY = yMax != null ? yMax : Math.max(...allY);
  const rangeY = maxY - minY || 1;

  const dateRange = timeMode === 'dense' ? getDateRange(series[0]?.points || []) : undefined;

  return (
    <div className="w-full space-y-2">
      {title && <h4 className="text-xs font-semibold text-sc-text">{title}</h4>}
      <ScrollableChart>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto', minWidth: W }}>
        <defs>
          {series.map((s, si) => {
            const color = pick(si, s.color);
            return (
              <linearGradient key={`fill-${si}`} id={`glass-area-${si}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0.03} />
              </linearGradient>
            );
          })}
          <filter id="glass-glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Y axis labels */}
        <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" fontSize={8} fill="var(--sc-text-muted)">{maxY}</text>
        <text x={PAD.l - 4} y={H - PAD.b} textAnchor="end" fontSize={8} fill="var(--sc-text-muted)">{minY}</text>
        {yLabel && <text x={4} y={H / 2} textAnchor="middle" fontSize={7} fill="var(--sc-text-muted)" transform={`rotate(-90, 4, ${H / 2})`}>{yLabel}</text>}

        {/* Subtle grid */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--sc-separator)" strokeOpacity={0.2} />
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--sc-separator)" strokeOpacity={0.2} />

        {series.map((s, si) => {
          const color = pick(si, s.color);
          const pts = s.points.map((p, pi) => {
            const sx = computeXPosition(pi, s.points.length, plotW, PAD.l, timeMode, p._date, dateRange);
            const sy = p.y !== null ? PAD.t + plotH - ((p.y - minY) / rangeY) * plotH : 0;
            return { sx, sy, p };
          });

          const segments = timeMode === 'dense'
            ? [pts.filter(pt => pt.p.y !== null)]
            : splitAtGaps(pts);
          const nonNullPts = pts.filter(pt => pt.p.y !== null);

          // Find max/min for this series
          const yValues = nonNullPts.map(pt => pt.p.y as number);
          const seriesMax = Math.max(...yValues);
          const seriesMin = Math.min(...yValues);

          return (
            <g key={si}>
              {/* Area fill per segment */}
              {segments.map((seg, segI) => {
                const areaPath = `M ${seg[0].sx},${H - PAD.b} ` +
                  seg.map(pt => `L ${pt.sx},${pt.sy}`).join(' ') +
                  ` L ${seg[seg.length - 1].sx},${H - PAD.b} Z`;
                return <path key={`area-${segI}`} d={areaPath} fill={`url(#glass-area-${si})`} />;
              })}
              {/* Lines per segment */}
              {segments.map((seg, segI) => (
                <polyline
                  key={`line-${segI}`}
                  points={seg.map(pt => `${pt.sx},${pt.sy}`).join(' ')}
                  fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" filter="url(#glass-glow)"
                />
              ))}
              {/* Dots */}
              {nonNullPts.map((pt, pi) => {
                const isSeriesMax = pt.p.y === seriesMax;
                const isSeriesMin = pt.p.y === seriesMin;
                const dotColor = isSeriesMax ? 'var(--sc-primary)' : isSeriesMin ? 'var(--sc-danger)' : color;
                const r = isSeriesMax || isSeriesMin ? 3.5 : 2.5;
                return (
                  <circle
                    key={pi}
                    cx={pt.sx}
                    cy={pt.sy}
                    r={r}
                    fill={dotColor}
                    style={{
                      filter: isSeriesMax || isSeriesMin ? `drop-shadow(0 0 4px ${dotColor})` : 'none',
                    }}
                  />
                );
              })}
            </g>
          );
        })}

        {/* X axis labels */}
        {series[0]?.points.length > 0 && (
          <>
            <text x={PAD.l} y={H - PAD.b + 14} textAnchor="start" fontSize={8} fill="var(--sc-text-muted)">{String(series[0].points[0].x)}</text>
            <text x={W - PAD.r} y={H - PAD.b + 14} textAnchor="end" fontSize={8} fill="var(--sc-text-muted)">{String(series[0].points[series[0].points.length - 1].x)}</text>
          </>
        )}
        {xLabel && <text x={W / 2} y={H - 2} textAnchor="middle" fontSize={7} fill="var(--sc-text-muted)">{xLabel}</text>}
      </svg>
      </ScrollableChart>
      {series.length > 1 && (
        <div className="flex flex-wrap justify-center gap-3">
          {series.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[0.5625rem] text-sc-text-muted">
              <div className="h-2 w-2 rounded-sm" style={{ backgroundColor: pick(i, s.color) }} />
              {s.label || `Series ${i + 1}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PieChart (frosted donut with glow) ────────────────────────────────────────

export function GlassPieChart({ title, slices }: PieChartProps) {
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  const R = 50, IR = 28, CX = 70, CY = 60;
  let cumAngle = -Math.PI / 2;

  const maxVal = Math.max(...slices.map(s => s.value));
  const minVal = Math.min(...slices.map(s => s.value));

  const arcs = slices.map((s, i) => {
    const angle = (s.value / total) * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;
    const largeArc = angle > Math.PI ? 1 : 0;
    // Outer arc
    const ox1 = CX + R * Math.cos(startAngle), oy1 = CY + R * Math.sin(startAngle);
    const ox2 = CX + R * Math.cos(endAngle), oy2 = CY + R * Math.sin(endAngle);
    // Inner arc
    const ix1 = CX + IR * Math.cos(endAngle), iy1 = CY + IR * Math.sin(endAngle);
    const ix2 = CX + IR * Math.cos(startAngle), iy2 = CY + IR * Math.sin(startAngle);
    const d = `M ${ox1} ${oy1} A ${R} ${R} 0 ${largeArc} 1 ${ox2} ${oy2} L ${ix1} ${iy1} A ${IR} ${IR} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
    const isMax = s.value === maxVal;
    const isMin = s.value === minVal;
    return { d, color: pick(i, s.color), label: s.label, pct: Math.round((s.value / total) * 100), isMax, isMin };
  });

  return (
    <div className="w-full space-y-2">
      {title && <h4 className="text-xs font-semibold text-sc-text">{title}</h4>}
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 140 120" className="w-[120px] shrink-0" style={{ height: 'auto' }}>
          <defs>
            <filter id="glass-pie-glow">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {arcs.map((a, i) => (
            <path
              key={i}
              d={a.d}
              fill={a.color}
              fillOpacity={0.7}
              stroke="var(--sc-background)"
              strokeWidth={1.5}
              style={{
                filter: a.isMax ? 'url(#glass-pie-glow)' : 'none',
              }}
            />
          ))}
          {/* Center glass circle */}
          <circle cx={CX} cy={CY} r={IR - 2} fill="var(--sc-background)" fillOpacity={0.6} />
        </svg>
        <div className="flex flex-col gap-1.5">
          {arcs.map((a, i) => {
            const labelColor = a.isMax ? 'var(--sc-primary)' : a.isMin ? 'var(--sc-danger)' : undefined;
            return (
              <div key={i} className="flex items-center gap-1.5 text-[0.625rem] text-sc-text-muted">
                <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: a.color, boxShadow: a.isMax ? `0 0 6px ${a.color}` : 'none' }} />
                <span style={labelColor ? { color: labelColor, textDecoration: 'underline', textUnderlineOffset: '2px', textDecorationColor: labelColor } : undefined}>
                  {a.label} ({a.pct}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── JitterPlot (frosted columns behind points, glowing extremes) ──────────────

/** Deterministic jitter: hash (catIdx, ptIdx, value) → [-1, 1] */
function jitter(ci: number, pi: number, v: number): number {
  let h = ((ci * 7919) ^ (pi * 104729) ^ Math.round(v * 1000)) >>> 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b; h = ((h >> 16) ^ h) * 0x45d9f3b; h = (h >> 16) ^ h;
  return (h % 1000) / 500 - 1;
}

export function GlassJitterPlot({ title, categories, yLabel, yMin, yMax, pointSize }: JitterPlotProps) {
  const W = 280, H = 160, PAD = { t: 10, r: 10, b: 24, l: 36 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const r = pointSize ?? 3;

  const allY = categories.flatMap(c => c.points.map(p => p.value));
  const minY = yMin != null ? yMin : Math.min(...allY);
  const maxY = yMax != null ? yMax : Math.max(...allY);
  const rangeY = maxY - minY || 1;
  const globalMax = Math.max(...allY);
  const globalMin = Math.min(...allY);

  const n = categories.length || 1;
  const bandW = plotW / n;
  const jitterW = bandW * 0.3;

  const groupSet = new Set<string>();
  categories.forEach(c => c.points.forEach(p => { if (p.group) groupSet.add(p.group); }));
  const groups = Array.from(groupSet);
  const groupColor = (g: string) => pick(groups.indexOf(g));

  return (
    <div className="w-full space-y-2">
      {title && <h4 className="text-xs font-semibold text-sc-text">{title}</h4>}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }}>
        <defs>
          <filter id="glass-jitter-glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Y axis labels */}
        <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" fontSize={8} fill="var(--sc-text-muted)">{maxY}</text>
        <text x={PAD.l - 4} y={H - PAD.b} textAnchor="end" fontSize={8} fill="var(--sc-text-muted)">{minY}</text>
        {yLabel && <text x={4} y={H / 2} textAnchor="middle" fontSize={7} fill="var(--sc-text-muted)" transform={`rotate(-90, 4, ${H / 2})`}>{yLabel}</text>}

        {/* Axes */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--sc-separator)" strokeOpacity={0.2} />
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--sc-separator)" strokeOpacity={0.2} />

        {categories.map((cat, ci) => {
          const cx = PAD.l + bandW * ci + bandW / 2;
          return (
            <g key={ci}>
              {/* Frosted column backdrop */}
              <rect
                x={cx - bandW * 0.35}
                y={PAD.t}
                width={bandW * 0.7}
                height={plotH}
                rx={3}
                fill="var(--sc-primary)"
                fillOpacity={0.04}
              />
              {/* Category label */}
              <text x={cx} y={H - PAD.b + 14} textAnchor="middle" fontSize={8} fill="var(--sc-text-muted)">
                {cat.category}
              </text>
              {/* Points */}
              {cat.points.map((p, pi) => {
                const py = PAD.t + plotH - ((p.value - minY) / rangeY) * plotH;
                const px = cx + jitter(ci, pi, p.value) * jitterW;
                const isGlobalMax = p.value === globalMax;
                const isGlobalMin = p.value === globalMin;
                const fill = isGlobalMax ? 'var(--sc-primary)' : isGlobalMin ? 'var(--sc-danger)' : (p.color || (p.group ? groupColor(p.group) : pick(ci)));
                const dotR = isGlobalMax || isGlobalMin ? r + 1.5 : r;
                return (
                  <circle
                    key={pi}
                    cx={px}
                    cy={py}
                    r={dotR}
                    fill={fill}
                    fillOpacity={isGlobalMax || isGlobalMin ? 1 : 0.75}
                    style={{
                      filter: isGlobalMax || isGlobalMin ? 'url(#glass-jitter-glow)' : 'none',
                    }}
                  >
                    {p.label && <title>{p.label}: {p.value}</title>}
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
      {groups.length > 1 && (
        <div className="flex flex-wrap justify-center gap-3">
          {groups.map((g, i) => (
            <div key={g} className="flex items-center gap-1.5 text-[0.5625rem] text-sc-text-muted">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: groupColor(g) }} />
              {g}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── StatCard (frosted glass card) ─────────────────────────────────────────────

export function GlassStatCard({ label, value, delta, deltaDirection }: StatCardProps) {
  const deltaColor = deltaDirection === 'up' ? 'var(--sc-success)'
    : deltaDirection === 'down' ? 'var(--sc-danger)'
    : 'var(--sc-text-muted)';
  const arrow = deltaDirection === 'up' ? '\u2191' : deltaDirection === 'down' ? '\u2193' : '';

  return (
    <div
      className="rounded-2xl p-3 text-center"
      style={{
        background: glassBg('var(--sc-primary)', 12, 4),
        backdropFilter: 'blur(12px)',
        boxShadow: glassGlow('var(--sc-primary)', 6),
        border: glassBorder('var(--sc-primary)', 20),
      }}
    >
      <div className="text-[0.625rem] font-medium uppercase tracking-[0.08em] text-sc-text-muted">{label}</div>
      <div className="mt-1 text-[1.75rem] font-bold leading-tight text-sc-text">{value}</div>
      {delta && (
        <div className="mt-0.5 text-[0.6875rem] font-semibold" style={{ color: deltaColor }}>
          {arrow} {delta}
        </div>
      )}
    </div>
  );
}

// ── TableDisplay (frosted rows) ───────────────────────────────────────────────

export function GlassTableDisplay({ title, columns, rows }: TableDisplayProps) {
  return (
    <div className="w-full space-y-2">
      {title && <h4 className="text-xs font-semibold text-sc-text">{title}</h4>}
      <div
        className="overflow-x-auto rounded-xl"
        style={{
          border: glassBorder('var(--sc-primary)', 20),
          backdropFilter: 'blur(8px)',
        }}
      >
        <table className="w-full border-collapse text-[0.6875rem]">
          <thead>
            <tr>
              {columns.map(c => (
                <th
                  key={c.key}
                  className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold"
                  style={{
                    color: 'var(--sc-primary)',
                    borderBottom: glassBorder('var(--sc-primary)', 25),
                    background: 'color-mix(in srgb, var(--sc-primary) 6%, transparent)',
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                style={{
                  background: ri % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--sc-primary) 3%, transparent)',
                }}
              >
                {columns.map(c => (
                  <td
                    key={c.key}
                    className="whitespace-nowrap px-2.5 py-1.5 text-sc-text"
                    style={{
                      borderBottom: ri < rows.length - 1 ? '1px solid color-mix(in srgb, var(--sc-separator) 30%, transparent)' : 'none',
                    }}
                  >
                    {row[c.key] != null ? String(row[c.key]) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── ImageDisplay (frosted frame) ──────────────────────────────────────────────

export function GlassImageDisplay({ url, alt, caption }: ImageDisplayProps) {
  return (
    <div className="w-full text-center">
      <div
        className="inline-block overflow-hidden rounded-xl"
        style={{
          border: glassBorder('var(--sc-primary)', 20),
          boxShadow: `0 0 20px color-mix(in srgb, var(--sc-primary) 8%, transparent)`,
        }}
      >
        <img
          src={url}
          alt={alt || 'Visualization'}
          className="max-w-full"
          style={{ display: 'block' }}
        />
      </div>
      {caption && <p className="mt-1.5 text-[0.625rem] text-sc-text-muted">{caption}</p>}
    </div>
  );
}

// ── Calendar (frosted cells with glow) ──────────────────────────────────────

export function GlassCalendar(props: CalendarProps) {
  const { title, days, mode = 'boolean', unit } = props;
  const { displayYear, displayMonth, prev, next } = useCalendarNav(props.year, props.month);
  const { tip, show, hide } = useTooltip();

  const dayMap = buildDayMap(days);
  const { startDow, daysInMonth, totalCells } = getMonthGrid(displayYear, displayMonth);

  const values = days.filter(d => d.value != null).map(d => d.value!);
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;

  return (
    <div className="w-full space-y-2 relative">
      <div className="flex items-center justify-between pr-8">
        {title && <h4 className="text-xs font-semibold text-sc-text">{title}</h4>}
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={prev} className="text-sc-text-muted hover:text-sc-text text-sm px-1">&lsaquo;</button>
          <span className="text-[10px] font-medium text-sc-text min-w-[100px] text-center">
            {MONTH_NAMES[displayMonth - 1]} {displayYear}
          </span>
          <button onClick={next} className="text-sc-text-muted hover:text-sc-text text-sm px-1">&rsaquo;</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-[2px]">
        {DAYS_OF_WEEK.map(d => (
          <div key={d} className="text-center text-[8px] font-medium text-sc-text-muted py-0.5">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-[2px]">
        {Array.from({ length: totalCells }, (_, i) => {
          const dayNum = i - startDow + 1;
          const isValid = dayNum >= 1 && dayNum <= daysInMonth;
          if (!isValid) return <div key={i} className="h-[30px]" />;

          const key = dateKey(displayYear, displayMonth, dayNum);
          const data = dayMap.get(key);
          const hasDone = data?.done;
          const hasValue = data?.value != null;
          const opacity = hasValue ? quantitativeOpacity(data!.value!, minV, maxV) : 0;

          return (
            <div
              key={i}
              className="h-[30px] flex flex-col items-center justify-center rounded-md relative cursor-default"
              style={{
                background: hasDone
                  ? glassBg('var(--sc-primary)', 40, 15)
                  : hasValue && mode === 'quantitative'
                  ? glassBg('var(--sc-primary)', Math.round(opacity * 50), Math.round(opacity * 18))
                  : undefined,
                backdropFilter: hasDone || (hasValue && mode === 'quantitative') ? 'blur(6px)' : undefined,
                boxShadow: hasDone ? glassGlow('var(--sc-primary)', 6) : undefined,
                border: (hasDone || (data?.value && mode === 'quantitative'))
                  ? glassBorder('var(--sc-primary)', 25)
                  : undefined,
              }}
              onMouseEnter={data ? (e) => show(data, e) : undefined}
              onMouseLeave={data ? hide : undefined}
            >
              <span className="text-[9px] text-sc-text-muted">{dayNum}</span>
              {mode === 'boolean' && !hasDone && (
                <div className="w-[6px] h-[6px] rounded-full mt-0.5" style={{ border: '1px solid var(--sc-separator)' }} />
              )}
              {mode === 'quantitative' && hasValue && (
                <span className="text-[7px] font-mono text-sc-text" style={{ opacity: 0.8 }}>
                  {data!.label || data!.value}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {tip && (
        <div
          className="fixed z-50 px-2 py-1 rounded-md text-[9px] shadow-lg pointer-events-none"
          style={{
            left: tip.x, top: tip.y - 4, transform: 'translate(-50%, -100%)',
            background: glassBg('var(--sc-primary)', 60, 30),
            backdropFilter: 'blur(12px)',
            border: glassBorder('var(--sc-primary)', 30),
            color: 'var(--sc-text)',
          }}
        >
          {tip.day.details || (tip.day.value != null ? `${tip.day.value}${unit ? ` ${unit}` : ''}` : tip.day.done ? 'Done' : 'Not done')}
        </div>
      )}
    </div>
  );
}
