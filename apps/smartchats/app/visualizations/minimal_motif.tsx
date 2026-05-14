'use client';

/**
 * Minimal motif — stripped-down, no decorations, no gradients, no shadows.
 * Hairline axes, monospace values, lots of whitespace. Scientific paper aesthetic.
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

const PALETTE = [
  'var(--sc-primary)',
  'var(--sc-accent)',
  'var(--sc-success)',
  'var(--sc-warning)',
  'var(--sc-danger)',
];

function pick(i: number, override?: string) {
  return override || PALETTE[i % PALETTE.length];
}

// ── BarChart (flat horizontal bars, no rounding) ──────────────────────────────

export function MinimalBarChart({ title, items, unit, yMin, yMax }: BarChartProps) {
  const validValues = items.filter(d => d.value !== null).map(d => d.value as number);
  const min = yMin != null ? yMin : 0;
  const max = yMax != null ? yMax : Math.max(...validValues, 1);
  const range = max - min || 1;

  return (
    <div className="w-full space-y-3">
      {title && <h4 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-sc-text-muted">{title}</h4>}
      <div className="space-y-[3px]">
        {items.map((d, i) => {
          if (d.value === null) {
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-right font-mono text-[8px] text-sc-text-muted">{d.label}</span>
                <div className="h-[10px] flex-1" style={{ borderBottom: '0.5px dashed var(--sc-text-muted)', opacity: 0.3 }} />
                <span className="w-10 shrink-0 text-right font-mono text-[8px] text-sc-text-muted" style={{ opacity: 0.3 }}>&mdash;</span>
              </div>
            );
          }
          const pct = ((d.value - min) / range) * 100;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-right font-mono text-[8px] text-sc-text-muted">
                {d.label}
              </span>
              <div className="h-[10px] flex-1 overflow-hidden" style={{ backgroundColor: 'color-mix(in srgb, var(--sc-text-muted) 8%, transparent)' }}>
                <div
                  className="h-full transition-[width] duration-300"
                  style={{ width: `${pct}%`, backgroundColor: 'var(--sc-primary)', opacity: 0.7 }}
                />
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-[8px] text-sc-text-muted">
                {d.value}{unit || ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── LineChart (hairline strokes, no dots, tick marks) ─────────────────────────

export function MinimalLineChart({ title, series, xLabel, yLabel, yMin, yMax, timeMode }: LineChartProps) {
  const numPoints = series[0]?.points.length || 0;
  const W = Math.max(280, numPoints * MIN_SLOT_WIDTH), H = 130, PAD = { t: 8, r: 6, b: 22, l: 32 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;

  const allY = series.flatMap(s => s.points.map(p => p.y)).filter((y): y is number => y !== null);
  const minY = yMin != null ? yMin : Math.min(...allY);
  const maxY = yMax != null ? yMax : Math.max(...allY);
  const rangeY = maxY - minY || 1;

  const dateRange = timeMode === 'dense' ? getDateRange(series[0]?.points || []) : undefined;

  // Generate ~4 horizontal grid lines
  const gridCount = 4;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const val = minY + (rangeY / gridCount) * i;
    const y = PAD.t + plotH - ((val - minY) / rangeY) * plotH;
    return { val: Math.round(val * 10) / 10, y };
  });

  return (
    <div className="w-full space-y-1">
      {title && <h4 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-sc-text-muted">{title}</h4>}
      <ScrollableChart>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto', minWidth: W }}>
        {/* Grid lines */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={g.y} x2={W - PAD.r} y2={g.y} stroke="var(--sc-text-muted)" strokeOpacity={0.1} strokeWidth={0.5} />
            <text x={PAD.l - 3} y={g.y + 3} textAnchor="end" fontSize={6} fontFamily="var(--sc-font-mono, monospace)" fill="var(--sc-text-muted)" fillOpacity={0.5}>{g.val}</text>
          </g>
        ))}

        {/* Axes — hairline */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--sc-text-muted)" strokeOpacity={0.25} strokeWidth={0.5} />
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--sc-text-muted)" strokeOpacity={0.25} strokeWidth={0.5} />

        {yLabel && <text x={3} y={H / 2} textAnchor="middle" fontSize={6} fontFamily="var(--sc-font-mono, monospace)" fill="var(--sc-text-muted)" fillOpacity={0.5} transform={`rotate(-90, 3, ${H / 2})`}>{yLabel}</text>}

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
          return (
            <g key={si}>
              {segments.map((seg, segI) => {
                const d = seg.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.sx} ${pt.sy}`).join(' ');
                return <path key={segI} d={d} fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.8} />;
              })}
            </g>
          );
        })}

        {/* X axis labels — sampled with tick */}
        {series[0]?.points.map((p, pi) => {
          const sx = computeXPosition(pi, series[0].points.length, plotW, PAD.l, timeMode, p._date, dateRange);
          const show = pi === 0 || pi === series[0].points.length - 1 || pi % Math.ceil(series[0].points.length / 5) === 0;
          if (!show) return null;
          return (
            <g key={pi}>
              <line x1={sx} y1={H - PAD.b} x2={sx} y2={H - PAD.b + 3} stroke="var(--sc-text-muted)" strokeOpacity={0.25} strokeWidth={0.5} />
              <text x={sx} y={H - PAD.b + 11} textAnchor="middle" fontSize={6} fontFamily="var(--sc-font-mono, monospace)" fill="var(--sc-text-muted)" fillOpacity={0.5}>{String(p.x)}</text>
            </g>
          );
        })}
        {xLabel && <text x={W / 2} y={H - 1} textAnchor="middle" fontSize={6} fontFamily="var(--sc-font-mono, monospace)" fill="var(--sc-text-muted)" fillOpacity={0.5}>{xLabel}</text>}
      </svg>
      </ScrollableChart>
      {series.length > 1 && (
        <div className="flex flex-wrap justify-center gap-3">
          {series.map((s, i) => (
            <div key={i} className="flex items-center gap-1 font-mono text-[8px] text-sc-text-muted">
              <div className="h-[1px] w-3" style={{ backgroundColor: pick(i, s.color), opacity: 0.8 }} />
              {s.label || `S${i + 1}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PieChart (thin ring, no fills) ────────────────────────────────────────────

export function MinimalPieChart({ title, slices }: PieChartProps) {
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  const R = 44, IR = 34, CX = 56, CY = 56;
  let cumAngle = -Math.PI / 2;

  const arcs = slices.map((s, i) => {
    const angle = (s.value / total) * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;
    const largeArc = angle > Math.PI ? 1 : 0;
    const ox1 = CX + R * Math.cos(startAngle), oy1 = CY + R * Math.sin(startAngle);
    const ox2 = CX + R * Math.cos(endAngle), oy2 = CY + R * Math.sin(endAngle);
    const ix1 = CX + IR * Math.cos(endAngle), iy1 = CY + IR * Math.sin(endAngle);
    const ix2 = CX + IR * Math.cos(startAngle), iy2 = CY + IR * Math.sin(startAngle);
    const d = `M ${ox1} ${oy1} A ${R} ${R} 0 ${largeArc} 1 ${ox2} ${oy2} L ${ix1} ${iy1} A ${IR} ${IR} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
    return { d, color: pick(i, s.color), label: s.label, pct: Math.round((s.value / total) * 100) };
  });

  return (
    <div className="w-full space-y-1">
      {title && <h4 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-sc-text-muted">{title}</h4>}
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 112 112" className="w-[100px] shrink-0" style={{ height: 'auto' }}>
          {arcs.map((a, i) => (
            <path key={i} d={a.d} fill={a.color} fillOpacity={0.6} stroke="var(--sc-background)" strokeWidth={1} />
          ))}
          {/* Center: show total */}
          <text x={CX} y={CY + 1} textAnchor="middle" dominantBaseline="central" fontSize={9} fontFamily="var(--sc-font-mono, monospace)" fill="var(--sc-text-muted)">{total}</text>
        </svg>
        <div className="flex flex-col gap-1">
          {arcs.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 font-mono text-[9px] text-sc-text-muted">
              <div className="h-1.5 w-1.5 shrink-0" style={{ backgroundColor: a.color, opacity: 0.6 }} />
              <span>{a.label} {a.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── JitterPlot (simple dots, hairline axes) ───────────────────────────────────

function jitter(ci: number, pi: number, v: number): number {
  let h = ((ci * 7919) ^ (pi * 104729) ^ Math.round(v * 1000)) >>> 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b; h = ((h >> 16) ^ h) * 0x45d9f3b; h = (h >> 16) ^ h;
  return (h % 1000) / 500 - 1;
}

export function MinimalJitterPlot({ title, categories, yLabel, yMin, yMax, pointSize }: JitterPlotProps) {
  const W = 280, H = 150, PAD = { t: 8, r: 6, b: 22, l: 32 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const r = pointSize ?? 2;

  const allY = categories.flatMap(c => c.points.map(p => p.value));
  const minY = yMin != null ? yMin : Math.min(...allY);
  const maxY = yMax != null ? yMax : Math.max(...allY);
  const rangeY = maxY - minY || 1;

  const n = categories.length || 1;
  const bandW = plotW / n;
  const jitterW = bandW * 0.25;

  const groupSet = new Set<string>();
  categories.forEach(c => c.points.forEach(p => { if (p.group) groupSet.add(p.group); }));
  const groups = Array.from(groupSet);
  const groupColor = (g: string) => pick(groups.indexOf(g));

  return (
    <div className="w-full space-y-1">
      {title && <h4 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-sc-text-muted">{title}</h4>}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }}>
        {/* Hairline axes */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--sc-text-muted)" strokeOpacity={0.25} strokeWidth={0.5} />
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--sc-text-muted)" strokeOpacity={0.25} strokeWidth={0.5} />

        <text x={PAD.l - 3} y={PAD.t + 3} textAnchor="end" fontSize={6} fontFamily="var(--sc-font-mono, monospace)" fill="var(--sc-text-muted)" fillOpacity={0.5}>{maxY}</text>
        <text x={PAD.l - 3} y={H - PAD.b} textAnchor="end" fontSize={6} fontFamily="var(--sc-font-mono, monospace)" fill="var(--sc-text-muted)" fillOpacity={0.5}>{minY}</text>
        {yLabel && <text x={3} y={H / 2} textAnchor="middle" fontSize={6} fontFamily="var(--sc-font-mono, monospace)" fill="var(--sc-text-muted)" fillOpacity={0.5} transform={`rotate(-90, 3, ${H / 2})`}>{yLabel}</text>}

        {categories.map((cat, ci) => {
          const cx = PAD.l + bandW * ci + bandW / 2;
          return (
            <g key={ci}>
              <text x={cx} y={H - PAD.b + 11} textAnchor="middle" fontSize={6} fontFamily="var(--sc-font-mono, monospace)" fill="var(--sc-text-muted)" fillOpacity={0.5}>{cat.category}</text>
              {cat.points.map((p, pi) => {
                const py = PAD.t + plotH - ((p.value - minY) / rangeY) * plotH;
                const px = cx + jitter(ci, pi, p.value) * jitterW;
                const fill = p.color || (p.group ? groupColor(p.group) : pick(ci));
                return <circle key={pi} cx={px} cy={py} r={r} fill={fill} fillOpacity={0.55} />;
              })}
            </g>
          );
        })}
      </svg>
      {groups.length > 1 && (
        <div className="flex flex-wrap justify-center gap-3">
          {groups.map((g, i) => (
            <div key={g} className="flex items-center gap-1 font-mono text-[8px] text-sc-text-muted">
              <div className="h-1.5 w-1.5" style={{ backgroundColor: groupColor(g), opacity: 0.55 }} />
              {g}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── StatCard (just the number) ────────────────────────────────────────────────

export function MinimalStatCard({ label, value, delta, deltaDirection }: StatCardProps) {
  const deltaColor = deltaDirection === 'up' ? 'var(--sc-success)' : deltaDirection === 'down' ? 'var(--sc-danger)' : 'var(--sc-text-muted)';
  const arrow = deltaDirection === 'up' ? '+' : deltaDirection === 'down' ? '' : '';

  return (
    <div className="p-3">
      <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-sc-text-muted" style={{ opacity: 0.6 }}>{label}</div>
      <div className="mt-0.5 font-mono text-[1.5rem] font-normal leading-tight text-sc-text">{value}</div>
      {delta && (
        <div className="mt-0.5 font-mono text-[9px]" style={{ color: deltaColor, opacity: 0.7 }}>
          {arrow}{delta}
        </div>
      )}
    </div>
  );
}

// ── TableDisplay (borderless, monospace) ──────────────────────────────────────

export function MinimalTableDisplay({ title, columns, rows }: TableDisplayProps) {
  return (
    <div className="w-full space-y-2">
      {title && <h4 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-sc-text-muted">{title}</h4>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[9px]">
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} className="whitespace-nowrap px-2 py-1 text-left font-medium uppercase tracking-[0.1em] text-sc-text-muted" style={{ borderBottom: '1px solid color-mix(in srgb, var(--sc-text-muted) 15%, transparent)', opacity: 0.6 }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {columns.map(c => (
                  <td key={c.key} className="whitespace-nowrap px-2 py-1 text-sc-text" style={{ opacity: 0.8 }}>
                    {row[c.key] != null ? String(row[c.key]) : '—'}
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

// ── ImageDisplay (no frame, just caption) ─────────────────────────────────────

export function MinimalImageDisplay({ url, alt, caption }: ImageDisplayProps) {
  return (
    <div className="w-full text-center">
      <img src={url} alt={alt || 'Visualization'} className="max-w-full" style={{ display: 'block', margin: '0 auto' }} />
      {caption && <p className="mt-1 font-mono text-[8px] text-sc-text-muted" style={{ opacity: 0.6 }}>{caption}</p>}
    </div>
  );
}

// ── Calendar (hairline grid, monospace, ultra-minimal) ──────────────────────

export function MinimalCalendar(props: CalendarProps) {
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
        {title && <h4 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-sc-text-muted">{title}</h4>}
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={prev} className="font-mono text-[10px] text-sc-text-muted hover:text-sc-text px-1">&lsaquo;</button>
          <span className="font-mono text-[9px] text-sc-text-muted min-w-[80px] text-center" style={{ opacity: 0.7 }}>
            {MONTH_NAMES[displayMonth - 1].slice(0, 3)} {displayYear}
          </span>
          <button onClick={next} className="font-mono text-[10px] text-sc-text-muted hover:text-sc-text px-1">&rsaquo;</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0">
        {DAYS_OF_WEEK.map(d => (
          <div key={d} className="text-center font-mono text-[7px] text-sc-text-muted py-0.5" style={{ opacity: 0.5 }}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0" style={{ borderTop: '0.5px solid var(--sc-text-muted)', borderTopColor: 'color-mix(in srgb, var(--sc-text-muted) 15%, transparent)' }}>
        {Array.from({ length: totalCells }, (_, i) => {
          const dayNum = i - startDow + 1;
          const isValid = dayNum >= 1 && dayNum <= daysInMonth;
          if (!isValid) return <div key={i} className="h-[26px]" />;

          const key = dateKey(displayYear, displayMonth, dayNum);
          const data = dayMap.get(key);
          const hasValue = data?.value != null;
          const opacity = hasValue ? quantitativeOpacity(data!.value!, minV, maxV) : 0;

          return (
            <div
              key={i}
              className="h-[26px] flex flex-col items-center justify-center cursor-default"
              style={{
                backgroundColor: hasValue && mode === 'quantitative'
                  ? `color-mix(in srgb, var(--sc-primary) ${Math.round(opacity * 40)}%, transparent)`
                  : undefined,
                border: (data && ((mode === 'quantitative' && data.value) || (mode === 'boolean' && data.done)))
                  ? '1px solid color-mix(in srgb, var(--sc-primary) 30%, transparent)'
                  : undefined,
              }}
              onMouseEnter={data ? (e) => show(data, e) : undefined}
              onMouseLeave={data ? hide : undefined}
            >
              <span className="font-mono text-[8px] text-sc-text-muted" style={{ opacity: 0.6 }}>{dayNum}</span>
              {mode === 'boolean' && (
                <div
                  className="w-[4px] h-[4px] rounded-full mt-0.5"
                  style={{
                    backgroundColor: data?.done ? 'var(--sc-primary)' : 'transparent',
                    opacity: data?.done ? 0.7 : 0,
                  }}
                />
              )}
              {mode === 'quantitative' && hasValue && (
                <span className="font-mono text-[6px] text-sc-text" style={{ opacity: 0.5 }}>
                  {data!.label || data!.value}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {tip && (
        <div
          className="fixed z-50 px-1.5 py-0.5 text-[8px] font-mono pointer-events-none"
          style={{
            left: tip.x, top: tip.y - 4, transform: 'translate(-50%, -100%)',
            backgroundColor: 'var(--sc-background)',
            color: 'var(--sc-text-muted)',
            border: '0.5px solid color-mix(in srgb, var(--sc-text-muted) 20%, transparent)',
          }}
        >
          {tip.day.details || (tip.day.value != null ? `${tip.day.value}${unit ? ` ${unit}` : ''}` : tip.day.done ? 'done' : '—')}
        </div>
      )}
    </div>
  );
}
