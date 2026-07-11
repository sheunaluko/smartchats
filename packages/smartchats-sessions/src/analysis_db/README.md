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

The `issue` event type is the foundation for monitoring and triage of "things a human should look at." Anything in the runtime can emit one through the existing insights pipeline; this layer's `issues.ts` analyzer reads them via a single indexed query against `event_type = 'issue'`.

Schema (canonical — defined in `smartchats-common/src/issues/types.ts`):

```ts
event_type: 'issue'
payload: {
  kind: string,                          // free-form. e.g. 'tool_misbehavior',
                                         //   'weird_llm_response', 'context_bloat_tool_return'
  source: string,                        // free-form emitter identity. e.g.
                                         //   'agent.report_issue', 'scm.build'
  severity: 'info' | 'warning' | 'error',// fixed enum
  summary: string,                       // one-line human-readable
  detail?: Record<string, unknown>,      // opaque per-kind metadata
  triggering_event_id?: string,          // optional pointer to underlying event
}
```

**Permissive at write, structured at read.** `kind` and `source` are both free-form strings — no enum, no coordination required to ship a new kind. `severity` IS a fixed enum (analyzer renders severity buckets consistently across kinds). No `status` field on the issue event itself — status changes are separate append-only events (see next section).

## Status-change event convention (`issue_status_change` / `error_status_change`)

Triage state is DB-native — marking an issue kind or error signature as fixed / wontfix / investigating is itself an append-only event on `insights_events`. Latest event per target wins. Written by `scripts/triage_mark.ts` (or `sm triage mark`), joined at read-time by `queryIssues` / `queryErrors`.

Two event types, one per target-identifier shape:

```ts
// event_type: 'issue_status_change'  — target is issue kind
payload: {
  issue_kind: string,          // e.g. 'todo_id_serialization_malformed'
  status: 'fixed' | 'wontfix' | 'investigating',
  fixed_at?: string,           // ISO — required when status='fixed'
  fixed_in_commit?: string,    // sha
  notes?: string,
  marked_by?: string,
}

// event_type: 'error_status_change'  — target is 16-hex signature hash
payload: {
  signature_hash: string,      // sha256(signature).slice(0, 16)
  signature_preview: string,   // for human-readable audit output
  status: 'fixed' | 'wontfix' | 'investigating',
  fixed_at?, fixed_in_commit?, notes?, marked_by?,
}
```

Schema + build helpers in `smartchats-common/src/issues/types.ts` (`ISSUE_STATUS_CHANGE_EVENT_TYPE`, `ERROR_STATUS_CHANGE_EVENT_TYPE`, `buildIssueStatusChangePayload`, `buildErrorStatusChangePayload`). Direct write path in `smartchats-database/src/queries/insights.ts` (`insertInsightEvent`).

**Regression detection.** The analyzer attaches `handled?: { status, fixed_at, ..., regression }` to each row. `regression` is `true` when the target's `last_seen` is strictly newer than `fixed_at` — i.e. the same issue/error fired again after we claimed the fix. Fixed-and-quiet rows sink to the bottom + are hidden by default in the `audit:*` CLI output; regressions always surface.

**Not to be confused with** the legacy bundle-based handled-state at `data/triage/handled.json`, which the pre-DB `session_triage_errors` script writes. That file was migrated once via `npm run migrate:handled-json-to-db`; new marks go through the DB path. Both flows use a different signature hashing (bundle-side hashes the full error message; DB-side hashes `event_type:short_message`), so state doesn't cross-populate.

### Current emitters

| Emitter | Source string | When |
|---|---|---|
| `report_issue` agent tool | `agent.report_issue` | Agent fires unprompted when it notices something off, OR on user request ("flag this turn"). See `apps/smartchats/app/modules/issues.ts`. |

Detectors are deferred — the original v0 plan listed `context_bloat_scm` / `context_bloat_tool_return` / `slow_tool_call` / etc., but these can ship later as separate PRs that just call `emitIssue()`. The schema is ready; no further design needed to add them.

**Context bloat note** — when detectors do land, the bloat case is two distinct hooks, not one (we learned this the hard way — the 127K bloat in production wasn't SCM-side; it was the `metrics_context` background-loader injecting an unbounded `SELECT *` as a tool return):

- **`context_bloat_scm`** — would hook `SCM.build()`. Measures static system_prompt growth.
- **`context_bloat_tool_return`** — would hook `update_workspace` / `add_user_data_input`. Measures per-injection payload size.

Until detectors land, `analysis_db/context_growth.ts` is the analytical surrogate: it computes per-llm_invocation `input_tokens` deltas after the fact rather than emitting an issue at the time.

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

## Real-time monitoring — `monitor.ts`

Generic polling wrapper around any of the analyzers. Re-runs `queryX(client, args)` on an interval, diffs rows by caller-supplied key, renders + fires callbacks.

```ts
import { liveMonitor, queryFunctionCallHistogram } from 'smartchats-sessions';

liveMonitor({
  client, analyzer: queryFunctionCallHistogram,
  args:    { since: '24h', limit: 25 },
  format:  formatFunctionCallHistogram,
  key:     row => row.function_name,
  intervalMs: 5000,
  render:  'live-table' | 'append' | 'silent',
  onResult?, onNewRow?, onUpdate?,
  alerts?: [{ when: (row, prev) => bool, do: (row, prev) => ... }],
}).start();
```

CLI: `npm run monitor -- <analyzer> [opts]`. Ten registered analyzers (one per `query<X>`) plus the cost-by-{session,model,user} variants. Standard `BaseFilter` flags + per-analyzer extras (`--severity`, `--threshold-ms`, `--name`, etc.).

**Path A (this)**: ~5-10s polling latency. Fine for terminal-watch workloads. **Path B** (SurrealDB native `LIVE SELECT` push for sub-second latency) is a future upgrade — would slot under the same `liveMonitor()` external API. For now, polling buys the entire "watch production live" use case for ~210 lines of generic wrapper + no per-analyzer refactor.

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

## Modules shipped

| Module | Purpose | CLI |
|---|---|---|
| `_query_helpers.ts` | `BaseFilter` + `buildFilterClause` + time-shorthand parser | — |
| `_format.ts` | `renderTable / renderCsv / renderMarkdownTable` + `FormatOpts` | — |
| `cost.ts` | per-(session, model) tuple + per-session / per-model / per-user rollups | `audit:cost` |
| `slow_calls.ts` | function_end durations > threshold; flags abandoned `accumulate_text` | `audit:slow-calls` |
| `function_calls.ts` | per-function-name histogram (count, distinct sessions/users, error rate, duration stats) | `audit:function-calls` |
| `function_args.ts` | filter by name + args predicate (e.g. `save_log category=dreams`) | `audit:function-args` |
| `errors.ts` | function_error sub-events + top-level error event histograms | `audit:errors` |
| `users.ts` | per-user activity rollup (sessions, executions, cost, errors, function coverage) | `audit:users` |
| `context_growth.ts` | LLM prompt-size outliers (absolute or within-session jump) | `audit:context-growth` |
| `issues.ts` | per-kind issue histogram with severity bucket counts | `audit:issues` |
| `monitor.ts` | generic polling wrapper around any analyzer + alert callbacks | `monitor` |

Roadmap complete. Future work lands as new modules in this directory following the same `queryX` + `formatX` pattern.

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
