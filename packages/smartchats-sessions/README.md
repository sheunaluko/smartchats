# smartchats-sessions

Session export + analysis tooling for SmartChats. Downloads `insights_events` bundles from any SurrealDB-backed deployment (local AIO, self-hosted, cloud) and produces a stable JSON format suitable for offline inspection, automated analysis, and the autonomous debug loop.

## Why this package exists

Every SmartChats deployment writes structured telemetry to the `insights_events` table — every store action, every LLM call, every code execution, every voice event. The data is rich (~hundreds of events per session) and the **only reliable mechanism** for after-the-fact debugging.

This package gives you:

- A small, stable JSON bundle format (one per session) — produced by `exportSessionsToFile`.
- Pure-function builders + computation helpers — no SurrealDB SDK in the public API surface (you bring a `Client` from `smartchats-database`, we run the queries against it).
- A scaffolded `analysis/` directory: drop your own modules in there to turn a bundle into a higher-level artifact (transcripts, error reports, performance summaries, custom metrics — whatever your use case demands).

## Package layout

```
src/
├── index.ts                     public exports
├── types.ts                     SessionBundle, SessionMetadata, SessionSummary, etc.
├── queries.ts                   QuerySpec builders for insights_events lookups
├── export.ts                    getSessionEvents, findCandidateSessions, exportSessionToFile
├── summary.ts                   compute event_types histogram, token totals, llm invocations
├── cli/find_cli.ts              shared CLI orchestration for session_find (open + closed wrappers)
└── analysis/                    pure analyzers + their renderers
    ├── README.md                module conventions
    ├── transcript.ts, errors.ts, performance.ts,
    │   traces.ts, executions.ts, inspect.ts
    └── triage_errors.ts         cross-session merge + handled-state filtering

scripts/
├── save_session.ts              GET → bundle JSON on disk
├── session_find.ts              cross-session DB triage (local AIO defaults)
├── session_summary.ts           and per-bundle analyzer wrappers:
├── session_transcript.ts, session_errors.ts, session_performance.ts,
│   session_traces.ts, session_tools.ts, session_inspect.ts
├── session_triage_errors.ts     cross-session error triage (file in / file out)
└── triage_mark.ts               mark signatures fixed / wontfix / investigating
```

## Bundle format

Every export produces a JSON file in this stable shape:

```jsonc
{
  "session_id": "ses_...",
  "metadata": {
    "app_name": "smartchats",
    "user_id": "...",                    // empty string when self-hosted/anonymous
    "session_tags": ["simi", "smoke"],   // normalized array
    "start_time": "...",                  // ISO datetime, earliest event in session
    "end_time": "...",                    // ISO datetime, latest event in session
    "duration_ms": 1234,
    "event_count": 202,
    "export_timestamp": "...",
    "exporter_version": "1.0.0"           // bumps on bundle-shape changes
  },
  "summary": {
    "event_types": { "<type>": <count>, ... },
    "total_tokens": 0,
    "total_prompt_tokens": 0,
    "total_completion_tokens": 0,
    "llm_invocations": 0,
    "error_count": 0,
    "trace_count": 0,
    "avg_llm_latency_ms": 0
  },
  "timeline": [
    { "timestamp": <epoch_ms>, "event_id": "evt_...", "event_type": "...", "payload": { ... } },
    ...
  ]
}
```

Bundle shape is intentionally simple and analyzer-friendly. Once written, treat as immutable: future exporter versions append to the metadata/summary blocks without removing fields, so existing analyzers stay compatible.

## Connection patterns

This package is **transport-agnostic** — it queries via the `Client` interface from `smartchats-database`. Caller decides how to construct the client:

- **Local AIO**: `createClient({url: 'ws://localhost:8000/rpc', ns: 'production', db: 'main', auth: { username: 'root', password: 'root' }})`
- **Self-hosted**: same shape, different URL
- **Cloud**: `createClient` with `SURREAL_TIDYSCRIPTS_BACKEND_*` env vars (root creds — `insights_events` has `PERMISSIONS NONE` so user JWTs cannot read it)

The `scripts/save_session.ts` CLI handles the local-AIO case out of the box. The cloud path lives in `packages/smartchats-cloud/scripts/cloud_save_session.ts` (closed-source, mirrors the structure but configures cloud creds).

## CLI usage

### Export (one session → bundle JSON on disk)

```bash
# Most recent session for the smartchats app from local AIO
npm run save-session -- --app smartchats

# Filter by tags
npm run save-session -- --app smartchats --tag simi,smoke

# Multi-export
npm run save-session -- --app smartchats --last 5

# Specific session id
npm run save-session -- --session-id ses_abc123

# Custom output dir
npm run save-session -- --app smartchats --out ~/my-exports/
```

For cloud admin (closed): `packages/smartchats-cloud/scripts/cloud_save_session.ts` wraps the same flow with `SMARTCHATS_CLOUD_*` root creds. The admin UI (`packages/smartchats-cloud-admin-ui`) also downloads bundles into the canonical local dir (`~/.smartchats/session_bundles/`).

### Triage (cross-session query against the DB)

