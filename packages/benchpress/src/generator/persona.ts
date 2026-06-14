/**
 * Deterministic persona generator for benchpress.
 *
 * Same seed → same Seed object → same .surql file → same truths.
 *
 * The Seed shape mirrors the SurrealDB tables benchpress writes into
 * (logs, metrics, user_entities, user_relations, user_data). Each row carries
 * the event-time triple (ts / local_date / local_tz) required by the schema.
 *
 * Deliberately biased properties (so scenarios have unambiguous answers):
 *   - 2025-08 is the worst sleep:workout-ratio month (HARD-1 ground truth)
 *   - No tennis logs anywhere (q07 negative case)
 *   - No "Moby Dick" entity in the KG (would also be a negative case)
 *   - "Dune" exists as a book entity with a defined baseline page count
 *     (q08 multi-turn mutation test)
 *
 * Embeddings are intentionally omitted — none of the v1 scenarios need
 * semantic search. The schema's HNSW indexes simply don't include rows
 * whose embedding field is absent.
 */
import type { EventTimeFields } from '../types.js';
import { makeRng, type Rng } from './rng.js';
import {
  PERSONA_TZ,
  eachLocalDate,
  eventTimeAt,
  localDateTime,
  yearMonth,
} from './time.js';

// ──────────────────────────────────────────────────────────────────────────
// Row shapes — match the columns in `packages/smartchats-database/src/schema/local.ts`.
// ──────────────────────────────────────────────────────────────────────────

export interface LogRow extends EventTimeFields {
  id: string;
  content: string;
  category: string;
  metadata?: Record<string, unknown>;
  /** Set by attachEmbeddings(); 1536-dim text-embedding-3-small vector. */
  embedding?: number[];
}

export interface MetricRow extends EventTimeFields {
  id: string;
  metric_name: string;
  value: number;
  unit: string;
  metric_type: 'numeric' | 'duration' | 'count';
  category?: string;
  source: 'voice' | 'manual' | 'derived';
  source_text?: string;
  source_log_id?: string;
}

export interface EntityRow extends EventTimeFields {
  id: string;
  name: string;
  kind: 'book' | 'project' | 'person';
  data: Record<string, unknown>;
  /** Set by attachEmbeddings(); 1536-dim text-embedding-3-small vector. */
  embedding?: number[];
}

export interface RelationRow extends EventTimeFields {
  id: string;
  name: string;            // verb, e.g. "finished", "currently_reading"
  sourceName: string;
  targetName: string;
  kind: 'finished' | 'currently_reading' | 'working_on';
  data: Record<string, unknown>;
}

export interface TodoRow extends EventTimeFields {
  id: string;
  type: 'todo';
  status: 'active' | 'completed' | 'cancelled';
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  category?: string;
  due_at?: string;          // ISO instant
  recurrence?: 'daily' | 'weekly' | 'monthly' | null;
}

export interface CompletionRow extends EventTimeFields {
  id: string;
  type: 'todo_completion';
  parent_id: string;        // → TodoRow.id
  note?: string;
}

export interface Seed {
  startLocalDate: string;
  endLocalDate: string;
  tz: string;
  logs: LogRow[];
  metrics: MetricRow[];
  entities: EntityRow[];
  relations: RelationRow[];
  todos: TodoRow[];
  completions: CompletionRow[];
}

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

export const SEED_START = '2025-01-01';
export const SEED_END = '2026-06-01';
export const SEED_VERSION = '0.1.0';
export const DEFAULT_SEED_NUMBER = 0xBEEFCAFE;

const WORKOUT_SUBTYPES = [
  { name: 'running',  weight: 0.35, avgMinutes: 35, sdMinutes: 8 },
  { name: 'strength', weight: 0.30, avgMinutes: 50, sdMinutes: 12 },
  { name: 'yoga',     weight: 0.20, avgMinutes: 45, sdMinutes: 10 },
  { name: 'cycling',  weight: 0.10, avgMinutes: 55, sdMinutes: 15 },
  { name: 'swimming', weight: 0.05, avgMinutes: 40, sdMinutes: 10 },
] as const;

const MOOD_VALUES = ['great', 'good', 'ok', 'anxious', 'sad', 'tired'] as const;

