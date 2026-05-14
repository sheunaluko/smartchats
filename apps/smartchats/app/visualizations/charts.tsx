'use client';

import React, { useRef, useEffect } from 'react';
import type {
  BarChartProps, LineChartProps, PieChartProps,
  StatCardProps, TableDisplayProps, ImageDisplayProps,
  JitterPlotProps,
} from './types';
import { useVizMotif } from '../../core/VizMotifContext';
import {
  GlassBarChart, GlassLineChart, GlassPieChart, GlassStatCard,
  GlassTableDisplay, GlassImageDisplay, GlassJitterPlot,
} from './glass_motif';
import {
  MinimalBarChart, MinimalLineChart, MinimalPieChart, MinimalStatCard,
  MinimalTableDisplay, MinimalImageDisplay, MinimalJitterPlot,
} from './minimal_motif';
import {
  RetroBarChart, RetroLineChart, RetroPieChart, RetroStatCard,
  RetroTableDisplay, RetroImageDisplay, RetroJitterPlot,
} from './retro_motif';

/** Minimum pixel width per x-axis slot (bar, data point, etc.). Charts scroll horizontally when content exceeds container. */
export const MIN_SLOT_WIDTH = 24;

/** Scrollable container with hidden scrollbar and a right-edge fade + chevron hint when overflowing */
export function ScrollableChart({ children }: { children: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    const hint = hintRef.current;
    if (!el || !hint) return;
    const check = () => {
      const canScroll = el.scrollWidth > el.clientWidth + 2;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      hint.style.opacity = canScroll && !atEnd ? '1' : '0';
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', check); ro.disconnect(); };
  }, []);

  return (
    <div className="relative">
      <div ref={scrollRef} className="overflow-x-auto scrollbar-hide">
        {children}
      </div>
      <div
        ref={hintRef}
        className="pointer-events-none absolute right-0 top-0 bottom-0 flex items-center pl-3"
        style={{
          opacity: 0,
          transition: 'opacity 200ms ease',
          background: 'linear-gradient(to right, transparent 0%, color-mix(in srgb, var(--sc-surface) 40%, transparent) 70%, color-mix(in srgb, var(--sc-surface) 60%, transparent) 100%)',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="text-sc-text-muted animate-pulse">
          <path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

// ── Chart utilities (shared by all motifs) ────────────────────────────────────

type PositionedPoint = { sx: number; sy: number; p: { x: number | string; y: number | null; _date?: string } };

/** Split a positioned-points array into contiguous segments of non-null y values */
export function splitAtGaps(points: PositionedPoint[]): PositionedPoint[][] {
  const segments: PositionedPoint[][] = [];
  let current: PositionedPoint[] = [];
  for (const pt of points) {
    if (pt.p.y !== null) {
      current.push(pt);
    } else {
      if (current.length > 0) { segments.push(current); current = []; }
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** Compute x position: index-based for sparse, date-proportional for dense */
export function computeXPosition(
  pi: number, total: number, plotW: number, padL: number,
  timeMode?: string, dateStr?: string, dateRange?: { min: number; max: number },
): number {
  if (timeMode === 'dense' && dateStr && dateRange && dateRange.max > dateRange.min) {
    const ms = new Date(dateStr).getTime();
    return padL + ((ms - dateRange.min) / (dateRange.max - dateRange.min)) * plotW;
  }
  return padL + (pi / Math.max(total - 1, 1)) * plotW;
}

/** Compute date range (ms) from an array of points with _date fields */
export function getDateRange(points: { _date?: string }[]): { min: number; max: number } | undefined {
  const dates = points.map(p => p._date).filter(Boolean) as string[];
  if (dates.length < 2) return undefined;
  const ms = dates.map(d => new Date(d).getTime());
  return { min: Math.min(...ms), max: Math.max(...ms) };
}

// ── Palette (falls back to CSS vars) ───────────────────────────────────────────

const PALETTE = [
  'var(--sc-primary, #3b82f6)',
  'var(--sc-accent, #a855f7)',
  'var(--sc-success, #22c55e)',
  'var(--sc-warning, #f59e0b)',
  'var(--sc-danger, #ef4444)',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

function pick(i: number, override?: string) {
  return override || PALETTE[i % PALETTE.length];
}

// ── BarChart (horizontal bars) ─────────────────────────────────────────────────

export function BarChart(props: BarChartProps) {
  const { motifId } = useVizMotif();
  if (motifId === 'glass') return <GlassBarChart {...props} />;
  if (motifId === 'minimal') return <MinimalBarChart {...props} />;
  if (motifId === 'retro') return <RetroBarChart {...props} />;

  const { title, items, unit, yMin, yMax } = props;
  const validValues = items.filter(d => d.value !== null).map(d => d.value as number);
  const min = yMin != null ? yMin : 0;
  const max = yMax != null ? yMax : Math.max(...validValues, 1);

  return (
    <div className="w-full space-y-2">
      {title && <h4 className="text-xs font-semibold text-sc-text">{title}</h4>}
      <div className="space-y-1.5">
        {items.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-14 shrink-0 truncate text-right text-[0.625rem] text-sc-text-muted">
              {d.label}
            </span>
            {d.value !== null ? (
              <>
                <div className="h-4 flex-1 overflow-hidden rounded-md bg-sc-surface-secondary">
                  <div
                    className="h-full rounded-md transition-[width] duration-[400ms] ease-out"
                    style={{
                      width: `${((d.value - min) / (max - min || 1)) * 100}%`,
                      backgroundColor: pick(i, d.color),
                    }}
                  />
                </div>
                <span className="min-w-[1.75rem] shrink-0 text-right text-[0.625rem] text-sc-text-muted">
                  {d.value}{unit || ''}
                </span>
              </>
            ) : (
              <div className="h-4 flex-1 rounded-md" style={{ borderBottom: '1px dashed var(--sc-separator)' }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── LineChart (SVG polyline) ───────────────────────────────────────────────────

export function LineChart(props: LineChartProps) {
  const { motifId } = useVizMotif();
  if (motifId === 'glass') return <GlassLineChart {...props} />;
  if (motifId === 'minimal') return <MinimalLineChart {...props} />;
  if (motifId === 'retro') return <RetroLineChart {...props} />;

  const { title, series, xLabel, yLabel, yMin, yMax, timeMode } = props;
  const numPoints = series[0]?.points.length || 0;
  const W = Math.max(280, numPoints * MIN_SLOT_WIDTH), H = 140, PAD = { t: 10, r: 10, b: 24, l: 36 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;

  const allY = series.flatMap(s => s.points.map(p => p.y)).filter((y): y is number => y !== null);
  const minY = yMin != null ? yMin : Math.min(...allY);
  const maxY = yMax != null ? yMax : Math.max(...allY);
  const rangeY = maxY - minY || 1;

  // Compute date range for dense mode x-positioning
  const dateRange = timeMode === 'dense' ? getDateRange(series[0]?.points || []) : undefined;

  return (
    <div className="w-full space-y-2">
      {title && <h4 className="text-xs font-semibold text-sc-text">{title}</h4>}
      <ScrollableChart>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto', minWidth: W }}>
        {/* Y axis labels */}
        <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" fontSize={8} fill="var(--sc-text-muted)">{maxY}</text>
        <text x={PAD.l - 4} y={H - PAD.b} textAnchor="end" fontSize={8} fill="var(--sc-text-muted)">{minY}</text>
        {yLabel && <text x={4} y={H / 2} textAnchor="middle" fontSize={7} fill="var(--sc-text-muted)" transform={`rotate(-90, 4, ${H / 2})`}>{yLabel}</text>}

        {/* Grid lines */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--sc-separator)" strokeOpacity={0.3} />
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--sc-separator)" strokeOpacity={0.3} />

        {series.map((s, si) => {
          const color = pick(si, s.color);
          const pts: PositionedPoint[] = s.points.map((p, pi) => {
            const sx = computeXPosition(pi, s.points.length, plotW, PAD.l, timeMode, p._date, dateRange);
            const sy = p.y !== null ? PAD.t + plotH - ((p.y - minY) / rangeY) * plotH : 0;
            return { sx, sy, p };
          });

          const segments = timeMode === 'dense'
            ? [pts.filter(pt => pt.p.y !== null)]
            : splitAtGaps(pts);
          return (
            <g key={si}>
              {segments.map((seg, segI) => (
                <polyline
                  key={segI}
                  points={seg.map(pt => `${pt.sx},${pt.sy}`).join(' ')}
                  fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round"
                />
              ))}
              {pts.filter(pt => pt.p.y !== null).map((pt, pi) => (
                <circle key={pi} cx={pt.sx} cy={pt.sy} r={2.5} fill={color} />
              ))}
            </g>
          );
        })}

        {/* X axis labels (first and last) */}
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

// ── PieChart (SVG arcs) ────────────────────────────────────────────────────────

export function PieChart(props: PieChartProps) {
  const { motifId } = useVizMotif();
  if (motifId === 'glass') return <GlassPieChart {...props} />;
  if (motifId === 'minimal') return <MinimalPieChart {...props} />;
  if (motifId === 'retro') return <RetroPieChart {...props} />;

  const { title, slices } = props;
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  const R = 50, CX = 70, CY = 60;
  let cumAngle = -Math.PI / 2;

  const arcs = slices.map((s, i) => {
    const angle = (s.value / total) * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;
    const largeArc = angle > Math.PI ? 1 : 0;
    const x1 = CX + R * Math.cos(startAngle), y1 = CY + R * Math.sin(startAngle);
    const x2 = CX + R * Math.cos(endAngle), y2 = CY + R * Math.sin(endAngle);
    const d = `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    return { d, color: pick(i, s.color), label: s.label, pct: Math.round((s.value / total) * 100) };
  });

  return (
    <div className="w-full space-y-2">
      {title && <h4 className="text-xs font-semibold text-sc-text">{title}</h4>}
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 140 120" className="w-[120px] shrink-0" style={{ height: 'auto' }}>
          {arcs.map((a, i) => (
            <path key={i} d={a.d} fill={a.color} stroke="var(--sc-background)" strokeWidth={1.5} />
          ))}
        </svg>
        <div className="flex flex-col gap-1.5">
          {arcs.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[0.625rem] text-sc-text-muted">
              <div className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: a.color }} />
              <span>{a.label} ({a.pct}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── JitterPlot (vertical strip/swarm) ─────────────────────────────────────────

/** Deterministic jitter: hash (catIdx, ptIdx, value) → [-1, 1] */
function jitter(ci: number, pi: number, v: number): number {
  let h = ((ci * 7919) ^ (pi * 104729) ^ Math.round(v * 1000)) >>> 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b; h = ((h >> 16) ^ h) * 0x45d9f3b; h = (h >> 16) ^ h;
  return (h % 1000) / 500 - 1; // -1 … +1
}

export function JitterPlot(props: JitterPlotProps) {
  const { motifId } = useVizMotif();
  if (motifId === 'glass') return <GlassJitterPlot {...props} />;
  if (motifId === 'minimal') return <MinimalJitterPlot {...props} />;
  if (motifId === 'retro') return <RetroJitterPlot {...props} />;

  const { title, categories, yLabel, yMin, yMax, pointSize } = props;
  const W = 280, H = 160, PAD = { t: 10, r: 10, b: 24, l: 36 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const r = pointSize ?? 3;

  const allY = categories.flatMap(c => c.points.map(p => p.value));
  const minY = yMin != null ? yMin : Math.min(...allY);
  const maxY = yMax != null ? yMax : Math.max(...allY);
  const rangeY = maxY - minY || 1;

  const n = categories.length || 1;
  const bandW = plotW / n;
  const jitterW = bandW * 0.3; // ±30% of band

  // Collect unique groups for legend coloring
  const groupSet = new Set<string>();
  categories.forEach(c => c.points.forEach(p => { if (p.group) groupSet.add(p.group); }));
  const groups = Array.from(groupSet);
  const groupColor = (g: string) => pick(groups.indexOf(g));

  return (
    <div className="w-full space-y-2">
      {title && <h4 className="text-xs font-semibold text-sc-text">{title}</h4>}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }}>
        {/* Y axis labels */}
        <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" fontSize={8} fill="var(--sc-text-muted)">{maxY}</text>
        <text x={PAD.l - 4} y={H - PAD.b} textAnchor="end" fontSize={8} fill="var(--sc-text-muted)">{minY}</text>
        {yLabel && <text x={4} y={H / 2} textAnchor="middle" fontSize={7} fill="var(--sc-text-muted)" transform={`rotate(-90, 4, ${H / 2})`}>{yLabel}</text>}

        {/* Axes */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--sc-separator)" strokeOpacity={0.3} />
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--sc-separator)" strokeOpacity={0.3} />

        {categories.map((cat, ci) => {
          const cx = PAD.l + bandW * ci + bandW / 2;
          return (
            <g key={ci}>
              {/* Category label */}
              <text x={cx} y={H - PAD.b + 14} textAnchor="middle" fontSize={8} fill="var(--sc-text-muted)">
                {cat.category}
              </text>
              {/* Points */}
              {cat.points.map((p, pi) => {
                const py = PAD.t + plotH - ((p.value - minY) / rangeY) * plotH;
                const px = cx + jitter(ci, pi, p.value) * jitterW;
                const fill = p.color || (p.group ? groupColor(p.group) : pick(ci));
                return (
                  <circle key={pi} cx={px} cy={py} r={r} fill={fill} fillOpacity={0.75}>
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

// ── StatCard ───────────────────────────────────────────────────────────────────

export function StatCard(props: StatCardProps) {
  const { motifId } = useVizMotif();
  if (motifId === 'glass') return <GlassStatCard {...props} />;
  if (motifId === 'minimal') return <MinimalStatCard {...props} />;
  if (motifId === 'retro') return <RetroStatCard {...props} />;

  const { label, value, delta, deltaDirection } = props;
  const deltaColor = deltaDirection === 'up' ? 'text-[#22c55e]'
    : deltaDirection === 'down' ? 'text-[#ef4444]'
    : 'text-sc-text-muted';
  const arrow = deltaDirection === 'up' ? '\u2191' : deltaDirection === 'down' ? '\u2193' : '';

  return (
    <div className="rounded-2xl bg-sc-surface-secondary p-3 text-center">
      <div className="text-[0.625rem] font-medium uppercase tracking-[0.08em] text-sc-text-muted">{label}</div>
      <div className="mt-1 text-[1.75rem] font-bold leading-tight text-sc-text">{value}</div>
      {delta && (
        <div className={`mt-0.5 text-[0.6875rem] ${deltaColor}`}>
          {arrow} {delta}
        </div>
      )}
    </div>
  );
}

// ── TableDisplay ───────────────────────────────────────────────────────────────

export function TableDisplay(props: TableDisplayProps) {
  const { motifId } = useVizMotif();
  if (motifId === 'glass') return <GlassTableDisplay {...props} />;
  if (motifId === 'minimal') return <MinimalTableDisplay {...props} />;
  if (motifId === 'retro') return <RetroTableDisplay {...props} />;

  const { title, columns, rows } = props;
  return (
    <div className="w-full space-y-2">
      {title && <h4 className="text-xs font-semibold text-sc-text">{title}</h4>}
      <div className="overflow-x-auto rounded-xl border border-sc-separator">
        <table className="w-full border-collapse text-[0.6875rem]">
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} className="whitespace-nowrap border-b border-sc-separator bg-sc-surface-secondary px-2.5 py-1.5 text-left font-semibold text-sc-text-muted">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {columns.map(c => (
                  <td
                    key={c.key}
                    className={`whitespace-nowrap px-2.5 py-1.5 text-sc-text ${ri < rows.length - 1 ? 'border-b border-sc-separator/40' : ''}`}
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

// ── ImageDisplay ───────────────────────────────────────────────────────────────

export function ImageDisplay(props: ImageDisplayProps) {
  const { motifId } = useVizMotif();
  if (motifId === 'glass') return <GlassImageDisplay {...props} />;
  if (motifId === 'minimal') return <MinimalImageDisplay {...props} />;
  if (motifId === 'retro') return <RetroImageDisplay {...props} />;

  const { url, alt, caption } = props;
  return (
    <div className="w-full text-center">
      <img
        src={url}
        alt={alt || 'Visualization'}
        className="max-w-full rounded-xl bg-sc-surface-secondary"
      />
      {caption && <p className="mt-1 text-[0.625rem] text-sc-text-muted">{caption}</p>}
    </div>
  );
}
