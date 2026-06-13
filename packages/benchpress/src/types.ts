/**
 * Core types shared across the benchpress generator, scenarios, and scoring.
 *
 * Part 1 (dataset + verification) consumes BenchScenario + EventTimeFields.
 * Part 2 (harness + scoring) will add ScenarioResult, TraceMetrics,
 * TraceAssertionResult — left out until then to avoid pre-committing shapes
 * we'll discover while wiring the simi workflow.
 */

/**
 * Shapes the agent may submit via the `submit_answer` tool.
 *
 *   scalar     — single number/string/boolean answer
 *   date       — YYYY-MM-DD string
 *   list       — array of items (order is normalized before comparison)
 *   comparison — { winner, a, b } where winner ∈ {'a','b'} or labels
 *   negative   — value === null because the data truthfully doesn't exist
 *   composite  — multi-field object (e.g. HARD-1's monthly matrix + argmin)
 */
export type AnswerKind =
  | 'scalar'
  | 'date'
  | 'list'
  | 'comparison'
  | 'negative'
  | 'composite';

/** Payload the agent passes to the benchpress `submit_answer` tool. */
export interface SubmitAnswerPayload {
  value: unknown;
  kind: AnswerKind;
  unit?: string;
  reason?: string;
  source_tool?: string;
}

/**
 * Real-UTC + local-day + tz triple. Required on every event-time row
 * (logs, sessions, metrics, user_entities, user_relations, events).
 * Matches `packages/smartchats-database/src/schema/local.ts` and
 * `nowEventTime()` in `apps/smartchats/app/modules/system.ts`.
 */
export interface EventTimeFields {
  ts: string;
  local_date: string;
  local_tz: string;
}

/**
 * One scenario benchpress runs.
 *
 * `ts_truth(seed)` is the authoritative answer, computed in TS at generator
 * time. `surql_probe` is the same answer expressed as a SurrealQL query
 * against the seeded DB; the verify_seed script asserts they're equal.
 *
 * `prompt` is a single user message for single-turn scenarios, or an array
 * for procedural multi-turn (each element is one user turn).
 */
export interface BenchScenario<Seed = unknown, Truth = unknown> {
  id: string;
  category: string;
  prompt: string | string[];
  kind: AnswerKind;
  ts_truth: (seed: Seed) => Truth;
  surql_probe?: string;
  expected_shape?: Record<string, string>;
}

/**
 * Snapshot of every scenario's expected answer, emitted by the generator
 * to `fixtures/truths.json`. The verifier loads this without needing to
 * import the scenario .ts files (lets the verifier stay slim and decoupled).
 */
export interface TruthsSnapshot {
  generated_at: string;
  seed_version: string;
  scenarios: Record<
    string,
    {
      truth: unknown;
      surql_probe?: string;
      kind: AnswerKind;
    }
  >;
}