// Hand-picked book list. Order is stable so q06's "books finished in 2025" has
// a deterministic, hand-reviewable answer.
const BOOK_TITLES: ReadonlyArray<{ title: string; status: 'finished' | 'in_progress'; finishedYear?: 2025 | 2026 }> = [
  // Finished in 2025 (8 — q06 ground truth comes from this slice)
  { title: 'Dune',                       status: 'finished',     finishedYear: 2025 },
  { title: 'The Power Broker',           status: 'finished',     finishedYear: 2025 },
  { title: 'Sapiens',                    status: 'finished',     finishedYear: 2025 },
  { title: 'Thinking, Fast and Slow',    status: 'finished',     finishedYear: 2025 },
  { title: 'The Pragmatic Programmer',   status: 'finished',     finishedYear: 2025 },
  { title: 'Designing Data-Intensive Applications', status: 'finished', finishedYear: 2025 },
  { title: 'Atomic Habits',              status: 'finished',     finishedYear: 2025 },
  { title: 'Why We Sleep',               status: 'finished',     finishedYear: 2025 },
  // Finished in 2026 (4)
  { title: 'Project Hail Mary',          status: 'finished',     finishedYear: 2026 },
  { title: 'The Body Keeps the Score',   status: 'finished',     finishedYear: 2026 },
  { title: 'Deep Work',                  status: 'finished',     finishedYear: 2026 },
  { title: 'Range',                      status: 'finished',     finishedYear: 2026 },
  // In progress (8)
  { title: 'Gödel, Escher, Bach',        status: 'in_progress' },
  { title: 'The Selfish Gene',           status: 'in_progress' },
  { title: 'Antifragile',                status: 'in_progress' },
  { title: 'The Beginning of Infinity',  status: 'in_progress' },
  { title: 'A Pattern Language',         status: 'in_progress' },
  { title: 'Seeing Like a State',        status: 'in_progress' },
  { title: 'Crime and Punishment',       status: 'in_progress' },
  { title: 'The Three-Body Problem',     status: 'in_progress' },
] as const;

const PROJECT_TITLES = [
  'smartchats', 'garden', 'garage_cleanup', 'home_office', 'side_project',
  'reading_list', 'fitness_plan', 'cooking_skills', 'photography', 'travel_planning',
  'investment_review', 'volunteer_coordination', 'family_archive', 'meal_prep', 'budget_tracker',
] as const;

// August 2025 is intentionally biased to win "worst sleep:workout ratio".
// Mechanism: above-average workouts + below-average sleep that month.
function workoutProbForDate(localDate: string): number {
  return localDate.startsWith('2025-08') ? 0.85 : 0.50;
}
function sleepStatsForDate(localDate: string): { mean: number; sd: number } {
  if (localDate.startsWith('2025-08')) return { mean: 5.4, sd: 0.9 };
  return { mean: 7.2, sd: 1.1 };
}

// ──────────────────────────────────────────────────────────────────────────
// ID generator — stable, sequential, prefixed per table
// ──────────────────────────────────────────────────────────────────────────

