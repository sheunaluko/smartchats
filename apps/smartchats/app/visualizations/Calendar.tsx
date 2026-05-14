'use client';

/**
 * Calendar visualization — month grid with boolean (done/not-done) or
 * quantitative (heatmap) display. Supports month navigation via arrows.
 * Motif-dispatched like all other chart components.
 */

import React from 'react';
import type { CalendarProps } from './types';
import { useVizMotif } from '../../core/VizMotifContext';
import { GlassCalendar } from './glass_motif';
import { MinimalCalendar } from './minimal_motif';
import { RetroCalendar } from './retro_motif';
import {
  DAYS_OF_WEEK, MONTH_NAMES,
  getMonthGrid, buildDayMap, dateKey, quantitativeOpacity,
  useCalendarNav, useTooltip,
} from './calendar_utils';

// ── Classic Calendar ──────────────────────────────────────────────────────────

function ClassicCalendar(props: CalendarProps) {
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
      {/* Header — pr-8 leaves room for the dismiss X button in VisualizationRenderer */}
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

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-[2px]">
        {DAYS_OF_WEEK.map(d => (
          <div key={d} className="text-center text-[8px] font-medium text-sc-text-muted py-0.5">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-[2px]">
        {Array.from({ length: totalCells }, (_, i) => {
          const dayNum = i - startDow + 1;
          const isValid = dayNum >= 1 && dayNum <= daysInMonth;
          if (!isValid) return <div key={i} className="h-[30px]" />;

          const key = dateKey(displayYear, displayMonth, dayNum);
          const data = dayMap.get(key);

          return (
            <div
              key={i}
              className="h-[30px] flex flex-col items-center justify-center rounded-md relative cursor-default transition-colors"
              style={{
                backgroundColor: data && mode === 'quantitative' && data.value != null
                  ? `color-mix(in srgb, var(--sc-primary) ${Math.round(quantitativeOpacity(data.value, minV, maxV) * 100)}%, transparent)`
                  : undefined,
                border: (data && ((mode === 'quantitative' && data.value) || (mode === 'boolean' && data.done)))
                  ? '1px solid color-mix(in srgb, var(--sc-primary) 40%, transparent)'
                  : undefined,
              }}
              onMouseEnter={data ? (e) => show(data, e) : undefined}
              onMouseLeave={data ? hide : undefined}
            >
              <span className="text-[9px] text-sc-text-muted">{dayNum}</span>
              {mode === 'boolean' && (
                <div
                  className="w-[6px] h-[6px] rounded-full mt-0.5"
                  style={{
                    backgroundColor: data?.done ? 'var(--sc-primary)' : 'transparent',
                    border: data?.done ? 'none' : '1px solid var(--sc-separator)',
                  }}
                />
              )}
              {mode === 'quantitative' && data?.value != null && (
                <span className="text-[7px] font-mono text-sc-text" style={{ opacity: 0.8 }}>
                  {data.label || data.value}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Tooltip */}
      {tip && (
        <div
          className="fixed z-50 px-2 py-1 rounded-md text-[9px] bg-sc-surface-secondary text-sc-text shadow-lg pointer-events-none"
          style={{ left: tip.x, top: tip.y - 4, transform: 'translate(-50%, -100%)' }}
        >
          {tip.day.details || (tip.day.value != null ? `${tip.day.value}${unit ? ` ${unit}` : ''}` : tip.day.done ? 'Done' : 'Not done')}
        </div>
      )}
    </div>
  );
}

// ── Main export with motif dispatch ───────────────────────────────────────────

export function Calendar(props: CalendarProps) {
  const { motifId } = useVizMotif();
  if (motifId === 'glass') return <GlassCalendar {...props} />;
  if (motifId === 'minimal') return <MinimalCalendar {...props} />;
  if (motifId === 'retro') return <RetroCalendar {...props} />;
  return <ClassicCalendar {...props} />;
}
