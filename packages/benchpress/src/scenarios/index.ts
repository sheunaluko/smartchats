/**
 * v1 scenario set — 11 scenarios spanning all 6 answer kinds.
 *
 * `ts_truth(seed)` and `surql_probe` describe the *pristine* seeded DB.
 * The verifier asserts probe_result === ts_truth (when a probe exists).
 *
 * Scenarios with multi-turn mutations (currently just q08) carry
 * `expected_delta` — the change the mutation should produce. Part 2 scoring
 * uses `ts_truth + expected_delta` as the expected final agent answer.
 *
 * `surql_probe` is OPTIONAL. Scenarios where the probe would be a knot of
 * SurrealQL (HARD-1's monthly matrix, the directive scenarios that score
 * off trace, the procedural multi-turn) skip it — ts_truth alone defines
 * correctness, and Part 2 trace assertions cover what the probe couldn't.
 */
import type { BenchScenario, ExpectedCall, ScriptedResponses } from '../types.js';
import type { Seed } from '../generator/persona.js';
import { pagesForBook, sumPagesInRange } from '../generator/persona.js';
import { yearMonth } from '../generator/time.js';

export interface BenchScenarioV1 extends BenchScenario<Seed, unknown> {
  /** Multi-turn mutations encode the expected change here for Part 2 scoring. */
  expected_delta?: unknown;
  /** Notes for human reviewers; not used by the runtime. */
  notes?: string;
  /**
   * Per-turn budget (ms) for sendMessageAsync — covers the full agent loop
   * (every LLM call + tool execution + response emission). Workflow factory
   * applies this to each sendMessageAsync step. Default 30_000.
   *
   * Bump for scenarios that legitimately need many tool calls or deep
   * iteration (HARD-1, accumulate_text, long composition chains).
   */
  maxTurnMs?: number;

  // ── tool_sequence kind fields (only used when kind === 'tool_sequence') ──

  /**
   * Ordered tool calls the agent must make. Subsequent ones may have
   * unrelated calls between them; the scorer asserts each appears IN ORDER
   * with matching args. For the dream scenario: [accumulate_text, save_log].
   */
  expected_calls?: ExpectedCall[];

  /**
   * Text chunks to feed into blocking functions, keyed by tool name. Each
   * chunk is dispatched via setChatInput + sendChatMessage; while the
   * agent's cor.is_running_function is true, transcriptionCb routes
   * through handle_function_input instead of starting a new turn.
   *
   * For accumulate_text, the final chunk must be "finished" (or the
   * function never returns).
   */
  scripted_responses?: ScriptedResponses;

  /**
   * Time budget (ms) to wait for the agent to enter is_running_function
   * after the initial sendChatMessage. Defaults to 15_000. If exceeded,
   * the workflow fails — the scorer will see no matching tool in the
   * trace and report "agent didn't reach the expected first call."
   */
  functionStartTimeoutMs?: number;

  /**
   * Time budget (ms) to wait for state.llmRunning to become false after
   * the scripted_responses are fed in. Covers the agent's post-function
   * processing (e.g. save_log + reply). Defaults to 20_000.
   */
  turnCompleteTimeoutMs?: number;
}

// ──────────────────────────────────────────────────────────────────────────
// 1 · direct lookup — scalar
// ──────────────────────────────────────────────────────────────────────────
export const q01_weight_lookup: BenchScenarioV1 = {
  id: 'q01_weight_lookup',
  category: 'direct_lookup',
  kind: 'scalar',
  prompt: 'What was my weight on 2026-03-15?',
  ts_truth: (seed) => {
    const m = seed.metrics.find(
      (m) => m.metric_name === 'weight_lbs' && m.local_date === '2026-03-15',
    );
    return m?.value ?? null;
  },
  surql_probe: `SELECT VALUE value FROM metrics WHERE metric_name = 'weight_lbs' AND local_date = '2026-03-15';`,
  expected_shape: { value: 'number', unit: 'lbs' },
};