```bash
# Most recent sessions for an app
npm run find-sessions -- --app smartchats --limit 10

# Only sessions with at least one error event
npm run find-sessions -- --app smartchats --has-error --since 7d

# Sessions where the user interrupted the agent (llm_cancel emitted)
npm run find-sessions -- --has-event-type llm_cancel

# Pipe into save-session: pull every error session in the last day
npm run find-sessions -- --has-error --since 24h --format=ids \
  | xargs -I{} npm run save-session -- --session-id {}
```

Defaults to local AIO (`ws://localhost:8000/rpc`, root/root). **Does not** target cloud — for cloud admin triage across all users see `packages/smartchats-cloud/scripts/cloud_session_find.ts` (closed package). Both share the same query builder + dispatcher (`findCandidateSessions`) and CLI orchestration (`runFindCli`); only the connection wiring differs. See `data/ARCHITECTURE_NOTES.md` for the open/closed security boundary.

### Per-session analysis (against a bundle)

After pulling a bundle to disk:

```bash
npm run analyze:summary      -- <bundle.json>      # counts, latency, top errors/tools
npm run analyze:transcript   -- <bundle.json> --markdown --with-code
npm run analyze:errors       -- <bundle.json>
npm run analyze:performance  -- <bundle.json>
npm run analyze:traces       -- <bundle.json> --min-events=10
npm run analyze:tools        -- <bundle.json>
npm run analyze:inspect      -- <bundle.json> --event=<id>
```

Each analyzer is a pure function over a `SessionBundle` (`analyze*`) plus a renderer (`format*`). Use them programmatically via `import { analyzeErrors, formatErrors } from 'smartchats-sessions'`.

### Cross-session error triage (the autonomous-fix-loop driver)

`analyze:errors` is per-bundle. The triage layer merges errors **across all bundles in a directory** by signature so the same failure appearing in 10 sessions becomes one report covering all of them.

```bash
# Default: ./triage/<timestamp>/ , bundles from ~/.smartchats/session_bundles
npm run triage:errors

# Window + app filter + skip one-offs
npm run triage:errors -- --since 7d --app smartchats --min-count 2

# Preview without writing
npm run triage:errors -- --dry-run
```

Each run produces:

```
triage/2026-05-13_090818/
├── README.md                              # index ranked by frequency
├── 01_<slug>.md                           # one file per unique signature
├── 02_<slug>.md
├── ...
└── wontfix_summary.md                     # only if any wontfix entries were suppressed
```

Per-signature reports contain: full signature, affected-sessions table, deduped sample failing code, function calls involved, sample user inputs, sample agent thoughts, and an empty **`## Suggested fix`** stub — the Phase-C hook for a sub-agent to fill in later.

#### Handled-state — "we already fixed this, don't surface it again"

`triage:errors` reads a JSON file (`<repo>/data/triage/handled.json` by default; override via `--state` or `SMARTCHATS_TRIAGE_STATE_FILE`) listing signatures that have been triaged. Three statuses:

- **`fixed`** — patch landed at `fixed_at`. Suppressed in future runs *unless* a session newer than `fixed_at` appears, in which case the report **re-surfaces with title `REGRESSION:` …** and sessions filtered to only the post-fix ones. Counts recomputed.
- **`wontfix`** — acknowledged out-of-scope (flaky upstream, intentional, etc). Always suppressed; surfaced separately in `wontfix_summary.md` so they don't go silent.
- **`investigating`** — claimed but not yet resolved. Reports surface with title prefixed `[investigating]`.

The state file is keyed by signature SHA-256 (16 hex chars). Mark entries via the tiny CLI rather than hand-editing:

```bash
# Path to a triage report → extracts the signature automatically
npm run triage:mark -- triage/<run>/01_xxx.md --status fixed --commit abc1234 --notes "fixed in PR #42"

# Or by slug (auto-finds the matching report in the latest run dir)
npm run triage:mark -- surrealdb-incorrect-arguments-for-functi --status wontfix --notes "upstream"

# Predate the fix
npm run triage:mark -- <slug> --status fixed --fixed-at 2026-05-09T00:00:00Z --commit deadbeef

# Unmark (path, slug, or 16-hex hash)
npm run triage:mark -- <target> --unmark

# List everything
npm run triage:mark -- --list
```

The next `triage:errors` run reads the updated state and applies the new status. Commit `data/triage/handled.json` so the team shares the same "what we've done" history.

## Adding a new analysis module

See `src/analysis/README.md`. TL;DR: drop a `<concern>.ts` file in `src/analysis/` exporting one or more pure functions that take a `SessionBundle` (or `SessionBundle[]`) and return a higher-level artifact. Keep them dependency-light; if you need charts / markdown / etc, add deps to this package and document them.

| Module | Status |
|---|---|
| `transcript.ts` | ✅ |
| `errors.ts` | ✅ |
| `performance.ts` | ✅ |
| `traces.ts` | ✅ |
| `executions.ts` | ✅ |
| `inspect.ts` | ✅ |
| `triage_errors.ts` — cross-session signature merge + handled-state | ✅ |
| `diff.ts` — compare two bundles, highlight drift | not started |
| `regression.ts` — invariant assertions against a bundle | not started |
| `triage_fix_agent.ts` — Phase-C sub-agent driver per triage report | not started |

Architecturally these all consume bundles, not raw query results — keeps the analysis surface decoupled from the data layer.
