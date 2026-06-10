/**
 * SmartChats query builders — pure SurrealQL specs.
 *
 * Each function returns a `QuerySpec` ({ query, variables }) ready to
 * hand to a dispatcher. No I/O, no auth, no execution. Consumers run
 * the spec via their own backend (cloud-client for MCP/CLI; in-app
 * `getBackend().data.query()` for the smartchats web app; or the
 * `createClient()` factory in this package for direct SDK access).
 */

// Logs
export type {
    LogRow,
    InsertLogArgs,
    UpdateLogPatch,
    ListLogsArgs,
    SearchLogsSemanticArgs,
} from './logs.js';
export {
    getLogCategories,
    getPreparedLogCategories,
    insertLog,
    updateLog,
    deleteLog,
    listLogs,
    searchLogsSemantic,
    findLogByCategory,
    findPreparedLogCategory,
    insertPreparedLogCategory,
} from './logs.js';

// Metrics
export type {
    MetricRow,
    GetMetricsArgs,
    InsertMetricArgs,
    InsertPreparedMetricArgs,
    UpdateMetricPatch,
    MetricsQuerySpec,
    MetricsTimeFilterCtx,
} from './metrics.js';
export {
    getMetrics,
    getMetricsSummary,
    getRecentMetrics,
    getPreparedMetricDefinitions,
    insertMetric,
    updateMetric,
    deleteMetric,
    getHabitDoneTimestamps,
    findMetricByName,
    findPreparedMetric,
    insertPreparedMetric,
    buildMetricsQuery,
    buildMetricsTimeFilter,
} from './metrics.js';

// Todos
export type { TodoRow, TodoStatus, GetTodosArgs, InsertTodoArgs, InsertTodoCompletionArgs } from './todos.js';
export {
    getTodos,
    getAllActiveTodos,
    getCompletionsInPeriod,
    getLastCompletion,
    getTodoById,
    insertTodo,
    insertTodoCompletion,
    setTodoStatus,
    rescheduleTodo,
    editTodo,
    deleteCompletionsForTodo,
    deleteTodoById,
} from './todos.js';

// Knowledge graph
export type {
    EntityRow,
    RelationRow,
    QueryKnowledgeGraphArgs,
    EntityInsertSpec,
    RelationInsertSpec,
    KnnSearchArgs,
} from './knowledge_graph.js';
export {
    searchEntitiesByName,
    searchRelationsByName,
    checkExistingEntityNames,
    checkExistingRelationNames,
    buildKnowledgeInsertQuery,
    knnSearchEntities,
    knnSearchRelations,
    getRelationsTouchingEntities,
    getAllEntities,
    getAllRelations,
    deleteRelationByName,
    deleteRelationsTouchingEntity,
    deleteEntityByName,
    getEntityRelations,
} from './knowledge_graph.js';

// Sessions
export type { SessionSummaryRow, ListSessionsArgs, SearchSessionsArgs, SessionWriteFields } from './sessions.js';
export {
    listSessions,
    searchSessions,
    loadSession,
    insertSession,
    updateSession,
    deleteSession,
} from './sessions.js';

// Apps (registry + installs)
export type {
    AppManifestRow,
    AppInstallRow,
    InsertAppArgs,
    InsertInstallArgs,
} from './apps.js';
export {
    insertApp,
    getAppByAppId,
    updateApp,
    deleteAppByAppId,
    searchApps,
    listApps,
    incrementAppInstallCount,
    insertInstall,
    getInstallByAppId,
    updateInstall,
    deleteInstallByAppId,
    listInstalls,
} from './apps.js';

// Dynamic functions
export type { InsertDynamicFunctionArgs } from './dynamic_functions.js';
export {
    insertDynamicFunction,
    loadDynamicFunction,
    listDynamicFunctions,
    updateDynamicFunction,
    deleteDynamicFunction,
} from './dynamic_functions.js';

// Procedural instructions
export type { InsertProceduralInstructionArgs } from './procedural_instructions.js';
export {
    getProceduralInstructions,
    insertProceduralInstruction,
    updateProceduralInstruction,
    deleteProceduralInstruction,
    searchProceduralInstructions,
} from './procedural_instructions.js';

// Initialization instructions
export type { InsertInitInstructionArgs } from './initialization.js';
export {
    getInitInstructions,
    insertInitInstruction,
    updateInitInstruction,
    deleteInitInstruction,
} from './initialization.js';

// Raw SQL passthrough (read-only validation)
export { buildRawQuery, NonReadOnlyQueryError } from './raw.js';

// Health probes
export { probeTableExists } from './health.js';

// BYO API keys (local self-hosted)
export { getByoKey, upsertByoKey, deleteByoKey } from './byo_keys.js';

// Usage tracking (local + cloud)
export type { InsertUsageRecordArgs } from './usage.js';
export {
    listUsageRecords,
    getUsageRecordsSince,
    insertUsageRecord,
} from './usage.js';

// Import / export (generic SurrealQL constructors used by the MCP migration tools)
export {
    IMPORT_STRIP_FIELDS,
    ISO_DATETIME_RE,
    RELATION_TABLES,
    buildUpsertQuery,
    buildRelateQuery,
    buildImportQuery,
    exportTablePage,
} from './import_export.js';
