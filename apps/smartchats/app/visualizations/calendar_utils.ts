/**
 * Shared calendar utilities — used by Calendar.tsx and all motif implementations.
 * Extracted to avoid circular imports between Calendar and motif files.
 */

import { useState, useCallback } from 'react';
import type { CalendarDay } from './types';

export const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function getMonthGrid(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1);
  const startDow = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
  return { startDow, daysInMonth, totalCells };
}

export function buildDayMap(days: CalendarDay[]): Map<string, CalendarDay> {
  const map = new Map<string, CalendarDay>();
  for (const d of days) map.set(d.date, d);
  return map;
}

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function quantitativeOpacity(value: number, minV: number, maxV: number): number {
  if (maxV === minV) return 0.6;
  return 0.15 + 0.85 * ((value - minV) / (maxV - minV));
}

export function useCalendarNav(initialYear: number, initialMonth: number) {
  const [displayYear, setDisplayYear] = useState(initialYear);
  const [displayMonth, setDisplayMonth] = useState(initialMonth);

  const prev = useCallback(() => {
    setDisplayMonth(m => {
      if (m === 1) { setDisplayYear(y => y - 1); return 12; }
      return m - 1;
    });
  }, []);

  const next = useCallback(() => {
    setDisplayMonth(m => {
      if (m === 12) { setDisplayYear(y => y + 1); return 1; }
      return m + 1;
    });
  }, []);

  return { displayYear, displayMonth, prev, next };
}

export function useTooltip() {
  const [tip, setTip] = useState<{ day: CalendarDay; x: number; y: number } | null>(null);

  const show = useCallback((day: CalendarDay, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ day, x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  const hide = useCallback(() => setTip(null), []);

  return { tip, show, hide };
}
