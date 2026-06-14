# analysis_db/ — DB-side session analysis modules

Pure query helpers over the live `insights_events` table. Each module exports:

1. One or more **`queryX(client, args) → result`** functions — take a `Client` and a filter / args bag, dispatch a SurrealQL query, return a typed result.
2. A matching **`formatX(result, opts) → string`** formatter — render the result to a human-readable string (plain, table, markdown, JSON).

Same contract as [`../analysis/`](../analysis/README.md), but reads the live DB instead of an exported bundle. Lets us answer "where to look" questions without round-tripping bundles to disk first.

## Why this layer exists

The on-disk `analysis/` modules operate on a `SessionBundle` — they need the bundle exported first. That's the right shape for deep-dive analysis (transcripts, error signature merging, trace trees, performance histograms with percentiles) — anything that needs full conversation reconstruction or cross-event correlation in client-side JS.

But for monitoring-shaped questions —

- "Which sessions are expensive right now?"
- "Which function calls just timed out?"
- "What's the speech-recognition error rate over the last week?"
- "What did the agent call `save_log` with, last 30 days?"
- "Show me the cost-by-model breakdown per user."

— round-tripping every candidate bundle is overkill. SurrealQL can answer most of those directly via aggregations and deep-path predicates against the JSON payload column.

This layer is the DB-side complement. **Both layers exist; consumers compose them.** DB-side surfaces candidates (cheap, indexed); on-disk side investigates individual cases (rich, deep).

## Capability matrix

What the DB layer can do well, what it can't, and where the on-disk layer takes over:

| Capability | DB-side | Notes |
|---|---|---|
| Event-type histograms, time-window counts | ✅ trivially | top-level indexed fields (`event_type`, `timestamp`) |
| Per-session LLM cost / latency rollups | ✅ | `payload.prompt_tokens / completion_tokens / latency_ms` are shallow fields, `GROUP BY session_id` works |
| Slow function calls (duration > N) | ✅ | array-filter predicate on `payload.context.result.events[?type='function_end' AND data.duration > N]` |
| Function calls by name | ✅ | array-filter projection on `[?type='function_start'].data.name` |
| Function calls by name + args | ✅ | nested `array::any(events[?...].data.args, |$a| $a.field = X)` |
| Sandbox / runtime errors | ✅ | filter on `payload.context.result.events[?type='function_error']` |
| Speech-recognition error rate over time | ✅ | `event_type = 'speech_recognition_error'`, bucket by hour/day |
| Per-user activity / cost / errors | ✅ | `user_id` is a top-level field |
| Issue events (see below) | ✅ | single indexed query, no payload diving needed |
| Full transcript reconstruction | ❌ | needs ordered concatenation of user_input + addAiMessage + execution.response — easier in JS over a bundle |
| Error signature merging / dedupe | ❌ | needs payload introspection + string normalization — JS-side wins |
| Causality trees | ❌ | traverses the `trace_id` / `parent_event_id` graph — easier over a bundle |
| Latency p50/p95/p99 | ⚠️ | SurrealDB has `math::mean/max/min` but not percentile aggregates; pull rows and compute client-side, OR live with mean/max-only at the DB layer |

If your question is in the ✅ rows, this layer is the right tool. If it's in the ❌ rows, use `find` + `save_session` + `analysis/`.

## Contract

Every module follows the same shape:

```ts
// query — pure-aside-from-the-DB. Takes a Client, returns typed data.
export async function queryYourConcern(
  client: Client,
  args: YourConcernArgs,
): Promise<YourConcernResult>;

// format — pure. Takes the result, returns a string.
export function formatYourConcern(
  result: YourConcernResult,
  opts?: FormatOpts,
): string;
```

No `fs`, no `process.env`, no module-level state. The CLI driver does the I/O.

## Filter convention — `BaseFilter`

Most analyzers want the same dimensional filters. Use the shared shape in `_query_helpers.ts`:

```ts
export interface BaseFilter {
  since?: string | number;     // ISO datetime OR shorthand ('7d', '24h', '30m', '2w'); epoch ms also OK
  until?: string | number;
  app?: string;                // exact-match on app_name
  userId?: string;             // exact-match on user_id
  sessionId?: string;          // exact-match on session_id
  limit?: number;              // hard cap on rows returned
}
```

`_query_helpers.ts` exports `buildFilterClause(f) → { where, vars }` that every analyzer composes with its module-specific WHERE additions.

## Output conventions — `FormatOpts`

Same idea — shared in `_format.ts`:

```ts
export type OutputFormat = 'text' | 'table' | 'json' | 'csv' | 'markdown';
export interface FormatOpts {
  format?: OutputFormat;       // default 'text'
  truncate?: number;           // for long string fields
  // module-specific opts may extend this
}
```

`_format.ts` provides `renderTable(rows)`, `renderCsv(rows)`, `renderMarkdownTable(rows)` so each analyzer's `formatX` doesn't reinvent table rendering.

