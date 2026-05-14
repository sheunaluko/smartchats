'use client';

/**
 * Dev-only gallery page: /dev/viz-gallery
 * Renders all visualization components with mock data for visual comparison.
 * No auth, no store, no agent — just pure component rendering.
 */

import React, { useState } from 'react';
import { useVizMotif } from '../../../core/VizMotifContext';

import { BarChart, LineChart, PieChart, StatCard, TableDisplay, ImageDisplay, JitterPlot } from '../../visualizations/charts';
import { Calendar } from '../../visualizations/Calendar';
import { VisualizationRenderer } from '../../visualizations/VisualizationRenderer';
import type { Visualization } from '../../visualizations/types';

// ── Mock data ──────────────────────────────────────────────────────────────────

const MOCK_BAR_ITEMS = [
  { label: 'Mon', value: 3.2 },
  { label: 'Tue', value: 5.1 },
  { label: 'Wed', value: 2.8 },
  { label: 'Thu', value: 6.4 },
  { label: 'Fri', value: 4.7 },
  { label: 'Sat', value: 8.1 },
  { label: 'Sun', value: 3.9 },
];

const MOCK_LINE_SERIES = [
  {
    label: 'Heart Rate',
    points: [
      { x: '6am', y: 62 }, { x: '8am', y: 74 }, { x: '10am', y: 85 },
      { x: '12pm', y: 78 }, { x: '2pm', y: 92 }, { x: '4pm', y: 71 }, { x: '6pm', y: 68 },
    ],
  },
  {
    label: 'Resting',
    points: [
      { x: '6am', y: 60 }, { x: '8am', y: 61 }, { x: '10am', y: 62 },
      { x: '12pm', y: 61 }, { x: '2pm', y: 63 }, { x: '4pm', y: 60 }, { x: '6pm', y: 59 },
    ],
    color: 'var(--sc-warning, #f59e0b)',
  },
];

const MOCK_PIE_SLICES = [
  { label: 'Running', value: 42 },
  { label: 'Cycling', value: 28 },
  { label: 'Swimming', value: 15 },
  { label: 'Weights', value: 10 },
  { label: 'Other', value: 5 },
];

const MOCK_TABLE_COLS = [
  { key: 'date', label: 'Date' },
  { key: 'activity', label: 'Activity' },
  { key: 'distance', label: 'Distance' },
  { key: 'duration', label: 'Duration' },
  { key: 'pace', label: 'Pace' },
];

const MOCK_TABLE_ROWS = [
  { date: 'Mar 17', activity: 'Run', distance: '5.2 km', duration: '28:14', pace: '5:26/km' },
  { date: 'Mar 15', activity: 'Run', distance: '8.1 km', duration: '42:33', pace: '5:15/km' },
  { date: 'Mar 14', activity: 'Bike', distance: '22.4 km', duration: '55:10', pace: '--' },
  { date: 'Mar 12', activity: 'Run', distance: '3.0 km', duration: '16:45', pace: '5:35/km' },
];

const MOCK_JITTER_CATEGORIES = [
  {
    category: 'Mon',
    points: [
      { value: 72, group: 'resting' }, { value: 145, group: 'exercise' },
      { value: 68, group: 'resting' }, { value: 130, group: 'exercise' },
    ],
  },
  {
    category: 'Tue',
    points: [
      { value: 65, group: 'resting' }, { value: 152, group: 'exercise' },
      { value: 70, group: 'resting' },
    ],
  },
  {
    category: 'Wed',
    points: [
      { value: 74, group: 'resting' }, { value: 138, group: 'exercise' },
      { value: 71, group: 'resting' }, { value: 160, group: 'exercise' },
    ],
  },
  {
    category: 'Thu',
    points: [
      { value: 67, group: 'resting' }, { value: 142, group: 'exercise' },
    ],
  },
  {
    category: 'Fri',
    points: [
      { value: 69, group: 'resting' }, { value: 155, group: 'exercise' },
      { value: 73, group: 'resting' }, { value: 148, group: 'exercise' },
      { value: 62, group: 'resting' },
    ],
  },
];

// ── Dense mode mock data (line chart with gaps) ─────────────────────────────

const MOCK_DENSE_LINE_SERIES = [
  {
    label: 'Weight',
    points: [
      { x: 'Mar 1', y: 82.1, _date: '2026-03-01' },
      { x: 'Mar 2', y: 81.8, _date: '2026-03-02' },
      { x: 'Mar 3', y: null as number | null, _date: '2026-03-03' },
      { x: 'Mar 4', y: null as number | null, _date: '2026-03-04' },
      { x: 'Mar 5', y: 81.5, _date: '2026-03-05' },
      { x: 'Mar 6', y: 81.3, _date: '2026-03-06' },
      { x: 'Mar 7', y: null as number | null, _date: '2026-03-07' },
      { x: 'Mar 8', y: 80.9, _date: '2026-03-08' },
      { x: 'Mar 9', y: 80.7, _date: '2026-03-09' },
      { x: 'Mar 10', y: 80.5, _date: '2026-03-10' },
    ],
  },
];

