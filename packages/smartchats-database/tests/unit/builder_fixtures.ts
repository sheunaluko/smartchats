/**
 * Representative arguments for every exported query builder.
 *
 * These feed `builder_snapshots.test.ts`, which snapshots the
 * `{ query, variables }` each builder emits. The snapshot file is the
 * golden record of our SurrealQL surface: a schema change shows up as a
 * reviewable diff instead of a scavenger hunt through hand-written
 * assertions.
 *
 * Every exported builder MUST appear here. The snapshot test fails on any
 * export without a fixture, so a newly added builder can't slip through
 * uncovered — the failure tells you to add one.
 *
 * Fixtures must be DETERMINISTIC. Anything reading the wall clock
 * (`buildMetricsTimeFilter` with `recency`, which computes a cutoff from
 * `Date.now()`) would churn the snapshot on every run, so the fixtures
 * here use calendar filters. Wall-clock behaviour is covered by the
 * assertion-style tests in `metrics.test.ts` instead.
 */

import * as builders from '../../src/queries/index.js';
import type { MetricsTimeFilterCtx } from '../../src/queries/index.js';

/** Frozen tz helper so date resolution never depends on the run date. */
const ctx: MetricsTimeFilterCtx = {
    getCurrentLocalDate: () => '2026-06-01',
};

/** The v1.0.0 event-time triple, fixed. */
const EVENT_TIME = {
    ts: '2026-03-23T15:04:05.000Z',
    local_date: '2026-03-23',
    local_tz: 'America/Chicago',
} as const;

/** Short, obviously-fake vector — real ones would bloat the snapshot. */
const EMBEDDING = [0.1, 0.2, 0.3];

/** Shared by insertSession / updateSession so the pair stays comparable. */
const SESSION_WRITE = {
    label: 'dentist planning',
    message_count: 4,
    chat_history: [{ role: 'user', content: 'hi' }],
    workspace: { open_tab: 'logs' },
    thought_history: [],
    execution_history: [],
    settings: { model: 'gpt-4o' },
    ...EVENT_TIME,
};

/** Full app manifest — every field the INSERT touches. */
const APP_ARGS = {
    app_id: 'com.example.app',
    name: 'Example',
    version: '1.0.0',
    description: 'an example mini-app',
    author: { name: 'someone' },
    icon: null,
    source: 'builtin',
    categories: ['health'],
    tags: ['demo'],
    embedding: EMBEDDING,
    modules: {},
    interaction_mode: 'widget',
    html_templates: {},
    display_mode: 'panel',
    state_schema: {},
    permissions: {},
    requested_functions: [],
    voice_hooks: null,
    on_activate: null,
    on_deactivate: null,
    external_scripts: null,
    migrations: null,
    min_tier: 'free',
    version_history: [],
    forked_from: null,
    _content_hash: 'deadbeef',
    published_at: null,
};

/**
 * Exports that aren't query builders and so have no spec to snapshot.
 * Keep this list tiny and justified.
 */
export const NON_BUILDER_EXPORTS = new Set([
    'NonReadOnlyQueryError', // error class, not a builder
]);