## Conventions

Mirroring [`../analysis/`](../analysis/README.md):

- **Pure aside from the Client.** No I/O beyond the Client; no `fs`, no `process.env`, no singletons. CLI drivers in `../scripts/` own the I/O.
- **One concern per file.** Composite queries (e.g. "full audit report") compose from the per-concern modules at call sites, not co-located.
- **Permissive payload parsing.** Production payloads drift over time and across versions. Use optional-chaining; surface what's available rather than crashing on shape drift. Same posture as the on-disk analyzers.
- **Don't pre-emptively load 1000-row results.** Every analyzer takes a `limit`; the default should be small enough that someone running it interactively doesn't accidentally print 10K rows.
- **No client-side computation that could've been a SurrealQL aggregate.** If you find yourself loading 50K rows and counting them in JS, push the count into the query.

## Issue event convention

The `issue` event type is the foundation for real-time monitoring and alerting without payload introspection. Detectors emit it from anywhere in the runtime; this layer's `issues.ts` analyzer reads them via a single indexed query.

```ts
event_type: 'issue'
payload: {
  kind: string,                          // e.g. 'context_bloat', 'tool_error', 'cost_spike'
  severity: 'info' | 'warn' | 'critical',
  detector: string,                      // e.g. 'scm', 'cortex', 'module:metrics'
  summary: string,                       // short human-readable
  metadata?: Record<string, unknown>,    // detector-specific structured data
}
tags: ['issue', '<kind>']
```

**Permissive at write, opinionated at read.** `kind` is a string — NOT an enforced enum. A TypeScript union type in `smartchats-common` documents the *recommended* kinds for autocomplete + grep-ability:

```ts
// in smartchats-common/insights/issue_types.ts (proposed)
export type KnownIssueKind =
  | 'context_bloat_scm'         // system prompt grew unexpectedly (added modules, verbose system_msg)
  | 'context_bloat_tool_return' // a tool's return payload got injected into conversation and was huge
  | 'tool_error'                // function_error sub-event (sandbox timeout, runtime error)
  | 'directive_violation'       // model didn't follow a documented contract
  | 'silent_failure'            // turn started but never produced output
  | 'cost_spike'                // cumulative cost / single-call cost crossed a threshold
  | 'cache_miss_spike';         // cache_creation jumped without matching cache_read on subsequent calls
// open-ended — string union pattern; detectors can emit unseen kinds.
export type IssueKind = KnownIssueKind | (string & {});
```