// ──────────────────────────────────────────────────────────────────────────
// 2 · time-window aggregation — scalar
// ──────────────────────────────────────────────────────────────────────────
export const q02_pages_q1: BenchScenarioV1 = {
  id: 'q02_pages_q1',
  category: 'time_window_aggregation',
  kind: 'scalar',
  prompt: 'How many pages did I read between 2026-01-01 and 2026-03-31?',
  ts_truth: (seed) => sumPagesInRange(seed, '2026-01-01', '2026-03-31'),
  surql_probe: `SELECT VALUE math::sum(value) FROM metrics WHERE metric_name = 'pages_read' AND local_date >= '2026-01-01' AND local_date <= '2026-03-31' GROUP ALL;`,
  expected_shape: { value: 'number', unit: 'pages' },
};

// ──────────────────────────────────────────────────────────────────────────
// 3 · metric-type generalization — date
// ──────────────────────────────────────────────────────────────────────────
export const q03_last_exercise: BenchScenarioV1 = {
  id: 'q03_last_exercise',
  category: 'metric_type_generalization',
  kind: 'date',
  prompt: 'When did I last exercise?',
  ts_truth: (seed) => {
    const workouts = seed.logs.filter((l) => l.category === 'workout');
    if (workouts.length === 0) return null;
    workouts.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return workouts[0]!.local_date;
  },
  surql_probe: `SELECT VALUE local_date FROM logs WHERE category = 'workout' ORDER BY ts DESC LIMIT 1;`,
  expected_shape: { value: 'YYYY-MM-DD' },
  notes: 'Agent must map "exercise" → category=workout. No literal "exercise" tag in seed.',
};

// ──────────────────────────────────────────────────────────────────────────
// 4 · multi-step composition — comparison
// ──────────────────────────────────────────────────────────────────────────
export const q04_pages_jan_vs_feb: BenchScenarioV1 = {
  id: 'q04_pages_jan_vs_feb',
  category: 'multi_step_composition',
  kind: 'comparison',
  prompt: 'Did I read more pages in January 2026 or February 2026?',
  ts_truth: (seed) => {
    const jan = sumPagesInRange(seed, '2026-01-01', '2026-01-31');
    const feb = sumPagesInRange(seed, '2026-02-01', '2026-02-28');
    return { january: jan, february: feb, winner: jan >= feb ? 'january' : 'february' };
  },
  // Probe: returns one row with both sums + the winner label.
  surql_probe:
    `LET $jan = (SELECT VALUE math::sum(value) FROM metrics WHERE metric_name = 'pages_read' AND local_date >= '2026-01-01' AND local_date <= '2026-01-31' GROUP ALL)[0]; ` +
    `LET $feb = (SELECT VALUE math::sum(value) FROM metrics WHERE metric_name = 'pages_read' AND local_date >= '2026-02-01' AND local_date <= '2026-02-28' GROUP ALL)[0]; ` +
    `RETURN { january: $jan, february: $feb, winner: IF $jan >= $feb THEN 'january' ELSE 'february' END };`,
  expected_shape: { january: 'number', february: 'number', winner: 'january|february' },
};

// ──────────────────────────────────────────────────────────────────────────
// 5 · cross-domain join — scalar
// ──────────────────────────────────────────────────────────────────────────
export const q05_workout_sleep_join: BenchScenarioV1 = {
  id: 'q05_workout_sleep_join',
  category: 'cross_domain_join',
  kind: 'scalar',
  prompt: 'On the days I worked out in May 2026, what was my average sleep duration that night?',
  ts_truth: (seed) => {
    const workoutDates = new Set(
      seed.logs.filter((l) => l.category === 'workout' && l.local_date.startsWith('2026-05')).map((l) => l.local_date),
    );
    const sleeps = seed.metrics
      .filter((m) => m.metric_name === 'sleep_hours' && workoutDates.has(m.local_date))
      .map((m) => m.value);
    if (sleeps.length === 0) return null;
    return round3(sleeps.reduce((s, v) => s + v, 0) / sleeps.length);
  },
  surql_probe:
    `LET $days = (SELECT VALUE local_date FROM logs WHERE category = 'workout' AND local_date >= '2026-05-01' AND local_date <= '2026-05-31'); ` +
    `RETURN math::mean((SELECT VALUE value FROM metrics WHERE metric_name = 'sleep_hours' AND local_date IN $days));`,
  expected_shape: { value: 'number', unit: 'hours' },
  notes: '"That night" maps to the same local_date as the workout. Same-night convention matches the seed.',
};