export const BUILDER_FIXTURES: Record<string, () => unknown> = {
    // ── logs ──────────────────────────────────────────────────────────
    getLogCategories: () => builders.getLogCategories(),
    getPreparedLogCategories: () => builders.getPreparedLogCategories(),
    insertLog: () => builders.insertLog({ content: 'slept badly', category: 'sleep', embedding: EMBEDDING, ...EVENT_TIME }),
    updateLog: () => builders.updateLog({ recordId: 'logs:abc', patch: { content: 'edited', category: 'mood', ...EVENT_TIME } }),
    deleteLog: () => builders.deleteLog('logs:abc'),
    listLogs: () => builders.listLogs({ category: 'Mood', searchText: '  tired  ', dateFilter: " AND local_date >= '2026-03-01'", limit: 25 }),
    searchLogsSemantic: () => builders.searchLogsSemantic({ embedding: EMBEDDING, category: 'mood', limit: 5 }),
    findLogByCategory: () => builders.findLogByCategory('mood'),
    findPreparedLogCategory: () => builders.findPreparedLogCategory('mood'),
    insertPreparedLogCategory: () => builders.insertPreparedLogCategory({ category: 'mood', description: 'how I felt' }),

    // ── metrics ───────────────────────────────────────────────────────
    getMetrics: () => builders.getMetrics({ metric_name: 'steps', category: 'fitness', from_date: '2026-01-01', to_date: '2026-01-31', limit: 25 }),
    getMetricsSummary: () => builders.getMetricsSummary(),
    getRecentMetrics: () => builders.getRecentMetrics({ limit: 10 }),
    getLatestMetricPerName: () => builders.getLatestMetricPerName(),
    getPreparedMetricDefinitions: () => builders.getPreparedMetricDefinitions(),
    insertMetric: () => builders.insertMetric({
        metric_name: 'steps', value: 8000, unit: 'count', metric_type: 'numeric',
        source: 'manual', source_text: 'walked 8000 steps', source_log_id: null,
        category: 'fitness', time_shift_quantity: null, time_shift_unit: null, note: null,
        ...EVENT_TIME,
    }),
    updateMetric: () => builders.updateMetric({ recordId: 'metrics:abc', patch: { value: 9000, category: 'fitness', note: null, source_text: 'corrected' } }),
    deleteMetric: () => builders.deleteMetric('metrics:abc'),
    getHabitDoneTimestamps: () => builders.getHabitDoneTimestamps({ metric_name: 'meditate', dateFilter: " AND local_date >= '2026-03-01'" }),
    findMetricByName: () => builders.findMetricByName('steps'),
    findPreparedMetric: () => builders.findPreparedMetric('steps'),
    insertPreparedMetric: () => builders.insertPreparedMetric({ metric_name: 'steps', unit: 'count', metric_type: 'numeric', category: 'fitness' }),
    buildMetricsQuery: () => builders.buildMetricsQuery({ metric_name: 'steps', metric_names: ['steps', 'water'], group_mode: 'stacked', aggregation: 'weekly_avg', from_date: '2026-03-01', to_date: '2026-03-31' }, 'America/Chicago', ctx),
    buildMetricsTimeFilter: () => builders.buildMetricsTimeFilter({ from_date: '2026-03-01' }, 'America/Chicago', ctx),

    // ── todos ─────────────────────────────────────────────────────────
    getTodos: () => builders.getTodos({ status: 'active', limit: 25 }),
    getAllActiveTodos: () => builders.getAllActiveTodos(),
    getCompletionsInPeriod: () => builders.getCompletionsInPeriod({ parentId: 'user_data:abc', start: '2026-03-01T00:00:00Z', end: '2026-03-31T23:59:59Z' }),
    getCompletionsForTodos: () => builders.getCompletionsForTodos({ parentIds: ['user_data:a', 'user_data:b'], start: '2026-03-01T00:00:00Z', end: '2026-03-31T23:59:59Z' }),
    getLastCompletion: () => builders.getLastCompletion({ parentId: 'user_data:abc' }),
    getTodoById: () => builders.getTodoById('user_data:abc'),
    insertTodo: () => builders.insertTodo({
        title: 'call the dentist', description: null, priority: 'high', category: 'health',
        due_date: '2026-03-30', recurrence: null, metric_link: null,
        source_text: 'remind me to call the dentist', due_at: '2026-03-30T17:00:00.000Z',
        tags: ['health'], ...EVENT_TIME,
    }),
    insertTodoCompletion: () => builders.insertTodoCompletion({ parent_id: 'user_data:abc', note: 'done early', ...EVENT_TIME }),
    setTodoStatus: () => builders.setTodoStatus({ recordId: 'user_data:abc', status: 'completed' }),
    rescheduleTodo: () => builders.rescheduleTodo({ recordId: 'user_data:abc', new_due_date: '2026-04-01', new_recurrence: { every: 'week' } }),
    editTodo: () => builders.editTodo({ recordId: 'user_data:abc', updates: { title: 'call the dentist back', priority: 'low' } }),
    deleteCompletionsForTodo: () => builders.deleteCompletionsForTodo({ parentId: 'user_data:abc' }),
    deleteTodoById: () => builders.deleteTodoById('user_data:abc'),

    // ── knowledge graph ───────────────────────────────────────────────
    searchEntitiesByName: () => builders.searchEntitiesByName({ query: 'Leo', limit: 10 }),
    searchRelationsByName: () => builders.searchRelationsByName({ query: 'owns', limit: 10 }),
    checkExistingEntityNames: () => builders.checkExistingEntityNames(['Leo', 'Ada']),
    checkExistingRelationNames: () => builders.checkExistingRelationNames(['owns', 'knows']),
    buildKnowledgeInsertQuery: () => builders.buildKnowledgeInsertQuery({
        entities: [{ name: 'Leo', embedding: EMBEDDING }],
        relations: [{ name: 'owns', sourceName: 'Leo', targetName: 'guitar', kind: 'possession', embedding: EMBEDDING }],
        ...EVENT_TIME,
    }),
    knnSearchEntities: () => builders.knnSearchEntities({ embedding: EMBEDDING, limit: 5, effort: 40 }),
    knnSearchRelations: () => builders.knnSearchRelations({ embedding: EMBEDDING, limit: 5, effort: 40 }),
    getRelationsTouchingEntities: () => builders.getRelationsTouchingEntities(['Leo', 'Ada']),
    getAllEntities: () => builders.getAllEntities({ limit: 100 }),
    getAllRelations: () => builders.getAllRelations({ limit: 100, entity: 'Leo' }),
    deleteRelationByName: () => builders.deleteRelationByName('owns'),
    deleteRelationsTouchingEntity: () => builders.deleteRelationsTouchingEntity('Leo'),
    deleteEntityByName: () => builders.deleteEntityByName('Leo'),
    getEntityRelations: () => builders.getEntityRelations('Leo'),

    // ── sessions ──────────────────────────────────────────────────────
    listSessions: () => builders.listSessions({ limit: 25 }),
    searchSessions: () => builders.searchSessions({ query: 'dentist', limit: 25 }),
    loadSession: () => builders.loadSession('sessions:abc'),
    insertSession: () => builders.insertSession(SESSION_WRITE),
    updateSession: () => builders.updateSession('sessions:abc', SESSION_WRITE),
    deleteSession: () => builders.deleteSession('sessions:abc'),

    // ── apps + installs ───────────────────────────────────────────────
    insertApp: () => builders.insertApp(APP_ARGS),
    getAppByAppId: () => builders.getAppByAppId('com.example.app'),
    updateApp: () => builders.updateApp({ app_id: 'com.example.app', patch: { name: 'Renamed', version: '2.0.0' }, embedding: EMBEDDING }),
    deleteAppByAppId: () => builders.deleteAppByAppId('com.example.app'),
    searchApps: () => builders.searchApps({ embedding: EMBEDDING, limit: 5 }),
    listApps: () => builders.listApps({ source: 'builtin', category: 'health' }),
    incrementAppInstallCount: () => builders.incrementAppInstallCount('com.example.app'),
    insertInstall: () => builders.insertInstall({
        app_id: 'com.example.app', installed_version: '1.0.0', granted_permissions: ['read'],
        app_state: {}, config: {}, last_activated_at: null, activation_count: 0,
    }),
    getInstallByAppId: () => builders.getInstallByAppId('com.example.app'),
    updateInstall: () => builders.updateInstall({ app_id: 'com.example.app', patch: { installed_version: '2.0.0', activation_count: 3 } }),
    deleteInstallByAppId: () => builders.deleteInstallByAppId('com.example.app'),
    listInstalls: () => builders.listInstalls(),

    // ── dynamic functions ─────────────────────────────────────────────
    insertDynamicFunction: () => builders.insertDynamicFunction({ name: 'greet', description: 'say hi', code: 'return "hi"', params_schema: {}, embedding: EMBEDDING }),
    loadDynamicFunction: () => builders.loadDynamicFunction('greet'),
    listDynamicFunctions: () => builders.listDynamicFunctions(),
    updateDynamicFunction: () => builders.updateDynamicFunction({ name: 'greet', patch: { code: 'return "hello"', description: 'say hello' }, embedding: EMBEDDING }),
    deleteDynamicFunction: () => builders.deleteDynamicFunction('greet'),

    // ── procedural + init instructions (both live in `cortex`) ────────
    getProceduralInstructions: () => builders.getProceduralInstructions({ category: 'tone' }),
    insertProceduralInstruction: () => builders.insertProceduralInstruction({ content: 'be brief', category: 'tone', embedding: EMBEDDING }),
    updateProceduralInstruction: () => builders.updateProceduralInstruction({ recordId: 'cortex:abc', patch: { content: 'be briefer' }, embedding: EMBEDDING }),
    deleteProceduralInstruction: () => builders.deleteProceduralInstruction('cortex:abc'),
    searchProceduralInstructions: () => builders.searchProceduralInstructions({ embedding: EMBEDDING, limit: 5 }),
    getInitInstructions: () => builders.getInitInstructions(),
    insertInitInstruction: () => builders.insertInitInstruction({ content: 'greet the user', category: null, embedding: EMBEDDING }),
    updateInitInstruction: () => builders.updateInitInstruction({ recordId: 'cortex:abc', patch: { content: 'greet warmly' }, embedding: EMBEDDING }),
    deleteInitInstruction: () => builders.deleteInitInstruction('cortex:abc'),

    // ── raw / health / insights / byo keys ────────────────────────────
    buildRawQuery: () => builders.buildRawQuery('SELECT * FROM logs LIMIT $n', { n: 5 }),
    probeTableExists: () => builders.probeTableExists('logs'),
    insertInsightEvent: () => builders.insertInsightEvent({
        event_type: 'issue_status_change', event_id: 'evt_1', payload: { status: 'fixed' },
        timestamp: '2026-03-23T15:04:05.000Z', session_id: 'sessions:abc', trace_id: 'trace_1',
        user_id: 'local-user', app_name: 'smartchats',
    }),
    getByoKey: () => builders.getByoKey('openai'),
    upsertByoKey: () => builders.upsertByoKey({ provider: 'openai', key: 'sk-test' }),
    deleteByoKey: () => builders.deleteByoKey('openai'),

    // ── usage ─────────────────────────────────────────────────────────
    listUsageRecords: () => builders.listUsageRecords({ limit: 25, startAfter: '2026-03-23T15:04:05.000Z' }),
    getUsageRecordsSince: () => builders.getUsageRecordsSince('2026-03-01T00:00:00.000Z'),
    insertUsageRecord: () => builders.insertUsageRecord({
        model: 'gpt-4o', provider: 'openai', inputTokens: 10, outputTokens: 20,
        cachedInputTokens: 5, costUsd: 0.001, sessionId: 'sessions:abc', requestType: 'llm',
    }),

    // ── import / export ───────────────────────────────────────────────
    buildUpsertQuery: () => builders.buildUpsertQuery('logs', 'abc', { content: 'hi', category: 'mood', ...EVENT_TIME }),
    buildRelateQuery: () => builders.buildRelateQuery('user_relations', 'abc', { in: 'user_entities:leo', out: 'user_entities:guitar', name: 'owns' }),
    buildImportQuery: () => builders.buildImportQuery('logs', 'abc', { content: 'hi', ...EVENT_TIME }),
    exportTablePage: () => builders.exportTablePage({ table: 'logs', limit: 100, offset: 0 }),
};