const MOCK_DENSE_BAR_ITEMS = [
  { label: 'Mon', value: 3.2 as number | null, _date: '2026-03-02' },
  { label: 'Tue', value: null as number | null, _date: '2026-03-03' },
  { label: 'Wed', value: 2.8 as number | null, _date: '2026-03-04' },
  { label: 'Thu', value: null as number | null, _date: '2026-03-05' },
  { label: 'Fri', value: null as number | null, _date: '2026-03-06' },
  { label: 'Sat', value: 8.1 as number | null, _date: '2026-03-07' },
  { label: 'Sun', value: 3.9 as number | null, _date: '2026-03-08' },
];

// ── Calendar mock data ───────────────────────────────────────────────────────

const MOCK_CALENDAR_BOOLEAN = [
  { date: '2026-04-01', done: true },
  { date: '2026-04-02', done: true },
  { date: '2026-04-03', done: true },
  { date: '2026-04-04', done: false },
  { date: '2026-04-05', done: true },
  { date: '2026-04-06', done: true },
  { date: '2026-04-07', done: false },
  { date: '2026-04-08', done: true },
  { date: '2026-04-09', done: true },
  { date: '2026-04-10', done: true },
  { date: '2026-04-11', done: true },
  { date: '2026-04-12', done: false },
  { date: '2026-04-13', done: true },
  { date: '2026-04-14', done: true },
  { date: '2026-04-15', done: true },
  { date: '2026-04-16', done: false },
  { date: '2026-04-17', done: true },
  { date: '2026-04-18', done: true },
  { date: '2026-04-19', done: true },
  { date: '2026-04-20', done: true },
  { date: '2026-04-21', done: false },
  { date: '2026-04-22', done: true },
  { date: '2026-04-23', done: true },
  { date: '2026-04-24', done: true },
  { date: '2026-04-25', done: false },
  { date: '2026-04-26', done: true },
  { date: '2026-04-27', done: true },
  { date: '2026-04-28', done: true },
  { date: '2026-04-29', done: true },
  { date: '2026-04-30', done: true },
];

const MOCK_CALENDAR_QUANTITATIVE = [
  { date: '2026-04-01', value: 8234, label: '8.2k' },
  { date: '2026-04-02', value: 5102, label: '5.1k' },
  { date: '2026-04-03', value: 12045, label: '12k' },
  { date: '2026-04-04', value: 3200, label: '3.2k' },
  { date: '2026-04-05', value: 9800, label: '9.8k' },
  { date: '2026-04-06', value: 7600, label: '7.6k' },
  { date: '2026-04-07', value: 2100, label: '2.1k' },
  { date: '2026-04-08', value: 10500, label: '10.5k' },
  { date: '2026-04-09', value: 6700, label: '6.7k' },
  { date: '2026-04-10', value: 11200, label: '11.2k' },
  { date: '2026-04-11', value: 4500, label: '4.5k' },
  { date: '2026-04-12', value: 8900, label: '8.9k' },
  { date: '2026-04-13', value: 15000, label: '15k' },
  { date: '2026-04-14', value: 3800, label: '3.8k' },
  { date: '2026-04-15', value: 7200, label: '7.2k' },
  { date: '2026-04-16', value: 9100, label: '9.1k' },
  { date: '2026-04-17', value: 5600, label: '5.6k' },
  { date: '2026-04-18', value: 11800, label: '11.8k' },
  { date: '2026-04-19', value: 4200, label: '4.2k' },
  { date: '2026-04-20', value: 6300, label: '6.3k' },
  { date: '2026-04-21', value: 1800, label: '1.8k' },
  { date: '2026-04-22', value: 9500, label: '9.5k' },
  { date: '2026-04-23', value: 7800, label: '7.8k' },
  { date: '2026-04-24', value: 10200, label: '10.2k' },
  { date: '2026-04-25', value: 5400, label: '5.4k' },
  { date: '2026-04-26', value: 13500, label: '13.5k' },
  { date: '2026-04-27', value: 8100, label: '8.1k' },
  { date: '2026-04-28', value: 6900, label: '6.9k' },
  { date: '2026-04-29', value: 4100, label: '4.1k' },
  { date: '2026-04-30', value: 7500, label: '7.5k' },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--sc-text)', marginBottom: 12, borderBottom: '1px solid var(--sc-border, rgba(255,255,255,0.1))', paddingBottom: 6 }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