// ──────────────────────────────────────────────────────────────────────────
// 6 · KG recall — list
// ──────────────────────────────────────────────────────────────────────────
export const q06_books_finished_2025: BenchScenarioV1 = {
  id: 'q06_books_finished_2025',
  category: 'kg_recall',
  kind: 'list',
  prompt: 'What books did I finish reading in 2025?',
  ts_truth: (seed) => {
    return seed.entities
      .filter((e) => e.kind === 'book' && (e.data as { finished_year?: number }).finished_year === 2025)
      .map((e) => e.name)
      .sort();
  },
  surql_probe: `SELECT VALUE name FROM user_entities WHERE kind = 'book' AND data.finished_year = 2025 ORDER BY name;`,
  expected_shape: { value: 'string[]' },
  notes: 'Order-normalized (sorted ascending) before assertion. No embeddings → agent must use surrealql fallback.',
};

// ──────────────────────────────────────────────────────────────────────────
// 7 · negative case — anti-hallucination
// ──────────────────────────────────────────────────────────────────────────
export const q07_last_tennis: BenchScenarioV1 = {
  id: 'q07_last_tennis',
  category: 'negative',
  kind: 'negative',
  prompt: 'When did I last play tennis?',
  ts_truth: () => null,
  surql_probe: `SELECT VALUE local_date FROM logs WHERE category = 'workout' AND string::contains(content, 'tennis') ORDER BY ts DESC LIMIT 1;`,
  expected_shape: { value: 'null' },
  notes: 'No tennis in seed. Agent must submit kind=negative with value=null, not confabulate.',
};

// ──────────────────────────────────────────────────────────────────────────
// 8 · procedural multi-turn — scalar (with mutation)
// ──────────────────────────────────────────────────────────────────────────
export const q08_dune_mutate_then_count: BenchScenarioV1 = {
  id: 'q08_dune_mutate_then_count',
  category: 'procedural_multi_turn',
  kind: 'scalar',
  prompt: [
    'Log that I read 30 pages of Dune on 2026-06-08.',
    'How many total pages of Dune have I read?',
  ],
  ts_truth: (seed) => pagesForBook(seed, 'Dune'),  // baseline only
  expected_delta: 30,                              // T1 mutation
  surql_probe: `SELECT VALUE math::sum(value) FROM metrics WHERE metric_name = 'pages_read' AND string::contains(source_text, 'Dune') GROUP ALL;`,
  expected_shape: { value: 'number', unit: 'pages' },
  notes: 'Part 2 scoring: expected_final_answer = ts_truth + expected_delta. Seed must be re-loaded before this scenario across model runs.',
  maxTurnMs: 45_000,  // two turns × ~20s budget each
};

