'use client';

/**
 * Retro motif — dot-matrix / pixel aesthetic.
 * Stepped bar edges, monospace everything, dashed grids, square dots, pixelated feel.
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

// Pixel grid size for the stepped look
const PX = 2;

function snap(v: number): number {
  return Math.round(v / PX) * PX;
}

// ── BarChart (stepped pixel bars) ─────────────────────────────────────────────

export function RetroBarChart({ title, items, unit, yMin, yMax }: BarChartProps) {
  const validValues = items.filter(d => d.value !== null).map(d => d.value as number);
  const min = yMin != null ? yMin : 0;
  const max = yMax != null ? yMax : Math.max(...validValues, 1);
  const range = max - min || 1;

  const minW = items.length * MIN_SLOT_WIDTH;

  return (
    <div className="w-full space-y-2">
      {title && <h4 className="font-mono text-[10px] font-bold uppercase text-sc-text" style={{ letterSpacing: '0.15em' }}>{'> '}{title}</h4>}
      <ScrollableChart>
      <div style={{ minWidth: minW }}>
        <div className="flex items-end justify-between gap-[2px]" style={{ height: 140 }}>
          {items.map((d, i) => {
            if (d.value === null) {
              return (
                <div key={i} className="flex flex-1 flex-col items-center justify-end h-full">
                  <div className="w-full" style={{ borderBottom: `${PX}px dashed var(--sc-text-muted)`, opacity: 0.3 }} />
                </div>
              );
            }
            const pct = ((d.value - min) / range) * 100;
            const barH = snap((pct / 100) * 130);
            return (
              <div key={i} className="flex flex-1 flex-col items-center justify-end h-full">
                <span className="font-mono text-[8px] font-bold text-sc-text-muted mb-0.5">{d.value}{unit || ''}</span>
                <div
                  style={{
                    width: '100%',
                    height: barH,
                    backgroundColor: 'var(--sc-primary)',
                    opacity: 0.8,
                    imageRendering: 'pixelated' as any,
                    borderTop: `${PX}px solid var(--sc-text)`,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div style={{ borderTop: '1px dashed var(--sc-text-muted)', opacity: 0.3, margin: '4px 0' }} />
        <div className="flex justify-between gap-[2px]">
          {items.map((d, i) => (
            <span key={i} className="flex-1 text-center font-mono text-[8px] font-bold uppercase text-sc-text-muted">{d.label}</span>
          ))}
        </div>
      </div>
      </ScrollableChart>
    </div>
  );
}

// ── LineChart (stepped lines, square dots, dashed grid) ───────────────────────

export function RetroLineChart({ title, series, xLabel, yLabel, yMin, yMax, timeMode }: LineChartProps) {
  const numPoints = series[0]?.points.length || 0;
  const W = Math.max(280, numPoints * MIN_SLOT_WIDTH), H = 140, PAD = { t: 10, r: 8, b: 24, l: 34 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;

  const allY = series.flatMap(s => s.points.map(p => p.y)).filter((y): y is number => y !== null);
  const minY = yMin != null ? yMin : Math.min(...allY);
  const maxY = yMax != null ? yMax : Math.max(...allY);
  const rangeY = maxY - minY || 1;

  const dateRng = timeMode === 'dense' ? getDateRange(series[0]?.points || []) : undefined;

  // Horizontal dashed grid
  const gridCount = 4;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const val = minY + (rangeY / gridCount) * i;
    const y = snap(PAD.t + plotH - ((val - minY) / rangeY) * plotH);
    return { val: Math.round(val), y };
  });

  return (
    <div className="w-full space-y-1">
      {title && <h4 className="font-mono text-[10px] font-bold uppercase text-sc-text" style={{ letterSpacing: '0.15em' }}>{'> '}{title}</h4>}
      <ScrollableChart>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto', shapeRendering: 'crispEdges', minWidth: W }}>
        {/* Dashed grid */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={g.y} x2={W - PAD.r} y2={g.y} stroke="var(--sc-text-muted)" strokeOpacity={0.15} strokeWidth={1} strokeDasharray="4 4" />
            <text x={PAD.l - 3} y={g.y + 3} textAnchor="end" fontSize={7} fontFamily="var(--sc-font-mono, monospace)" fontWeight="bold" fill="var(--sc-text-muted)" fillOpacity={0.5}>{g.val}</text>
          </g>
        ))}

        {/* Axes — solid */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--sc-text-muted)" strokeOpacity={0.4} strokeWidth={1} />
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--sc-text-muted)" strokeOpacity={0.4} strokeWidth={1} />

        {yLabel && <text x={4} y={H / 2} textAnchor="middle" fontSize={7} fontFamily="var(--sc-font-mono, monospace)" fontWeight="bold" fill="var(--sc-text-muted)" fillOpacity={0.5} transform={`rotate(-90, 4, ${H / 2})`}>{yLabel}</text>}

        {series.map((s, si) => {
          const color = pick(si, s.color);
          const pts = s.points.map((p, pi) => {
            const sx = snap(computeXPosition(pi, s.points.length, plotW, PAD.l, timeMode, p._date, dateRng));
            const sy = p.y !== null ? snap(PAD.t + plotH - ((p.y - minY) / rangeY) * plotH) : 0;
            return { sx, sy, p };
          });

          const gapSegments = timeMode === 'dense'
            ? [pts.filter(pt => pt.p.y !== null)]
            : splitAtGaps(pts);
          return (
            <g key={si}>
              {gapSegments.map((seg, segI) => {
                // Stepped line: horizontal then vertical segments
                const pathParts: string[] = [];
                seg.forEach((pt, i) => {
                  if (i === 0) { pathParts.push(`M ${pt.sx} ${pt.sy}`); return; }
                  const prev = seg[i - 1];
                  pathParts.push(`L ${pt.sx} ${prev.sy}`);
                  pathParts.push(`L ${pt.sx} ${pt.sy}`);
                });
                return <path key={segI} d={pathParts.join(' ')} fill="none" stroke={color} strokeWidth={PX} strokeOpacity={0.85} />;
              })}
              {/* Square dots (only non-null) */}
              {pts.filter(pt => pt.p.y !== null).map((pt, pi) => (
                <rect key={pi} x={pt.sx - 2.5} y={pt.sy - 2.5} width={5} height={5} fill={color} />
              ))}
            </g>
          );
        })}

        {/* X labels */}
        {series[0]?.points.length > 0 && (
          <>
            <text x={PAD.l} y={H - PAD.b + 13} textAnchor="start" fontSize={7} fontFamily="var(--sc-font-mono, monospace)" fontWeight="bold" fill="var(--sc-text-muted)" fillOpacity={0.5}>{String(series[0].points[0].x)}</text>
            <text x={W - PAD.r} y={H - PAD.b + 13} textAnchor="end" fontSize={7} fontFamily="var(--sc-font-mono, monospace)" fontWeight="bold" fill="var(--sc-text-muted)" fillOpacity={0.5}>{String(series[0].points[series[0].points.length - 1].x)}</text>
          </>
        )}
        {xLabel && <text x={W / 2} y={H - 2} textAnchor="middle" fontSize={7} fontFamily="var(--sc-font-mono, monospace)" fontWeight="bold" fill="var(--sc-text-muted)" fillOpacity={0.5}>{xLabel}</text>}
      </svg>
      </ScrollableChart>
      {series.length > 1 && (
        <div className="flex flex-wrap justify-center gap-3">
          {series.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 font-mono text-[8px] font-bold text-sc-text-muted">
              <div className="h-[5px] w-[5px]" style={{ backgroundColor: pick(i, s.color) }} />
              {s.label || `S${i + 1}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PieChart (segmented ring with gaps, blocky legend) ────────────────────────

export function RetroPieChart({ title, slices }: PieChartProps) {
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  const R = 46, IR = 30, CX = 60, CY = 56;
  const GAP = 0.03; // radians gap between slices
  let cumAngle = -Math.PI / 2;

  const arcs = slices.map((s, i) => {
    const angle = (s.value / total) * 2 * Math.PI;
    const startAngle = cumAngle + GAP / 2;
    const endAngle = cumAngle + angle - GAP / 2;
    cumAngle += angle;
    const largeArc = (endAngle - startAngle) > Math.PI ? 1 : 0;
    const ox1 = CX + R * Math.cos(startAngle), oy1 = CY + R * Math.sin(startAngle);
    const ox2 = CX + R * Math.cos(endAngle), oy2 = CY + R * Math.sin(endAngle);
    const ix1 = CX + IR * Math.cos(endAngle), iy1 = CY + IR * Math.sin(endAngle);
    const ix2 = CX + IR * Math.cos(startAngle), iy2 = CY + IR * Math.sin(startAngle);
    const d = `M ${ox1} ${oy1} A ${R} ${R} 0 ${largeArc} 1 ${ox2} ${oy2} L ${ix1} ${iy1} A ${IR} ${IR} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
    return { d, color: pick(i, s.color), label: s.label, pct: Math.round((s.value / total) * 100) };
  });

  return (
    <div className="w-full space-y-1">
      {title && <h4 className="font-mono text-[10px] font-bold uppercase text-sc-text" style={{ letterSpacing: '0.15em' }}>{'> '}{title}</h4>}
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 120 112" className="w-[110px] shrink-0" style={{ height: 'auto', shapeRendering: 'crispEdges' }}>
          {arcs.map((a, i) => (
            <path key={i} d={a.d} fill={a.color} fillOpacity={0.75} stroke="var(--sc-background)" strokeWidth={2} />
          ))}
        </svg>
        <div className="flex flex-col gap-1">
          {arcs.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 font-mono text-[9px] font-bold text-sc-text-muted">
              <div className="h-[6px] w-[6px]" style={{ backgroundColor: a.color, opacity: 0.75 }} />
              <span>{a.label} [{a.pct}%]</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── JitterPlot (square dots, dashed grid) ─────────────────────────────────────

function jitter(ci: number, pi: number, v: number): number {
  let h = ((ci * 7919) ^ (pi * 104729) ^ Math.round(v * 1000)) >>> 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b; h = ((h >> 16) ^ h) * 0x45d9f3b; h = (h >> 16) ^ h;
  return (h % 1000) / 500 - 1;
}

export function RetroJitterPlot({ title, categories, yLabel, yMin, yMax, pointSize }: JitterPlotProps) {
  const W = 280, H = 160, PAD = { t: 10, r: 8, b: 24, l: 34 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const s = pointSize ?? 4;

  const allY = categories.flatMap(c => c.points.map(p => p.value));
  const minY = yMin != null ? yMin : Math.min(...allY);
  const maxY = yMax != null ? yMax : Math.max(...allY);
  const rangeY = maxY - minY || 1;

  const n = categories.length || 1;
  const bandW = plotW / n;
  const jitterW = bandW * 0.3;

  const groupSet = new Set<string>();
  categories.forEach(c => c.points.forEach(p => { if (p.group) groupSet.add(p.group); }));
  const groups = Array.from(groupSet);
  const groupColor = (g: string) => pick(groups.indexOf(g));

  return (
    <div className="w-full space-y-1">
      {title && <h4 className="font-mono text-[10px] font-bold uppercase text-sc-text" style={{ letterSpacing: '0.15em' }}>{'> '}{title}</h4>}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto', shapeRendering: 'crispEdges' }}>
        {/* Dashed grid */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--sc-text-muted)" strokeOpacity={0.4} strokeWidth={1} />
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--sc-text-muted)" strokeOpacity={0.4} strokeWidth={1} />

        {/* Horizontal dashed guides */}
        {[0.25, 0.5, 0.75].map((frac, i) => {
          const y = snap(PAD.t + plotH * (1 - frac));
          return <line key={i} x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="var(--sc-text-muted)" strokeOpacity={0.12} strokeWidth={1} strokeDasharray="4 4" />;
        })}

        <text x={PAD.l - 3} y={PAD.t + 4} textAnchor="end" fontSize={7} fontFamily="var(--sc-font-mono, monospace)" fontWeight="bold" fill="var(--sc-text-muted)" fillOpacity={0.5}>{maxY}</text>
        <text x={PAD.l - 3} y={H - PAD.b} textAnchor="end" fontSize={7} fontFamily="var(--sc-font-mono, monospace)" fontWeight="bold" fill="var(--sc-text-muted)" fillOpacity={0.5}>{minY}</text>
        {yLabel && <text x={4} y={H / 2} textAnchor="middle" fontSize={7} fontFamily="var(--sc-font-mono, monospace)" fontWeight="bold" fill="var(--sc-text-muted)" fillOpacity={0.5} transform={`rotate(-90, 4, ${H / 2})`}>{yLabel}</text>}

        {categories.map((cat, ci) => {
          const cx = PAD.l + bandW * ci + bandW / 2;
          return (
            <g key={ci}>
              {/* Vertical dashed separator */}
              {ci > 0 && <line x1={cx - bandW / 2} y1={PAD.t} x2={cx - bandW / 2} y2={H - PAD.b} stroke="var(--sc-text-muted)" strokeOpacity={0.08} strokeWidth={1} strokeDasharray="2 4" />}
              <text x={cx} y={H - PAD.b + 13} textAnchor="middle" fontSize={7} fontFamily="var(--sc-font-mono, monospace)" fontWeight="bold" fill="var(--sc-text-muted)" fillOpacity={0.5}>{cat.category}</text>
              {/* Square dots */}
              {cat.points.map((p, pi) => {
                const py = snap(PAD.t + plotH - ((p.value - minY) / rangeY) * plotH);
                const px = snap(cx + jitter(ci, pi, p.value) * jitterW);
                const fill = p.color || (p.group ? groupColor(p.group) : pick(ci));
                return <rect key={pi} x={px - s / 2} y={py - s / 2} width={s} height={s} fill={fill} fillOpacity={0.7} />;
              })}
            </g>
          );
        })}
      </svg>
      {groups.length > 1 && (
        <div className="flex flex-wrap justify-center gap-3">
          {groups.map((g, i) => (
            <div key={g} className="flex items-center gap-1.5 font-mono text-[8px] font-bold text-sc-text-muted">
              <div className="h-[5px] w-[5px]" style={{ backgroundColor: groupColor(g), opacity: 0.7 }} />
              {g}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── StatCard (terminal-style readout) ─────────────────────────────────────────

export function RetroStatCard({ label, value, delta, deltaDirection }: StatCardProps) {
  const deltaColor = deltaDirection === 'up' ? 'var(--sc-success)' : deltaDirection === 'down' ? 'var(--sc-danger)' : 'var(--sc-text-muted)';
  const arrow = deltaDirection === 'up' ? '▲' : deltaDirection === 'down' ? '▼' : '■';

  return (
    <div
      className="p-3 font-mono"
      style={{
        border: '1px solid color-mix(in srgb, var(--sc-primary) 30%, transparent)',
        background: 'color-mix(in srgb, var(--sc-primary) 4%, transparent)',
      }}
    >
      <div className="text-[8px] font-bold uppercase tracking-[0.2em] text-sc-text-muted">[{label}]</div>
      <div className="mt-0.5 text-[1.5rem] font-bold leading-tight" style={{ color: 'var(--sc-primary)' }}>{value}</div>
      {delta && (
        <div className="mt-0.5 text-[9px] font-bold" style={{ color: deltaColor }}>
          {arrow} {delta}
        </div>
      )}
    </div>
  );
}

// ── TableDisplay (bordered, terminal-style) ───────────────────────────────────

export function RetroTableDisplay({ title, columns, rows }: TableDisplayProps) {
  return (
    <div className="w-full space-y-1">
      {title && <h4 className="font-mono text-[10px] font-bold uppercase text-sc-text" style={{ letterSpacing: '0.15em' }}>{'> '}{title}</h4>}
      <div className="overflow-x-auto" style={{ border: '1px solid color-mix(in srgb, var(--sc-text-muted) 25%, transparent)' }}>
        <table className="w-full border-collapse font-mono text-[9px]">
          <thead>
            <tr>
              {columns.map(c => (
                <th
                  key={c.key}
                  className="whitespace-nowrap px-2 py-1 text-left font-bold uppercase"
                  style={{
                    color: 'var(--sc-primary)',
                    borderBottom: '1px solid color-mix(in srgb, var(--sc-text-muted) 25%, transparent)',
                    borderRight: '1px solid color-mix(in srgb, var(--sc-text-muted) 12%, transparent)',
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {columns.map((c, ci) => (
                  <td
                    key={c.key}
                    className="whitespace-nowrap px-2 py-1 text-sc-text"
                    style={{
                      borderBottom: ri < rows.length - 1 ? '1px solid color-mix(in srgb, var(--sc-text-muted) 10%, transparent)' : 'none',
                      borderRight: ci < columns.length - 1 ? '1px solid color-mix(in srgb, var(--sc-text-muted) 10%, transparent)' : 'none',
                    }}
                  >
                    {row[c.key] != null ? String(row[c.key]) : '---'}
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

// ── ImageDisplay (scanline overlay) ───────────────────────────────────────────

export function RetroImageDisplay({ url, alt, caption }: ImageDisplayProps) {
  return (
    <div className="w-full text-center">
      <div className="relative inline-block overflow-hidden" style={{ border: '1px solid color-mix(in srgb, var(--sc-primary) 30%, transparent)' }}>
        <img src={url} alt={alt || 'Visualization'} className="max-w-full" style={{ display: 'block', filter: 'contrast(1.05) saturate(0.85)' }} />
        {/* Scanline overlay */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)',
            mixBlendMode: 'multiply',
          }}
        />
      </div>
      {caption && <p className="mt-1 font-mono text-[8px] font-bold uppercase text-sc-text-muted" style={{ letterSpacing: '0.1em' }}>{'// '}{caption}</p>}
    </div>
  );
}

// ── Calendar (dashed borders, square markers, terminal style) ───────────────

export function RetroCalendar(props: CalendarProps) {
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
        {title && <h4 className="font-mono text-[10px] font-bold uppercase text-sc-text" style={{ letterSpacing: '0.15em' }}>{'> '}{title}</h4>}
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={prev} className="font-mono text-[10px] font-bold text-sc-text-muted hover:text-sc-primary px-1">[&lt;]</button>
          <span className="font-mono text-[9px] font-bold text-sc-text-muted min-w-[80px] text-center">
            {MONTH_NAMES[displayMonth - 1].toUpperCase().slice(0, 3)} {displayYear}
          </span>
          <button onClick={next} className="font-mono text-[10px] font-bold text-sc-text-muted hover:text-sc-primary px-1">[&gt;]</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0" style={{ border: '1px dashed var(--sc-text-muted)', borderColor: 'color-mix(in srgb, var(--sc-text-muted) 30%, transparent)' }}>
        {DAYS_OF_WEEK.map(d => (
          <div
            key={d}
            className="text-center font-mono text-[7px] font-bold text-sc-text-muted py-1"
            style={{ borderBottom: '1px dashed color-mix(in srgb, var(--sc-text-muted) 30%, transparent)' }}
          >
            {d.toUpperCase()}
          </div>
        ))}

        {Array.from({ length: totalCells }, (_, i) => {
          const dayNum = i - startDow + 1;
          const isValid = dayNum >= 1 && dayNum <= daysInMonth;
          if (!isValid) {
            return (
              <div
                key={i}
                className="h-[28px]"
                style={{ borderRight: i % 7 < 6 ? '1px dashed color-mix(in srgb, var(--sc-text-muted) 15%, transparent)' : undefined }}
              />
            );
          }

          const key = dateKey(displayYear, displayMonth, dayNum);
          const data = dayMap.get(key);
          const hasValue = data?.value != null;
          const opacity = hasValue ? quantitativeOpacity(data!.value!, minV, maxV) : 0;

          return (
            <div
              key={i}
              className="h-[28px] flex flex-col items-center justify-center cursor-default"
              style={{
                borderRight: i % 7 < 6 ? '1px dashed color-mix(in srgb, var(--sc-text-muted) 15%, transparent)' : undefined,
                borderBottom: i < totalCells - 7 ? '1px dashed color-mix(in srgb, var(--sc-text-muted) 15%, transparent)' : undefined,
                backgroundColor: hasValue && mode === 'quantitative'
                  ? `color-mix(in srgb, var(--sc-primary) ${Math.round(opacity * 35)}%, transparent)`
                  : undefined,
                outline: (data && ((mode === 'quantitative' && data.value) || (mode === 'boolean' && data.done)))
                  ? '1px solid color-mix(in srgb, var(--sc-primary) 40%, transparent)'
                  : undefined,
              }}
              onMouseEnter={data ? (e) => show(data, e) : undefined}
              onMouseLeave={data ? hide : undefined}
            >
              <span className="font-mono text-[7px] font-bold text-sc-text-muted">{String(dayNum).padStart(2, '0')}</span>
              {mode === 'boolean' && (
                <div
                  className="mt-0.5"
                  style={{
                    width: 5, height: 5,
                    backgroundColor: data?.done ? 'var(--sc-primary)' : 'transparent',
                    border: data?.done ? 'none' : '1px solid color-mix(in srgb, var(--sc-text-muted) 30%, transparent)',
                  }}
                />
              )}
              {mode === 'quantitative' && hasValue && (
                <span className="font-mono text-[6px] font-bold" style={{ color: 'var(--sc-primary)', opacity: 0.8 }}>
                  {data!.label || data!.value}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {tip && (
        <div
          className="fixed z-50 px-1.5 py-0.5 font-mono text-[8px] font-bold pointer-events-none"
          style={{
            left: tip.x, top: tip.y - 4, transform: 'translate(-50%, -100%)',
            backgroundColor: 'var(--sc-background)',
            color: 'var(--sc-primary)',
            border: '1px solid color-mix(in srgb, var(--sc-primary) 40%, transparent)',
          }}
        >
          [{tip.day.details || (tip.day.value != null ? `${tip.day.value}${unit ? ` ${unit}` : ''}` : tip.day.done ? 'DONE' : '---')}]
        </div>
      )}
    </div>
  );
}