// ── Gallery page ───────────────────────────────────────────────────────────────

export default function VizGalleryPage() {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const dismiss = (id: string) => setDismissed(prev => new Set(prev).add(id));
  const { motifId, setMotif, availableMotifs } = useVizMotif();

  return (
    <div style={{ minHeight: '100dvh', backgroundColor: 'var(--sc-background, #0a0a1a)', padding: '16px', maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--sc-text)', marginBottom: 8 }}>
        Visualization Gallery
      </h1>
      <p style={{ fontSize: 12, color: 'var(--sc-text-muted)', marginBottom: 12 }}>
        All visualization components with mock data. Toggle motif to compare treatments.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Motif</span>
        {availableMotifs.map(id => (
          <button
            key={id}
            onClick={() => setMotif(id)}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: 6,
              border: `1px solid ${id === motifId ? 'var(--sc-primary)' : 'var(--sc-separator)'}`,
              background: id === motifId ? 'color-mix(in srgb, var(--sc-primary) 15%, transparent)' : 'transparent',
              color: id === motifId ? 'var(--sc-primary)' : 'var(--sc-text-muted)',
              cursor: 'pointer',
              transition: 'all 150ms',
            }}
          >
            {id}
          </button>
        ))}
      </div>

      <Section title="Dense Mode (Gaps)">
        <Card label="Line Chart — Dense (gaps visible)">
          <LineChart title="Weight Tracking (dense)" series={MOCK_DENSE_LINE_SERIES} yLabel="kg" timeMode="dense" />
        </Card>

        <Card label="Line Chart — Sparse (same data, no gaps)">
          <LineChart
            title="Weight Tracking (sparse)"
            series={[{ label: 'Weight', points: MOCK_DENSE_LINE_SERIES[0].points.filter(p => p.y !== null) }]}
            yLabel="kg"
          />
        </Card>

        <Card label="Bar Chart — Dense (gaps visible)">
          <BarChart title="Running Distance (dense)" items={MOCK_DENSE_BAR_ITEMS} unit=" km" timeMode="dense" />
        </Card>
      </Section>

      <Section title="Calendar">
        <Card label="Calendar — Boolean (Habit Tracker)">
          <Calendar title="Meditation" year={2026} month={4} days={MOCK_CALENDAR_BOOLEAN} mode="boolean" />
        </Card>

        <Card label="Calendar — Quantitative (Steps Heatmap)">
          <Calendar title="Daily Steps" year={2026} month={4} days={MOCK_CALENDAR_QUANTITATIVE} mode="quantitative" unit="steps" />
        </Card>
      </Section>

      <Section title="Charts">
        <Card label="Bar Chart">
          <BarChart title="Weekly Running Distance" items={MOCK_BAR_ITEMS} unit=" km" />
        </Card>

        <Card label="Line Chart">
          <LineChart title="Heart Rate Over Day" series={MOCK_LINE_SERIES} yLabel="bpm" />
        </Card>

        <Card label="Pie Chart">
          <PieChart title="Activity Breakdown" slices={MOCK_PIE_SLICES} />
        </Card>

        <Card label="Jitter Plot">
          <JitterPlot title="Heart Rate by Day" categories={MOCK_JITTER_CATEGORIES} yLabel="bpm" yMin={50} yMax={180} />
        </Card>

        <Card label="Stat Card">
          <StatCard label="Weekly Mileage" value="42.3 km" delta="+12% from last week" deltaDirection="up" />
        </Card>

        <Card label="Stat Card (down)">
          <StatCard label="Avg Pace" value="5:26/km" delta="-3% slower" deltaDirection="down" />
        </Card>

        <Card label="Table">
          <TableDisplay title="Recent Runs" columns={MOCK_TABLE_COLS} rows={MOCK_TABLE_ROWS} />
        </Card>

        <Card label="Image">
          <ImageDisplay url="https://placehold.co/400x200/1a1a2e/e0e0e0?text=Activity+Heatmap" caption="Your activity heatmap" />
        </Card>

        <Card label="VisualizationRenderer (as used in shell)">
          {!dismissed.has('renderer-bar') ? (
            <VisualizationRenderer
              viz={{ type: 'bar_chart', props: { title: 'Via Renderer', items: MOCK_BAR_ITEMS.slice(0, 4), unit: ' km' } }}
              onDismiss={() => dismiss('renderer-bar')}
            />
          ) : (
            <div style={{ fontSize: 11, color: 'var(--sc-text-muted)', padding: 8 }}>Dismissed. <button onClick={() => setDismissed(prev => { const n = new Set(prev); n.delete('renderer-bar'); return n; })} style={{ color: 'var(--sc-primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Restore</button></div>
          )}
        </Card>
      </Section>
    </div>
  );
}
