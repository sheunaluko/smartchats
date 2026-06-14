/**
 * smartchats-sessions — public API.
 *
 * Three layers:
 *   • types.ts     — bundle format + filter types
 *   • queries.ts   — pure SurrealQL builders
 *   • export.ts    — orchestration (build bundle, write to disk, multi-session)
 *   • summary.ts   — pure helpers to compute summary blocks (re-exportable for analyzers)
 *   • analysis/*   — scaffolding for higher-level analysis modules
 */

// Types
export type {
    InsightEventRow,
    SessionTimelineEntry,
    SessionSummary,
    SessionMetadata,
    SessionBundle,
    SessionEventsFilter,
    FindSessionsArgs,
    SessionDescriptor,
    CandidateSessionsFilter,
    SessionCandidate,
} from './types.js';
export { EXPORTER_VERSION } from './types.js';

// Query builders
export {
    getSessionEventsQuery,
    findSessionsQuery,
    findCandidateSessionsQuery,
} from './queries.js';

// Summary helpers
export {
    computeSummary,
    rowsToTimeline,
    rowToTimelineEntry,
    normalizeTimestamp,
} from './summary.js';

// Orchestration
export {
    getSessionEvents,
    findSessions,
    findCandidateSessions,
    buildBundle,
    buildSessionBundle,
    exportSessionToFile,
    exportRecentSessionsToFiles,
    formatBundleFilename,
} from './export.js';
export type { ExportOptions, ExportResult } from './export.js';

// Analysis modules (pure functions over a SessionBundle)
export { analyzeTranscript, formatTranscript } from './analysis/transcript.js';
export type { TranscriptResult, TranscriptTurn, TurnRole, TranscriptFormatOpts } from './analysis/transcript.js';

export { analyzeErrors, formatErrors } from './analysis/errors.js';
export type { ErrorsResult, ErrorRecord } from './analysis/errors.js';

export { analyzePerformance, formatPerformance } from './analysis/performance.js';
export type {
    PerformanceResult,
    LlmCallStat,
    ExecutionStat,
    VoicePipelineStat,
    LatencyHistogram,
} from './analysis/performance.js';

export { buildTraceTrees, formatTraces } from './analysis/traces.js';
export type { TracesResult, TraceTree, TraceNode, TracesFormatOpts } from './analysis/traces.js';

export { analyzeExecutions, formatExecutions } from './analysis/executions.js';
export type { ExecutionsResult, ExecutionRecord, FunctionCallRecord } from './analysis/executions.js';

export { inspectEvent, inspectTrace, formatInspectEvent, formatInspectTrace } from './analysis/inspect.js';
export type { InspectEventResult } from './analysis/inspect.js';

export {
    mergeErrorsAcrossSessions,
    formatTriageReport,
    formatTriageIndex,
    formatWontfixSummary,
    slugifySignature,
    signatureHash,
    applyHandledState,
    emptyHandledState,
} from './analysis/triage_errors.js';
export type {
    TriageErrorReport,
    TriageSessionRef,
    TriageFnCall,
    MergeOptions as TriageMergeOptions,
    HandledState,
    HandledEntry,
    AnnotatedTriageReport,
    TriageOutcome,
} from './analysis/triage_errors.js';

// CLI orchestration helpers (shared by open + closed `session_find` wrappers)
export {
    runFindCli,
    parseFindArgs,
    formatCandidates,
    parseTimeSpec,
    parseDurationSpec,
} from './cli/find_cli.js';
export type { OutputFormat as FindOutputFormat, ParsedFindArgs, RunFindCliOptions } from './cli/find_cli.js';

// ──────────────────────────────────────────────────────────────────────────
// DB-side analysis modules (pure-aside-from-Client; see src/analysis_db/README.md)
// ──────────────────────────────────────────────────────────────────────────

export {
    buildFilterClause,
    combineWhere,
} from './analysis_db/_query_helpers.js';
export type { BaseFilter, FilterClause } from './analysis_db/_query_helpers.js';

export {
    renderTable,
    renderCsv,
    renderMarkdownTable,
    renderJson,
    renderRows,
    fmtDuration as fmtDurationDb,
    fmtUsd,
} from './analysis_db/_format.js';
export type { OutputFormat, FormatOpts } from './analysis_db/_format.js';

export {
    queryCostByCallTuple,
    queryCostBySession,
    queryCostByModel,
    queryCostByUser,
    formatCost,
} from './analysis_db/cost.js';
export type {
    CostByCallTupleRow,
    CostBySessionRow,
    CostByModelRow,
    CostByUserRow,
    CostResult,
} from './analysis_db/cost.js';
