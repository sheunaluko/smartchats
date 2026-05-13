# analysis/ — session analysis modules

Pure analyzers over a `SessionBundle`. Each module exports:

1. One or more **`analyze*` / `build*` / `inspect*` functions** — take a bundle, return a typed result.
2. A matching **`format*` function** — render the result to a human-readable string (plain or markdown).

No I/O. No SurrealDB SDK access. No `process.env`, no `fs`, no `fetch`. Side-effecting wrappers live in `../scripts/`.

## Modules

| File | Analyzer | Formatter | Output |
|---|---|---|---|
| `transcript.ts`  | `analyzeTranscript`   | `formatTranscript`   | user/agent turns + thoughts (+ optional code) |
| `errors.ts`      | `analyzeErrors`       | `formatErrors`       | every failure, grouped by signature, with preceding user input + code + fn calls |
| `performance.ts` | `analyzePerformance`  | `formatPerformance`  | LLM latency histogram, TTFC, code execution latency, voice pipeline, pacing |
| `traces.ts`      | `buildTraceTrees`     | `formatTraces`       | causality trees grouped by `trace_id` |
| `executions.ts`  | `analyzeExecutions`   | `formatExecutions`   | per-execution code + function/tool calls with args, results, errors, durations |
| `inspect.ts`     | `inspectEvent` / `inspectTrace` | `formatInspectEvent` / `formatInspectTrace` | single-event deep dump with parent chain + children + trace siblings |
| `triage_errors.ts` | `mergeErrorsAcrossSessions` / `applyHandledState` | `formatTriageReport` / `formatTriageIndex` / `formatWontfixSummary` | cross-session signature merge + handled-state filtering for the triage CLI |
| `_format.ts`     | — | — | shared helpers (`fmtClock`, `fmtDuration`, `percentile`, `truncate`, etc.) |

All re-exported from `../index.ts` so consumers can `import { analyzeX } from 'smartchats-sessions'`.

## Adding a new module

1. Create `your_concern.ts` in this directory.
2. Export `analyzeYourConcern(bundle: SessionBundle): YourConcernResult` (pure).
3. Export `formatYourConcern(result, opts?): string`.
4. Re-export both from `../index.ts`.
5. Add a CLI driver at `../scripts/session_your_concern.ts` (model on the existing ones — `_cli_lib.ts` has the shared parse/load/die helpers).
6. Wire an `analyze:your-concern` script in `package.json`.

## Conventions

- **Pure.** Every analyzer is a function of its input. No singletons, no module-level state, no I/O.
- **One concern per file.** Composite analyses (e.g. "full report") consume from the per-concern modules. Don't co-locate.
- **Bundle-shape compatible.** Use `SessionBundle` from `../types.ts`. If a module needs new fields that the bundle doesn't carry, bump `EXPORTER_VERSION` in `../types.ts` and update the exporter before adding the analyzer.
- **Formatter is optional but encouraged.** The CLI scripts always use the formatter; programmatic consumers can skip straight to the structured result.
- **Permissive parsing.** Cloud + local bundle versions drift over time; analyzers should optional-chain through payloads and surface what's available rather than crashing on shape drift.

## Future work (roadmap, not blocked on anything)

| Module | Purpose | Status |
|---|---|---|
| `diff.ts` | compare two bundles, highlight drift | not started |
| `regression.ts` | invariant assertions against a bundle (used by automated runs) | not started |
| `cost.ts` | per-call $ cost from model registry × token counts | not started |
| `thoughts_drift.ts` | when agent thoughts diverge from spoken response | not started |
| `triage_fix_agent.ts` | Phase-C hook: drive a sub-agent against a triage report to fill `## Suggested fix` and open a draft PR | not started |