function makeIdGen(): (prefix: string) => string {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}_${n.toString().padStart(5, '0')}`;
  };
}

// Pick a weighted item — workout subtype distribution.
function pickWeighted<T extends { weight: number }>(rng: Rng, items: readonly T[]): T {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = rng.next() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1]!;
}

// ──────────────────────────────────────────────────────────────────────────
// Generator entry
// ──────────────────────────────────────────────────────────────────────────

export interface GeneratePersonaOptions {
  seed?: number;
  startLocalDate?: string;
  endLocalDate?: string;
}

export function generatePersona(opts: GeneratePersonaOptions = {}): Seed {
  const rng = makeRng(opts.seed ?? DEFAULT_SEED_NUMBER);
  const startLocalDate = opts.startLocalDate ?? SEED_START;
  const endLocalDate = opts.endLocalDate ?? SEED_END;
  const tz = PERSONA_TZ;
  const id = makeIdGen();

  const logs: LogRow[] = [];
  const metrics: MetricRow[] = [];
  const entities: EntityRow[] = [];
  const relations: RelationRow[] = [];
  const todos: TodoRow[] = [];
  const completions: CompletionRow[] = [];

  // ── KG: entities + relations ────────────────────────────────────────────
  // Created at the start of the data range — they exist for the whole window.
  const kgCreatedAt = eventTimeAt(localDateTime(startLocalDate, 9, 0, tz), tz);

  // Books
  for (const b of BOOK_TITLES) {
    entities.push({
      id: id('ent'),
      name: b.title,
      kind: 'book',
      data: { status: b.status, finished_year: b.finishedYear ?? null },
      ...kgCreatedAt,
    });
  }
  // Projects
  for (const p of PROJECT_TITLES) {
    entities.push({
      id: id('ent'),
      name: p,
      kind: 'project',
      data: { status: 'active' },
      ...kgCreatedAt,
    });
  }

  // v1 stores book status + finished_year directly on each entity's `data`
  // field. user_relations is left empty — no scenario needs RELATE traversal
  // yet, and skipping it sidesteps needing a placeholder `bench_user` entity
  // to anchor user-rooted edges. Add relations back when a scenario calls for it.

  // ── Daily loop: metrics + logs ──────────────────────────────────────────
  // Each day: sleep (always), mood (always), maybe weight, maybe workout, maybe reading.
  let weight = 165;  // trends down to ~158 over the window

  // Books currently being read at any given time — drives reading log target.
  // Stable set: in-progress books + Dune (so q08's "total Dune pages" baseline is non-zero).
  const readingPool = [
    'Dune',
    ...BOOK_TITLES.filter((b) => b.status === 'in_progress').map((b) => b.title),
  ];

  for (const localDate of eachLocalDate(startLocalDate, endLocalDate, tz)) {
    // ── sleep_hours (every day) ──
    const sleepStats = sleepStatsForDate(localDate);
    const sleepHours = clamp(rng.gauss(sleepStats.mean, sleepStats.sd), 3.5, 10.0);
    const sleepEt = eventTimeAt(localDateTime(localDate, 8, 0, tz), tz);
    metrics.push({
      id: id('met'),
      metric_name: 'sleep_hours',
      value: round1(sleepHours),
      unit: 'hours',
      metric_type: 'duration',
      category: 'sleep',
      source: 'manual',
      ...sleepEt,
    });

    // ── mood log (every day) ──
    const mood = rng.pick(MOOD_VALUES);
    logs.push({
      id: id('log'),
      content: `Feeling ${mood} today.`,
      category: 'mood',
      metadata: { value: mood },
      ...eventTimeAt(localDateTime(localDate, 8, 30, tz), tz),
    });

    // ── weight_lbs (~5/wk) ──
    if (rng.bool(0.72)) {
      // Trend: from 165 at start to ~158 at end.
      const dayIdx = daysBetween(startLocalDate, localDate);
      const totalDays = daysBetween(startLocalDate, endLocalDate);
      const trendTarget = 165 - (7 * dayIdx) / totalDays;
      weight = trendTarget + rng.gauss(0, 1.2);
      metrics.push({
        id: id('met'),
        metric_name: 'weight_lbs',
        value: round1(weight),
        unit: 'lbs',
        metric_type: 'numeric',
        category: 'body',
        source: 'manual',
        ...eventTimeAt(localDateTime(localDate, 7, 0, tz), tz),
      });
    }

    // ── workout (variable per day; Aug 2025 ~0.85) ──
    if (rng.bool(workoutProbForDate(localDate))) {
      const sub = pickWeighted(rng, WORKOUT_SUBTYPES);
      const mins = Math.max(10, Math.round(rng.gauss(sub.avgMinutes, sub.sdMinutes)));
      const workoutEt = eventTimeAt(localDateTime(localDate, 17, 30, tz), tz);
      const logId = id('log');
      logs.push({
        id: logId,
        content: `Did ${sub.name} for ${mins} minutes.`,
        category: 'workout',
        metadata: { subtype: sub.name, duration_min: mins },
        ...workoutEt,
      });
      metrics.push({
        id: id('met'),
        metric_name: 'workout_duration_min',
        value: mins,
        unit: 'minutes',
        metric_type: 'duration',
        category: 'workout',
        source: 'derived',
        source_text: `${sub.name} for ${mins} minutes`,
        source_log_id: logId,
        ...workoutEt,
      });
    }

    // ── breakfast log (every day, plausibility) ──
    logs.push({
      id: id('log'),
      content: `Breakfast: ${rng.pick(['oatmeal', 'eggs and toast', 'smoothie', 'yogurt and granola', 'avocado toast'])}.`,
      category: 'food',
      ...eventTimeAt(localDateTime(localDate, 7, 30, tz), tz),
    });

    // ── reading session (~0.5/day prob) ──
    if (rng.bool(0.5)) {
      const book = rng.pick(readingPool);
      const pages = Math.max(5, Math.round(rng.gauss(25, 10)));
      const readEt = eventTimeAt(localDateTime(localDate, 21, 30, tz), tz);
      const logId = id('log');
      logs.push({
        id: logId,
        content: `Read ${pages} pages of ${book}.`,
        category: 'reading',
        metadata: { book, pages },
        ...readEt,
      });
      metrics.push({
        id: id('met'),
        metric_name: 'pages_read',
        value: pages,
        unit: 'pages',
        metric_type: 'count',
        category: 'reading',
        source: 'derived',
        source_text: `Read ${pages} pages of ${book}`,
        source_log_id: logId,
        ...readEt,
      });
    }
  }

  // ── Todos ──────────────────────────────────────────────────────────────
  const todoCreatedEt = eventTimeAt(localDateTime(startLocalDate, 9, 0, tz), tz);

  const recurringDefs: ReadonlyArray<{ title: string; recurrence: 'daily' | 'weekly' | 'monthly'; completeProb: number }> = [
    { title: 'morning_meditation', recurrence: 'daily',   completeProb: 0.90 },
    { title: 'weekly_review',      recurrence: 'weekly',  completeProb: 0.80 },
    { title: 'monthly_journal',    recurrence: 'monthly', completeProb: 0.85 },
    { title: 'daily_walk',         recurrence: 'daily',   completeProb: 0.75 },
  ];

  for (const r of recurringDefs) {
    const todoId = id('tdo');
    todos.push({
      id: todoId,
      type: 'todo',
      status: 'active',
      title: r.title,
      recurrence: r.recurrence,
      ...todoCreatedEt,
    });
    // Generate completion records across the window.
    for (const localDate of eachLocalDate(startLocalDate, endLocalDate, tz)) {
      const due = (() => {
        if (r.recurrence === 'daily') return true;
        if (r.recurrence === 'weekly') return localDate.slice(-1) === '7' || (daysBetween(startLocalDate, localDate) % 7 === 0);
        if (r.recurrence === 'monthly') return localDate.endsWith('-01');
        return false;
      })();
      if (!due) continue;
      if (!rng.bool(r.completeProb)) continue;
      completions.push({
        id: id('cmp'),
        type: 'todo_completion',
        parent_id: todoId,
        ...eventTimeAt(localDateTime(localDate, 18, 0, tz), tz),
      });
    }
  }

  // One-off todos: 15 completed + 10 pending. Pending dues land in 2026-06 and 2026-07.
  for (let i = 0; i < 15; i++) {
    const dueLocal = pickDateBetween(rng, startLocalDate, endLocalDate);
    const todoId = id('tdo');
    todos.push({
      id: todoId,
      type: 'todo',
      status: 'completed',
      title: `oneoff_task_${i + 1}`,
      due_at: localDateTime(dueLocal, 17, 0, tz).toISOString(),
      ...eventTimeAt(localDateTime(dueLocal, 9, 0, tz), tz),
    });
    completions.push({
      id: id('cmp'),
      type: 'todo_completion',
      parent_id: todoId,
      ...eventTimeAt(localDateTime(dueLocal, 17, 30, tz), tz),
    });
  }
  // Pending todos — due 2026-06 / 2026-07 (q08 lookup category, NOT mutated; uses fresh future dates).
  const pendingDues = [
    '2026-06-05', '2026-06-09', '2026-06-12', '2026-06-15', '2026-06-20',
    '2026-06-25', '2026-06-28', '2026-07-02', '2026-07-08', '2026-07-15',
  ];
  for (let i = 0; i < pendingDues.length; i++) {
    const dueLocal = pendingDues[i]!;
    todos.push({
      id: id('tdo'),
      type: 'todo',
      status: 'active',
      title: `pending_task_${i + 1}`,
      due_at: localDateTime(dueLocal, 17, 0, tz).toISOString(),
      ...eventTimeAt(localDateTime(SEED_END, 9, 0, tz), tz),
    });
  }

  return {
    startLocalDate,
    endLocalDate,
    tz,
    logs,
    metrics,
    entities,
    relations,
    todos,
    completions,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────────────────

function round1(n: number): number { return Math.round(n * 10) / 10; }
function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)); }
function pad2(n: number): string { return n.toString().padStart(2, '0'); }

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

export function daysBetween(aLocal: string, bLocal: string): number {
  const a = localDateTime(aLocal, 12, 0).getTime();
  const b = localDateTime(bLocal, 12, 0).getTime();
  return Math.round((b - a) / 86_400_000);
}

function pickDateBetween(rng: Rng, startLocal: string, endLocal: string): string {
  const total = daysBetween(startLocal, endLocal);
  const offset = rng.int(0, total);
  const start = localDateTime(startLocal, 12, 0);
  const d = new Date(start.getTime() + offset * 86_400_000);
  return d.toLocaleDateString('sv-SE', { timeZone: PERSONA_TZ });
}

// ──────────────────────────────────────────────────────────────────────────
// Public helpers used by scenarios for truth computation
// ──────────────────────────────────────────────────────────────────────────

/** Sum of `pages_read` metric values whose local_date falls within [start..end]. */
export function sumPagesInRange(seed: Seed, startLocal: string, endLocal: string): number {
  return seed.metrics
    .filter((m) => m.metric_name === 'pages_read' && m.local_date >= startLocal && m.local_date <= endLocal)
    .reduce((s, m) => s + m.value, 0);
}

/** Total pages read for a specific book name (by source_text substring match). */
export function pagesForBook(seed: Seed, bookName: string): number {
  return seed.metrics
    .filter((m) => m.metric_name === 'pages_read' && (m.source_text ?? '').includes(bookName))
    .reduce((s, m) => s + m.value, 0);
}

export function monthsBetween(startLocal: string, endLocal: string): string[] {
  const months = new Set<string>();
  for (const d of eachLocalDate(startLocal, endLocal)) months.add(yearMonth(d));
  return [...months];
}