// ──────────────────────────────────────────────────────────────────────────
// 9 · directive (progress-update compliance) — scalar + trace assertion
// ──────────────────────────────────────────────────────────────────────────
export const q09_busiest_workout_week: BenchScenarioV1 = {
  id: 'q09_busiest_workout_week',
  category: 'directive_progress_update',
  kind: 'scalar',
  prompt: 'For each ISO week of 2025, count my workouts and tell me which week had the most. Give me just the date of the Monday of that week.',
  ts_truth: (seed) => {
    const counts = new Map<string, number>();
    for (const l of seed.logs) {
      if (l.category !== 'workout' || !l.local_date.startsWith('2025')) continue;
      const monday = isoWeekMondayLocal(l.local_date);
      counts.set(monday, (counts.get(monday) ?? 0) + 1);
    }
    let best: { monday: string; n: number } | null = null;
    for (const [monday, n] of counts) {
      if (!best || n > best.n || (n === best.n && monday < best.monday)) best = { monday, n };
    }
    return best?.monday ?? null;
  },
  // No clean surrealql probe — ISO-week math in pure surql is gnarly. ts_truth is authoritative.
  expected_shape: { value: 'YYYY-MM-DD' },
  notes: 'Long-running query — should trigger responsiveness directive (>5s threshold). Trace assertion in Part 2.',
  maxTurnMs: 60_000,  // intentionally long; need headroom for progress updates to fire
};

// ──────────────────────────────────────────────────────────────────────────
// 10 · HARD-1 — composite
// ──────────────────────────────────────────────────────────────────────────
export const q10_hard_compounding: BenchScenarioV1 = {
  id: 'q10_hard_compounding',
  category: 'hard',
  kind: 'composite',
  prompt:
    'For each month of 2025, compute three numbers: total pages I read, total workouts I logged, ' +
    'and my average sleep duration. Then compute each month\'s ratio of (avg sleep) ÷ (total workouts). ' +
    'Tell me which month had the smallest ratio (the worst sleep-to-workout ratio), and report that month\'s three numbers and the ratio.',
  ts_truth: (seed) => {
    const months = monthsOf2025();
    const rows = months.map((ym) => {
      const start = `${ym}-01`;
      const end = `${ym}-31`;
      const pages = sumPagesInRange(seed, start, end);
      const workouts = seed.logs.filter(
        (l) => l.category === 'workout' && l.local_date >= start && l.local_date <= end,
      ).length;
      const sleepVals = seed.metrics
        .filter((m) => m.metric_name === 'sleep_hours' && m.local_date >= start && m.local_date <= end)
        .map((m) => m.value);
      const avgSleep = sleepVals.length === 0 ? 0 : sleepVals.reduce((s, v) => s + v, 0) / sleepVals.length;
      const ratio = workouts === 0 ? Infinity : avgSleep / workouts;
      return { month: ym, pages, workouts, avg_sleep: round3(avgSleep), ratio: round3(ratio) };
    });
    let worst = rows[0]!;
    for (const r of rows) if (r.ratio < worst.ratio) worst = r;
    return { worst, monthly: rows };
  },
  expected_shape: { worst: 'object', monthly: 'object[]' },
  notes:
    'Persona is biased so 2025-08 wins. Ground truth from ts_truth — surql probe too gnarly to write cleanly. ' +
    'Capability ceiling test.',
  maxTurnMs: 90_000,  // HARD-1 capability ceiling — many LLM iterations
};

// ──────────────────────────────────────────────────────────────────────────
// 11 · directive (accumulate_text no-duplication) — composite, trace-scored
// ──────────────────────────────────────────────────────────────────────────
export const q11_accumulate_text_no_dup: BenchScenarioV1 = {
  id: 'q11_accumulate_text_no_dup',
  category: 'directive_accumulate_text',
  kind: 'composite',
  prompt: 'I want to record an extended note about my fitness goals for the rest of 2026.',
  ts_truth: () => ({ note: 'trace-scored — see Part 2 trace_assertion' }),
  expected_shape: { value: 'composite' },
  notes:
    'Trace assertion (Part 2): agent calls accumulate_text; word "finished" does NOT appear in BOTH ' +
    'the spoken response AND the user_instructions arg (would mean agent told user "say finished" twice).',
  maxTurnMs: 45_000,  // accumulate_text is multi-iteration (waits for "finished")
};