**Context bloat is two distinct detectors, not one** (worth surfacing because we already learned this the hard way — the 127K bloat we found in production wasn't SCM-side; it was the `metrics_context` background-loader injecting an unbounded `SELECT *` as a tool return). The two detection hooks live at different points in the runtime:

- **`context_bloat_scm`** — hooks `SCM.build()`. Measures `system_prompt` token count against a per-session baseline. Fires when the static prefix grows by > X% within a session (e.g., a new module was loaded mid-session, or module state ballooned).
- **`context_bloat_tool_return`** — hooks `update_workspace` / `add_user_data_input` (the points where tool results and loader payloads get appended to the conversation). Measures the size of the injected payload. Fires when a single tool return exceeds X tokens.

Both emit the same `issue` event shape; the `kind` distinguishes them, and `metadata` carries the source-specific details (`module_id` for SCM, `function_name` + `args_summary` for tool returns).

A new detector that emits `'kind: "embedding_dimension_drift"'` doesn't require a coordinated code change. Consumers (the `queryIssueEvents` analyzer) take `kind?: string | string[]` filters that work for any value, known or not.

The recommended list grows over time as kinds prove their worth. Don't enforce closed enums at the DB layer; the schema is SCHEMALESS and the tooling stays adaptive.

## Adding a new module

1. Create `your_concern.ts` in this directory.
2. Export `queryYourConcern(client: Client, args: BaseFilter & YourArgs): Promise<YourResult>` (pure aside from the Client).
3. Export `formatYourConcern(result, opts?: FormatOpts): string`.
4. Re-export both from `../index.ts`.
5. Add a CLI driver at `../scripts/audit_your_concern.ts` (model on the existing analyze scripts; `_cli_lib.ts` has the shared parse/connect/die helpers).
6. Wire an `audit:your-concern` script in `package.json`.

The script naming uses `audit:` to distinguish from the bundle-side `analyze:` scripts at a glance. (Open question — could keep `analyze:` if we'd rather not split the namespace. Lock this when the first module lands.)

## Open vs closed boundary

Same pattern as [`../cli/find_cli.ts`](../cli/find_cli.ts):

- **Logic + queries + formatters live here** (open, single source of truth). Same module works for any deployment.
- **`createClient` factory varies.** Open consumers default to local AIO root creds; closed `smartchats-cloud` consumers supply root creds for the production cloud DB.
- **CLI entry points are thin.** Open scripts in `../scripts/audit_X.ts` use local AIO defaults. Closed wrappers in `smartchats-cloud/scripts/cloud_audit_X.ts` reuse the analyzers + supply the cloud `createClient`.

No SurrealDB-SDK access here — all queries dispatch through the `Client` interface from `smartchats-database`.

## Real-time monitoring (LiveQuery)

SurrealDB supports `LIVE SELECT` — streams matching rows as they're inserted. The right home for the streaming subscription is `monitor.ts`:

```ts
export async function* streamIssues(
  client: Client,
  filter: BaseFilter & { severity?: 'info' | 'warn' | 'critical' },
): AsyncIterable<IssueRow>;
```

Combined with the `issue` event type, this enables a real alerting layer:

```sql
LIVE SELECT * FROM insights_events
WHERE event_type = 'issue' AND payload.severity = 'critical'
```

Subscribe once, react in real time (Slack, dashboard, etc.). Near-zero polling cost. **Don't build this until the batch `queryIssueEvents` proves itself useful** — `LIVE SELECT` is the optimization, the query interface is the foundation.

## Composability with `sm`

The unified `sm` CLI integrates by importing the analyzer modules directly (not by spawning `npm run` subprocesses). The pattern:

```
packages/sm/src/commands/audit.ts

  sm audit cost           --since 7d --by user --format=table
  sm audit slow-calls     --threshold 30000 --format=json --out=slow.json
  sm audit issues         --severity critical --since 24h
  sm audit issues --live  --severity critical                    # streams
  sm audit function-calls --name save_log --arg category=dreams
```

Each `sm audit <subcmd>` is ~10 lines: parse args → call `queryX(client, args)` → call `formatX(result, opts)` → emit. The work stays in the analyzer modules; sm is just the unified CLI shell. Per-script CLIs in `scripts/` stay as direct/debug entry points.

## Future modules (roadmap, not blocked on anything)

Suggested initial set, ordered by triage / monitoring value:

| Module | Purpose | Status |
|---|---|---|
| `_query_helpers.ts` | `BaseFilter` + `buildFilterClause` + time-shorthand parser | not started |
| `_format.ts` | `renderTable / renderCsv / renderMarkdownTable` + `FormatOpts` | not started |
| `cost.ts` | per-session / per-user / per-model token + $ rollups | not started |
| `function_calls.ts` | histogram by name, per session / user / time window | not started |
| `function_args.ts` | filter by name + args predicate (e.g. `save_log category=dreams`) | not started |
| `slow_calls.ts` | function_end durations > threshold; flags abandoned `accumulate_text` | not started |
| `errors.ts` | function_error sub-events + top-level error event histograms | not started |
| `users.ts` | per-user activity / cost / error rate breakdowns | not started |
| `context_growth.ts` | LLM prompt-size outliers — pre-`issue`-event surrogate | not started |
| `issues.ts` | `queryIssueEvents` by kind / severity / time window | not started (requires `issue` event type spec'd in smartchats-common) |
| `monitor.ts` | composite real-time orchestrator + LiveQuery streams | not started (final form; defer until issues.ts proves itself) |

## Worked examples from initial probes against production

These confirmed the deep-payload predicates work; left as reference for future module authors.

### Slow function calls (>30s)

```sql
SELECT event_id, session_id, timestamp,
       payload.context.result.events[?type='function_end' AND data.duration > 30000]
         AS slow_calls
FROM insights_events
WHERE event_type = 'execution'
  AND timestamp > time::now() - 30d
ORDER BY timestamp DESC
LIMIT 5
```

Surfaces real abandonments — found `accumulate_text` calls taking 145s, 499s (8 minutes) in production.

### Function-error histogram

```sql
SELECT event_id, session_id, timestamp,
       payload.context.result.events[?type='function_error'] AS errors
FROM insights_events
WHERE event_type = 'execution'
  AND timestamp > time::now() - 7d
  AND array::len(payload.context.result.events[?type='function_error']) > 0
LIMIT 5
```

Found 4 errors in 7 days: 3 × `Sandbox execution timeout after 3600000ms` (1-hour iframe sandbox cap on `accumulate_text` / `cli_voice_forward`), 1 × `WebSocket connection failed` (`cli_connect`). These are the kinds of things an `issue` event detector should fire when they happen, not get discovered later.

### Costliest sessions

```sql
SELECT session_id, user_id,
       count() AS llm_calls,
       math::sum(payload.prompt_tokens) AS input_tokens,
       math::sum(payload.completion_tokens) AS output_tokens,
       math::max(payload.latency_ms) AS max_latency_ms
FROM insights_events
WHERE event_type = 'llm_invocation' AND timestamp > time::now() - 7d
GROUP BY session_id, user_id
ORDER BY input_tokens DESC
LIMIT 5
```

Top result during initial probe: 69 LLM calls, 6.88M input tokens, 109s max latency — a single session that ran up real money. Exactly the shape `cost.ts` should surface.