// ──────────────────────────────────────────────────────────────────────────
// 12 · tool_sequence — agent must infer the multi-step plan
// ──────────────────────────────────────────────────────────────────────────
/**
 * "I want to write down a dream — going to be a detailed entry"
 *   → agent should call accumulate_text first to collect the dream content,
 *   THEN call save_log with category='dream' and the collected content.
 *
 * The prompt is deliberately text-biased ("write down", "detailed entry"):
 *   - "record" alone leads Haiku/Sonnet to save_memo (voice memo path),
 *     which errors with "Microphone unavailable" headlessly.
 *   - "write down" + "detailed" signals (a) text modality and
 *     (b) multi-chunk content — the cues accumulate_text was designed for.
 * Tests whether the model infers the multi-step plan from minimal context.
 *
 * Workflow mechanics: the matrix runner sends the prompt via sendChatMessage
 * (non-blocking — runs sendMessageSync internally). When the agent reaches
 * accumulate_text and `cor.is_running_function` flips true, the workflow
 * dispatches the scripted_responses chunks via the same sendChatMessage
 * path — they auto-route through handle_function_input. The agent then
 * receives the dream text, accumulate_text returns, and the agent (we hope)
 * calls save_log with the content.
 */
export const q12_dream_record_chain: BenchScenarioV1 = {
  id: 'q12_dream_record_chain',
  category: 'tool_sequence_inference',
  kind: 'tool_sequence',
  prompt: 'I want to create a dream log',
  // ts_truth and surql_probe aren't used for tool_sequence; placeholder
  // for type compatibility.
  ts_truth: () => null,
  expected_calls: [
    { tool: 'accumulate_text' },
    {
      tool: 'save_log',
      args: {
        category: { matches: 'dream' },           // case-insensitive substring via regex
        text: { includes: 'flying' },             // save_log's content param is `text`, not `content`
      },
    },
  ],
  scripted_responses: {
    accumulate_text: [
      'I dreamt about flying over the ocean for hours',
      'finished',
    ],
  },
  // Slow models (nano, reasoning models) need 30-45s just to produce
  // their first tool call. Sonnet's full post-accumulate_text loop
  // (receive result → next LLM call → save_log → final reply) needs
  // ~25-35s. Generous budgets here keep the cliff above realistic
  // completion times.
  functionStartTimeoutMs: 45_000,
  turnCompleteTimeoutMs: 45_000,
  notes:
    'Tests whether the agent infers "record a dream" → accumulate_text (gather content) ' +
    '→ save_log (persist) instead of jumping straight to save_log with empty content. ' +
    'Measures action-plan reasoning, not data retrieval correctness.',
};

// ──────────────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────────────
export const ALL_SCENARIOS: readonly BenchScenarioV1[] = [
  q01_weight_lookup,
  q02_pages_q1,
  q03_last_exercise,
  q04_pages_jan_vs_feb,
  q05_workout_sleep_join,
  q06_books_finished_2025,
  q07_last_tennis,
  q08_dune_mutate_then_count,
  q09_busiest_workout_week,
  q10_hard_compounding,
  q11_accumulate_text_no_dup,
  q12_dream_record_chain,
];

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function round3(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 1000) / 1000;
}

function monthsOf2025(): string[] {
  const out: string[] = [];
  for (let m = 1; m <= 12; m++) out.push(`2025-${m.toString().padStart(2, '0')}`);
  return out;
}

/** Monday of the ISO week containing `localDate` (YYYY-MM-DD, persona tz). */
function isoWeekMondayLocal(localDate: string): string {
  // localDate is YYYY-MM-DD in persona tz. Treat as a naive date for weekday math.
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const utcMidnight = new Date(Date.UTC(y, m - 1, d));
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat. ISO week starts Monday (1).
  const dow = utcMidnight.getUTCDay();
  const offsetToMon = (dow + 6) % 7;  // days back to Monday
  const mon = new Date(utcMidnight.getTime() - offsetToMon * 86_400_000);
  return `${mon.getUTCFullYear()}-${pad2(mon.getUTCMonth() + 1)}-${pad2(mon.getUTCDate())}`;
}

function pad2(n: number): string { return n.toString().padStart(2, '0'); }
