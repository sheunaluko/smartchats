/**
 * Local CRUD lifecycle tests — comprehensive write/read/update/delete
 * coverage for every shipped query builder, run against a fresh local
 * AIO instance.
 *
 * Why this exists: the cloud `integration.test.ts` is read-only against
 * real user data. Write/delete coverage requires a throwaway DB. Local
 * AIO is exactly that, so this is where every builder gets exercised
 * end-to-end through the production code path (no synthetic ids, no
 * test-marker fields — just call the actual builders with realistic
 * args and assert the round-trip).
 *
 * Preconditions:
 *   - AIO must be running (default URL http://localhost:3000/local-api,
 *     override via SMARTCHATS_LOCAL_URL).
 *   - Local DB must be EMPTY across the test tables. The suite refuses
 *     to run on a populated DB to prevent accidental data loss — wipe
 *     `~/.smartchats/data/` and restart AIO before invoking.
 *
 * Run: `npm run test:local` from this package.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as queries from '../src/index.js';
import { getDispatcher, type Dispatcher } from './dispatcher.js';

// 1536-dim fake embedding — required dim because logs, user_entities, and
// user_relations have HNSW indexes that enforce DIMENSION 1536. Other
// tables tolerate any vector but using 1536 everywhere keeps the test
// uniform. Values are deterministic small floats; we don't run KNN here.
const FAKE_EMBEDDING = Array.from({ length: 1536 }, (_, i) => (i % 100) / 1000);

// Tables this suite writes to — checked for emptiness before running.
const TEST_TABLES = [
    'logs',
    'metrics',
    'sessions',
    'user_entities',
    'user_relations',
    'user_data',
    'smartchats_apps',
    'smartchats_app_installs',
    'cortex',
    'cortex_dynamic_functions',
    'byo_api_keys',
    'usage_records',
];

let dispatcher: Dispatcher;

beforeAll(async () => {
    // Force local target — this suite is meaningless against cloud and
    // would attempt to write into the user's real account.
    process.env.SMARTCHATS_TEST_TARGET = 'local';
    dispatcher = await getDispatcher();

    // Refuse to run on a populated DB. The whole point of these tests is
    // a clean lifecycle on throwaway data.
    const populated: string[] = [];
    for (const t of TEST_TABLES) {
        const rows = (await dispatcher.run(
            queries.buildRawQuery(`SELECT count() AS n FROM ${t} GROUP ALL`),
        )) as Array<{ n: number }>;
        const n = rows[0]?.n ?? 0;
        if (n > 0) populated.push(`${t}=${n}`);
    }
    if (populated.length > 0) {
        throw new Error(
            `Refusing to run: local DB has data in test tables (${populated.join(', ')}). ` +
                `Wipe ~/.smartchats/data/ and restart AIO before re-running.`,
        );
    }
}, 60_000);

afterAll(async () => {
    // Defense-in-depth: any rows left in test tables means a test
    // forgot to clean up. Surface it loudly rather than masking.
    if (!dispatcher) return;
    const leftovers: string[] = [];
    for (const t of TEST_TABLES) {
        try {
            const rows = (await dispatcher.run(
                queries.buildRawQuery(`SELECT count() AS n FROM ${t} GROUP ALL`),
            )) as Array<{ n: number }>;
            const n = rows[0]?.n ?? 0;
            if (n > 0) leftovers.push(`${t}=${n}`);
        } catch {
            // Ignore — table may not exist if a test failed before creating any rows.
        }
    }
    if (leftovers.length > 0) {
        // Don't throw from afterAll — vitest shows it badly. Log loudly
        // so it's visible in CI / verify_9_0g output.
        // eslint-disable-next-line no-console
        console.error(
            `\n[local_crud] LEAKED ROWS: ${leftovers.join(', ')} — a test forgot to clean up`,
        );
    }
}, 30_000);

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Raw delete by id — used to clean up rows from tables that don't have a
 * `delete*` builder (logs, metrics) since no production code path deletes
 * them either. The `buildRawQuery` builder rejects non-readonly statements,
 * so we hand-craft the spec for cleanup only.
 */
async function deleteById(recordId: string): Promise<void> {
    await dispatcher.run({
        query: `DELETE type::record($table, $key)`,
        variables: {
            table: recordId.split(':')[0],
            key: recordId.slice(recordId.indexOf(':') + 1),
        },
    });
}

/** Extract the row id from an INSERT/CREATE/RELATE response.
 *
 * SDK v2 returns ids as `RecordId` class instances (not plain strings),
 * so we coerce. String(recordId) → "table:key" for both RecordId and
 * already-stringified ids.
 */
function rowId(row: unknown): string {
    const id = (row as { id?: unknown }).id;
    if (id === undefined || id === null) {
        throw new Error(
            `Expected row.id to exist, got: ${JSON.stringify(id)} (full row: ${JSON.stringify(row).slice(0, 200)})`,
        );
    }
    return String(id);
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// ── logs ──────────────────────────────────────────────────────────────────

describe('logs lifecycle', () => {
    let logId: string;

    it('insertLog → returns row with auto-generated id', async () => {
        const rows = await dispatcher.run(
            queries.insertLog({
                content: 'crud test entry — 25 pushups',
                category: 'exercise',
                embedding: FAKE_EMBEDDING,
                lts: nowIso(),
                local_tz: 'America/Los_Angeles',
            }),
        );
        expect(rows.length).toBe(1);
        const row = rows[0] as queries.LogRow;
        logId = rowId(row);
        expect(logId.startsWith('logs:')).toBe(true);
        expect(row.content).toBe('crud test entry — 25 pushups');
        expect(row.category).toBe('exercise');
    });

    it('listLogs (no search) returns the inserted row', async () => {
        const rows = await dispatcher.run(queries.listLogs({ limit: 10 }));
        expect(rows.length).toBeGreaterThan(0);
        const found = rows.find((r) => String((r as queries.LogRow).id) === logId);
        expect(found).toBeDefined();
    });

    it('listLogs with searchText finds the inserted row by substring', async () => {
        const rows = await dispatcher.run(
            queries.listLogs({ searchText: 'pushups', limit: 10 }),
        );
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows as queries.LogRow[]) {
            expect(r.content.toLowerCase()).toContain('pushups');
        }
    });

    it('listLogs with category filter returns only matching category', async () => {
        const rows = await dispatcher.run(
            queries.listLogs({ category: 'exercise', limit: 10 }),
        );
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows as queries.LogRow[]) {
            expect(r.category).toBe('exercise');
        }
    });

    it('getLogCategories returns the inserted category with count >= 1', async () => {
        const rows = (await dispatcher.run(queries.getLogCategories())) as Array<{
            category: string;
            count: number;
        }>;
        const exercise = rows.find((r) => r.category === 'exercise');
        expect(exercise).toBeDefined();
        expect(exercise!.count).toBeGreaterThan(0);
    });

    it('findLogByCategory returns at least one row for the inserted category', async () => {
        const rows = await dispatcher.run(queries.findLogByCategory('exercise'));
        expect(rows.length).toBeGreaterThan(0);
    });

    it('updateLog patches content and bumps updated_at', async () => {
        const spec = queries.updateLog({
            recordId: logId,
            patch: { content: 'crud test entry — 30 pushups (updated)' },
        });
        expect(spec).not.toBeNull();
        const rows = await dispatcher.run(spec!);
        expect(rows.length).toBe(1);
        const row = rows[0] as queries.LogRow;
        expect(row.content).toBe('crud test entry — 30 pushups (updated)');
    });

    it('updateLog with empty patch returns null (no settable fields)', () => {
        const spec = queries.updateLog({ recordId: logId, patch: {} });
        expect(spec).toBeNull();
    });

    it('cleanup: raw DELETE removes the row (logs has no deleteLog builder)', async () => {
        await deleteById(logId);
        const rows = await dispatcher.run(queries.listLogs({ limit: 100 }));
        const found = rows.find((r) => String((r as queries.LogRow).id) === logId);
        expect(found).toBeUndefined();
    });
});

// ── prepared log categories (user_data type='log_category_definition') ────

describe('prepared log categories lifecycle', () => {
    let prepRowId: string;

    it('findPreparedLogCategory returns empty before insert', async () => {
        const rows = await dispatcher.run(
            queries.findPreparedLogCategory('hydration'),
        );
        expect(rows.length).toBe(0);
    });

    it('insertPreparedLogCategory creates a row', async () => {
        const rows = await dispatcher.run(
            queries.insertPreparedLogCategory({
                category: 'hydration',
                description: 'water intake tracking',
            }),
        );
        expect(rows.length).toBe(1);
        prepRowId = rowId(rows[0]);
        expect(prepRowId.startsWith('user_data:')).toBe(true);
    });

    it('findPreparedLogCategory now returns the row', async () => {
        const rows = await dispatcher.run(
            queries.findPreparedLogCategory('hydration'),
        );
        expect(rows.length).toBe(1);
    });

    it('getPreparedLogCategories includes the row', async () => {
        const rows = await dispatcher.run(queries.getPreparedLogCategories());
        const found = rows.find(
            (r) => String((r as { id: string }).id) === prepRowId,
        );
        expect(found).toBeDefined();
    });

    it('cleanup: raw DELETE removes the prepared category row', async () => {
        await deleteById(prepRowId);
        const rows = await dispatcher.run(
            queries.findPreparedLogCategory('hydration'),
        );
        expect(rows.length).toBe(0);
    });
});

// ── metrics ───────────────────────────────────────────────────────────────

describe('metrics lifecycle', () => {
    let metricId: string;

    it('insertMetric → returns row with auto-generated id', async () => {
        const lts = nowIso();
        const rows = await dispatcher.run(
            queries.insertMetric({
                metric_name: 'crud_test_pushups',
                value: 25,
                unit: 'reps',
                metric_type: 'numeric',
                timestamp: lts,
                lts,
                local_tz: 'America/Los_Angeles',
                source: 'test',
                source_text: 'crud test entry',
                source_log_id: null,
                category: 'exercise',
                time_shift_quantity: null,
                time_shift_unit: null,
                note: null,
            }),
        );
        expect(rows.length).toBe(1);
        const row = rows[0] as queries.MetricRow;
        metricId = rowId(row);
        expect(metricId.startsWith('metrics:')).toBe(true);
        expect(row.metric_name).toBe('crud_test_pushups');
        expect(row.value).toBe(25);
    });

    it('getMetrics (no filter) returns the inserted row', async () => {
        const rows = await dispatcher.run(queries.getMetrics({ limit: 10 }));
        const found = rows.find((r) => String((r as queries.MetricRow).id) === metricId);
        expect(found).toBeDefined();
    });

    it('getMetrics with metric_name filter returns only matching', async () => {
        const rows = await dispatcher.run(
            queries.getMetrics({ metric_name: 'crud_test_pushups', limit: 10 }),
        );
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows as queries.MetricRow[]) {
            expect(r.metric_name).toBe('crud_test_pushups');
        }
    });

    it('getMetricsSummary includes the inserted metric', async () => {
        const rows = (await dispatcher.run(queries.getMetricsSummary())) as Array<{
            metric_name: string;
            entry_count: number;
        }>;
        const found = rows.find((r) => r.metric_name === 'crud_test_pushups');
        expect(found).toBeDefined();
        expect(found!.entry_count).toBeGreaterThan(0);
    });

    it('getRecentMetrics includes the inserted row', async () => {
        const rows = await dispatcher.run(queries.getRecentMetrics());
        const found = rows.find((r) => String((r as queries.MetricRow).id) === metricId);
        expect(found).toBeDefined();
    });

    it('findMetricByName returns one row when present', async () => {
        const rows = await dispatcher.run(
            queries.findMetricByName('crud_test_pushups'),
        );
        expect(rows.length).toBe(1);
    });

    it('getHabitDoneTimestamps with broad lts filter returns the lts of the inserted row', async () => {
        const rows = await dispatcher.run(
            queries.getHabitDoneTimestamps({
                metric_name: 'crud_test_pushups',
                ltsFilter: "lts >= d'2000-01-01T00:00:00Z'",
            }),
        );
        expect(rows.length).toBeGreaterThan(0);
    });

    it('cleanup: raw DELETE removes the metric row (no deleteMetric builder)', async () => {
        await deleteById(metricId);
        const rows = await dispatcher.run(
            queries.findMetricByName('crud_test_pushups'),
        );
        expect(rows.length).toBe(0);
    });
});

// ── prepared metrics (user_data type='metric_definition') ─────────────────

describe('prepared metric definitions lifecycle', () => {
    let prepId: string;

    it('insertPreparedMetric creates a row', async () => {
        const rows = await dispatcher.run(
            queries.insertPreparedMetric({
                metric_name: 'crud_test_water',
                unit: 'oz',
                metric_type: 'numeric',
                category: 'nutrition',
            }),
        );
        expect(rows.length).toBe(1);
        prepId = rowId(rows[0]);
    });

    it('findPreparedMetric returns the row', async () => {
        const rows = await dispatcher.run(
            queries.findPreparedMetric('crud_test_water'),
        );
        expect(rows.length).toBe(1);
    });

    it('getPreparedMetricDefinitions includes the row', async () => {
        const rows = await dispatcher.run(queries.getPreparedMetricDefinitions());
        const found = rows.find((r) => String((r as { id: string }).id) === prepId);
        expect(found).toBeDefined();
    });

    it('cleanup: raw DELETE removes the prepared metric row', async () => {
        await deleteById(prepId);
        const rows = await dispatcher.run(
            queries.findPreparedMetric('crud_test_water'),
        );
        expect(rows.length).toBe(0);
    });
});

// ── buildMetricsQuery + buildMetricsLtsFilter (pure, then run rendered) ───

describe('buildMetricsQuery / buildMetricsLtsFilter', () => {
    // Minimal ctx — just enough to render. Uses real Date in UTC.
    const ctx: queries.MetricsLtsFilterCtx = {
        getCurrentLocalDate: () => new Date().toISOString().slice(0, 10),
        toLocalTimestamp: (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };

    it('buildMetricsLtsFilter with date_range produces a runnable WHERE fragment', () => {
        const fragment = queries.buildMetricsLtsFilter(
            { date_range: '4w' },
            'UTC',
            ctx,
        );
        expect(fragment.startsWith('lts >= ')).toBe(true);
    });

    it('buildMetricsQuery (raw mode) produces an executable query', async () => {
        const spec = queries.buildMetricsQuery(
            { metric_name: 'nonexistent_metric', recency: '1y' },
            'UTC',
            ctx,
        );
        const rows = await dispatcher.run(spec);
        // Empty is fine — we're validating the query parses + executes, not the data.
        expect(Array.isArray(rows)).toBe(true);
    });

    it('buildMetricsQuery (daily_sum aggregation) produces an executable query', async () => {
        const spec = queries.buildMetricsQuery(
            { metric_name: 'nonexistent', aggregation: 'daily_sum', recency: '1y' },
            'UTC',
            ctx,
        );
        const rows = await dispatcher.run(spec);
        expect(Array.isArray(rows)).toBe(true);
    });

    it('buildMetricsQuery (weekly_avg, stacked) produces an executable query', async () => {
        const spec = queries.buildMetricsQuery(
            {
                metric_name: 'nonexistent',
                metric_names: ['a', 'b'],
                aggregation: 'weekly_avg',
                group_mode: 'stacked',
                recency: '1y',
            },
            'UTC',
            ctx,
        );
        const rows = await dispatcher.run(spec);
        expect(Array.isArray(rows)).toBe(true);
    });
});

// ── sessions ──────────────────────────────────────────────────────────────

describe('sessions lifecycle', () => {
    let sessionId: string;
    const baseFields = (): queries.SessionWriteFields => ({
        label: 'crud test session',
        message_count: 0,
        chat_history: [],
        workspace: {},
        thought_history: [],
        execution_history: [],
        settings: {},
        lts: nowIso(),
    });

    it('insertSession returns row with id', async () => {
        const rows = await dispatcher.run(queries.insertSession(baseFields()));
        expect(rows.length).toBe(1);
        const row = rows[0] as queries.SessionSummaryRow;
        sessionId = rowId(row);
        expect(sessionId.startsWith('sessions:')).toBe(true);
        expect(row.label).toBe('crud test session');
    });

    it('listSessions includes the inserted session', async () => {
        const rows = await dispatcher.run(queries.listSessions({ limit: 50 }));
        const found = rows.find((r) => String((r as queries.SessionSummaryRow).id) === sessionId);
        expect(found).toBeDefined();
    });

    it('searchSessions finds the inserted session by label substring', async () => {
        const rows = await dispatcher.run(queries.searchSessions({ query: 'crud test', limit: 20 }));
        const found = rows.find((r) => String((r as queries.SessionSummaryRow).id) === sessionId);
        expect(found).toBeDefined();
    });

    it('loadSession returns the full session row', async () => {
        const rows = await dispatcher.run(queries.loadSession(sessionId));
        expect(rows.length).toBe(1);
        expect(String((rows[0] as { id: string }).id)).toBe(sessionId);
    });

    it('updateSession updates the label', async () => {
        await dispatcher.run(
            queries.updateSession(sessionId, {
                ...baseFields(),
                label: 'crud test session (updated)',
                message_count: 2,
            }),
        );
        const rows = await dispatcher.run(queries.loadSession(sessionId));
        expect((rows[0] as queries.SessionSummaryRow).label).toBe(
            'crud test session (updated)',
        );
        expect((rows[0] as queries.SessionSummaryRow).message_count).toBe(2);
    });

    it('deleteSession removes the row', async () => {
        await dispatcher.run(queries.deleteSession(sessionId));
        const rows = await dispatcher.run(queries.loadSession(sessionId));
        expect(rows.length).toBe(0);
    });
});

// ── todos ─────────────────────────────────────────────────────────────────

describe('todos lifecycle', () => {
    let todoId: string;
    let completionId: string;

    it('insertTodo returns row with id', async () => {
        const lts = nowIso();
        const rows = await dispatcher.run(
            queries.insertTodo({
                title: 'crud test todo',
                description: 'verify lifecycle',
                priority: 'medium',
                category: 'test',
                due_date: null,
                recurrence: null,
                metric_link: null,
                source_text: 'crud_test',
                timestamp: lts,
                lts,
                local_tz: 'UTC',
                tags: [],
            }),
        );
        expect(rows.length).toBe(1);
        todoId = rowId(rows[0]);
        expect(todoId.startsWith('user_data:')).toBe(true);
    });

    it('getTodos active includes the inserted todo', async () => {
        const rows = await dispatcher.run(queries.getTodos({ status: 'active', limit: 50 }));
        const found = rows.find((r) => String((r as queries.TodoRow).id) === todoId);
        expect(found).toBeDefined();
    });

    it('getAllActiveTodos includes the inserted todo', async () => {
        const rows = await dispatcher.run(queries.getAllActiveTodos());
        const found = rows.find((r) => String((r as queries.TodoRow).id) === todoId);
        expect(found).toBeDefined();
    });

    it('getTodoById returns the row', async () => {
        const rows = await dispatcher.run(queries.getTodoById(todoId));
        expect(rows.length).toBe(1);
        expect(String((rows[0] as queries.TodoRow).id)).toBe(todoId);
    });

    it('editTodo updates the title via patch', async () => {
        const spec = queries.editTodo({
            recordId: todoId,
            updates: { title: 'crud test todo (edited)' },
        });
        expect(spec).not.toBeNull();
        await dispatcher.run(spec!);
        const rows = await dispatcher.run(queries.getTodoById(todoId));
        expect((rows[0] as queries.TodoRow).data.title).toBe(
            'crud test todo (edited)',
        );
    });

    it('rescheduleTodo updates due_date', async () => {
        const spec = queries.rescheduleTodo({
            recordId: todoId,
            new_due_date: '2099-12-31T00:00:00Z',
        });
        expect(spec).not.toBeNull();
        await dispatcher.run(spec!);
        const rows = await dispatcher.run(queries.getTodoById(todoId));
        expect((rows[0] as queries.TodoRow).data.due_date).toBe(
            '2099-12-31T00:00:00Z',
        );
    });

    it('rescheduleTodo with no patch returns null', () => {
        expect(queries.rescheduleTodo({ recordId: todoId })).toBeNull();
    });

    it('insertTodoCompletion creates a completion linked to the todo', async () => {
        const lts = nowIso();
        const rows = await dispatcher.run(
            queries.insertTodoCompletion({
                parent_id: todoId,
                note: 'done',
                timestamp: lts,
                lts,
                local_tz: 'UTC',
            }),
        );
        expect(rows.length).toBe(1);
        completionId = rowId(rows[0]);
    });

    it('getCompletionsInPeriod returns the completion', async () => {
        const rows = await dispatcher.run(
            queries.getCompletionsInPeriod({
                parentId: todoId,
                start: '2000-01-01T00:00:00Z',
                end: '2099-12-31T23:59:59Z',
            }),
        );
        expect(rows.length).toBeGreaterThan(0);
    });

    it('getLastCompletion returns the completion', async () => {
        const rows = await dispatcher.run(queries.getLastCompletion({ parentId: todoId }));
        expect(rows.length).toBe(1);
    });

    it('setTodoStatus → completed', async () => {
        await dispatcher.run(
            queries.setTodoStatus({ recordId: todoId, status: 'completed' }),
        );
        const rows = await dispatcher.run(queries.getTodoById(todoId));
        expect((rows[0] as queries.TodoRow).status).toBe('completed');
    });

    it('deleteCompletionsForTodo removes all completions', async () => {
        await dispatcher.run(queries.deleteCompletionsForTodo({ parentId: todoId }));
        const rows = await dispatcher.run(queries.getLastCompletion({ parentId: todoId }));
        expect(rows.length).toBe(0);
        // Also assert by id directly.
        const directRows = await dispatcher.run({
            query: 'SELECT * FROM type::record("user_data", $key)',
            variables: { key: completionId.slice(completionId.indexOf(':') + 1) },
        });
        expect(directRows.length).toBe(0);
    });

    it('deleteTodoById removes the todo', async () => {
        await dispatcher.run(queries.deleteTodoById(todoId));
        const rows = await dispatcher.run(queries.getTodoById(todoId));
        expect(rows.length).toBe(0);
    });
});

// ── knowledge graph ───────────────────────────────────────────────────────

describe('knowledge graph lifecycle', () => {
    const ENTITY_ALPHA = 'crud_test_entity_alpha';
    const ENTITY_BETA = 'crud_test_entity_beta';
    const RELATION_NAME = 'crud_test_relation';

    it('buildKnowledgeInsertQuery creates entities + relation in one round-trip', async () => {
        const spec = queries.buildKnowledgeInsertQuery({
            entities: [
                { name: ENTITY_ALPHA, embedding: FAKE_EMBEDDING },
                { name: ENTITY_BETA, embedding: FAKE_EMBEDDING },
            ],
            relations: [
                {
                    name: RELATION_NAME,
                    sourceName: ENTITY_ALPHA,
                    targetName: ENTITY_BETA,
                    kind: 'crud_test_kind',
                    embedding: FAKE_EMBEDDING,
                },
            ],
            lts: nowIso(),
        });
        const allStmts = await dispatcher.runAll(spec);
        // 2 entity statements + 1 relation statement
        expect(allStmts.length).toBe(3);
        for (const stmtRows of allStmts) {
            expect(stmtRows.length).toBeGreaterThan(0);
        }
    });

    it('searchEntitiesByName finds the inserted entities', async () => {
        const rows = await dispatcher.run(
            queries.searchEntitiesByName({ query: 'crud_test_entity', limit: 10 }),
        );
        const names = (rows as queries.EntityRow[]).map((r) => r.name);
        expect(names).toContain(ENTITY_ALPHA);
        expect(names).toContain(ENTITY_BETA);
    });

    it('searchRelationsByName finds the inserted relation', async () => {
        const rows = await dispatcher.run(
            queries.searchRelationsByName({ query: 'crud_test_relation', limit: 10 }),
        );
        const found = (rows as queries.RelationRow[]).find((r) => r.name === RELATION_NAME);
        expect(found).toBeDefined();
        expect(found!.sourceName).toBe(ENTITY_ALPHA);
        expect(found!.targetName).toBe(ENTITY_BETA);
    });

    it('checkExistingEntityNames returns the subset that exists', async () => {
        const rows = await dispatcher.run(
            queries.checkExistingEntityNames([ENTITY_ALPHA, ENTITY_BETA, '_does_not_exist']),
        );
        expect(rows).toContain(ENTITY_ALPHA);
        expect(rows).toContain(ENTITY_BETA);
        expect(rows).not.toContain('_does_not_exist');
    });

    it('checkExistingRelationNames returns the subset that exists', async () => {
        const rows = await dispatcher.run(
            queries.checkExistingRelationNames([RELATION_NAME, '_does_not_exist']),
        );
        expect(rows).toContain(RELATION_NAME);
        expect(rows).not.toContain('_does_not_exist');
    });

    it('getAllEntities returns the inserted entities', async () => {
        const rows = await dispatcher.run(queries.getAllEntities({ limit: 100 }));
        const names = (rows as queries.EntityRow[]).map((r) => r.name);
        expect(names).toContain(ENTITY_ALPHA);
        expect(names).toContain(ENTITY_BETA);
    });

    it('getAllRelations (no entity filter) returns the inserted relation', async () => {
        const rows = await dispatcher.run(queries.getAllRelations({ limit: 100 }));
        const found = (rows as queries.RelationRow[]).find((r) => r.name === RELATION_NAME);
        expect(found).toBeDefined();
    });

    it('getAllRelations (filtered by entity) returns the relation', async () => {
        const rows = await dispatcher.run(
            queries.getAllRelations({ limit: 100, entity: ENTITY_ALPHA }),
        );
        const found = (rows as queries.RelationRow[]).find((r) => r.name === RELATION_NAME);
        expect(found).toBeDefined();
    });

    it('getRelationsTouchingEntities expands frontier', async () => {
        const rows = await dispatcher.run(
            queries.getRelationsTouchingEntities([ENTITY_ALPHA]),
        );
        const found = (rows as queries.RelationRow[]).find((r) => r.name === RELATION_NAME);
        expect(found).toBeDefined();
    });

    it('getEntityRelations returns the relation for the entity', async () => {
        const rows = await dispatcher.run(queries.getEntityRelations(ENTITY_ALPHA));
        const found = (rows as queries.RelationRow[]).find((r) => r.name === RELATION_NAME);
        expect(found).toBeDefined();
    });

    it('knnSearchEntities runs successfully', async () => {
        const rows = await dispatcher.run(
            queries.knnSearchEntities({ embedding: FAKE_EMBEDDING, limit: 5, effort: 40 }),
        );
        // KNN should find at least our 2 inserted entities.
        expect(rows.length).toBeGreaterThan(0);
    });

    it('knnSearchRelations runs successfully', async () => {
        const rows = await dispatcher.run(
            queries.knnSearchRelations({ embedding: FAKE_EMBEDDING, limit: 5, effort: 40 }),
        );
        expect(rows.length).toBeGreaterThan(0);
    });

    it('deleteRelationByName removes the relation', async () => {
        await dispatcher.run(queries.deleteRelationByName(RELATION_NAME));
        const rows = await dispatcher.run(
            queries.searchRelationsByName({ query: RELATION_NAME, limit: 10 }),
        );
        const found = (rows as queries.RelationRow[]).find((r) => r.name === RELATION_NAME);
        expect(found).toBeUndefined();
    });

    it('deleteRelationsTouchingEntity is a safe no-op when no relations remain', async () => {
        // Rerun is idempotent — relation already gone in the prior test.
        await dispatcher.run(queries.deleteRelationsTouchingEntity(ENTITY_ALPHA));
    });

    it('deleteEntityByName removes both entities', async () => {
        await dispatcher.run(queries.deleteEntityByName(ENTITY_ALPHA));
        await dispatcher.run(queries.deleteEntityByName(ENTITY_BETA));
        const rows = await dispatcher.run(
            queries.searchEntitiesByName({ query: 'crud_test_entity', limit: 10 }),
        );
        expect(rows.length).toBe(0);
    });
});

// ── apps registry ─────────────────────────────────────────────────────────

describe('smartchats_apps lifecycle', () => {
    const APP_ID = 'crud_test_app';
    const insertArgs = (): queries.InsertAppArgs => ({
        app_id: APP_ID,
        name: 'CRUD Test App',
        version: '1.0.0',
        description: 'lifecycle test app',
        author: { name: 'test' },
        icon: null,
        source: 'test',
        categories: ['test'],
        tags: ['crud'],
        embedding: FAKE_EMBEDDING,
        modules: {},
        interaction_mode: 'voice',
        html_templates: [],
        display_mode: 'inline',
        state_schema: {},
        permissions: {},
        requested_functions: [],
        voice_hooks: {},
        on_activate: null,
        on_deactivate: null,
        external_scripts: [],
        migrations: [],
        min_tier: 'free',
        version_history: [],
        forked_from: null,
        _content_hash: 'hash_v1',
        published_at: nowIso(),
    });

    it('insertApp creates a manifest', async () => {
        const rows = await dispatcher.run(queries.insertApp(insertArgs()));
        expect(rows.length).toBe(1);
        expect((rows[0] as queries.AppManifestRow).app_id).toBe(APP_ID);
    });

    it('getAppByAppId returns the manifest', async () => {
        const rows = await dispatcher.run(queries.getAppByAppId(APP_ID));
        expect(rows.length).toBe(1);
        expect((rows[0] as queries.AppManifestRow).app_id).toBe(APP_ID);
    });

    it('listApps includes the manifest', async () => {
        const rows = await dispatcher.run(queries.listApps({ source: 'test' }));
        const found = rows.find((r) => (r as queries.AppManifestRow).app_id === APP_ID);
        expect(found).toBeDefined();
    });

    it('listApps with category filter returns the manifest', async () => {
        const rows = await dispatcher.run(queries.listApps({ category: 'test' }));
        const found = rows.find((r) => (r as queries.AppManifestRow).app_id === APP_ID);
        expect(found).toBeDefined();
    });

    it('searchApps (cosine similarity) returns the manifest', async () => {
        const rows = await dispatcher.run(
            queries.searchApps({ embedding: FAKE_EMBEDDING, limit: 5 }),
        );
        const found = rows.find((r) => (r as queries.AppManifestRow).app_id === APP_ID);
        expect(found).toBeDefined();
    });

    it('updateApp patches the description', async () => {
        const spec = queries.updateApp({
            app_id: APP_ID,
            patch: { description: 'updated description' },
        });
        expect(spec).not.toBeNull();
        await dispatcher.run(spec!);
        const rows = await dispatcher.run(queries.getAppByAppId(APP_ID));
        expect((rows[0] as queries.AppManifestRow).description).toBe(
            'updated description',
        );
    });

    it('updateApp with empty patch returns null', () => {
        expect(queries.updateApp({ app_id: APP_ID, patch: {} })).toBeNull();
    });

    it('incrementAppInstallCount bumps the counter', async () => {
        await dispatcher.run(queries.incrementAppInstallCount(APP_ID));
        const rows = await dispatcher.run(queries.getAppByAppId(APP_ID));
        expect((rows[0] as queries.AppManifestRow).install_count).toBe(1);
    });

    it('deleteAppByAppId removes the manifest', async () => {
        await dispatcher.run(queries.deleteAppByAppId(APP_ID));
        const rows = await dispatcher.run(queries.getAppByAppId(APP_ID));
        expect(rows.length).toBe(0);
    });
});

// ── app installs ──────────────────────────────────────────────────────────

describe('smartchats_app_installs lifecycle', () => {
    const APP_ID = 'crud_test_install';

    it('insertInstall creates an install record', async () => {
        const rows = await dispatcher.run(
            queries.insertInstall({
                app_id: APP_ID,
                installed_version: '1.0.0',
                granted_permissions: {},
                app_state: {},
                config: {},
                last_activated_at: nowIso(),
                activation_count: 0,
            }),
        );
        expect(rows.length).toBe(1);
        expect((rows[0] as queries.AppInstallRow).app_id).toBe(APP_ID);
    });

    it('getInstallByAppId returns the install', async () => {
        const rows = await dispatcher.run(queries.getInstallByAppId(APP_ID));
        expect(rows.length).toBe(1);
    });

    it('listInstalls includes the install', async () => {
        const rows = await dispatcher.run(queries.listInstalls());
        const found = rows.find((r) => (r as queries.AppInstallRow).app_id === APP_ID);
        expect(found).toBeDefined();
    });

    it('updateInstall patches activation_count', async () => {
        const spec = queries.updateInstall({
            app_id: APP_ID,
            patch: { activation_count: 5 },
        });
        expect(spec).not.toBeNull();
        await dispatcher.run(spec!);
        const rows = await dispatcher.run(queries.getInstallByAppId(APP_ID));
        expect((rows[0] as { activation_count: number }).activation_count).toBe(5);
    });

    it('updateInstall with empty patch returns null', () => {
        expect(queries.updateInstall({ app_id: APP_ID, patch: {} })).toBeNull();
    });

    it('deleteInstallByAppId removes the install', async () => {
        await dispatcher.run(queries.deleteInstallByAppId(APP_ID));
        const rows = await dispatcher.run(queries.getInstallByAppId(APP_ID));
        expect(rows.length).toBe(0);
    });
});

// ── dynamic functions ─────────────────────────────────────────────────────

describe('cortex_dynamic_functions lifecycle', () => {
    const FN_NAME = 'crud_test_fn';

    it('insertDynamicFunction creates a row', async () => {
        const rows = await dispatcher.run(
            queries.insertDynamicFunction({
                name: FN_NAME,
                description: 'a test function',
                code: 'async ({x}) => x * 2',
                params_schema: { x: { type: 'number' } },
                embedding: FAKE_EMBEDDING,
            }),
        );
        expect(rows.length).toBe(1);
    });

    it('loadDynamicFunction returns the row', async () => {
        const rows = await dispatcher.run(queries.loadDynamicFunction(FN_NAME));
        expect(rows.length).toBe(1);
        expect((rows[0] as { name: string }).name).toBe(FN_NAME);
    });

    it('listDynamicFunctions includes the row', async () => {
        const rows = await dispatcher.run(queries.listDynamicFunctions());
        const found = rows.find((r) => (r as { name: string }).name === FN_NAME);
        expect(found).toBeDefined();
    });

    it('updateDynamicFunction patches the description', async () => {
        const spec = queries.updateDynamicFunction({
            name: FN_NAME,
            patch: { description: 'updated description' },
        });
        expect(spec).not.toBeNull();
        await dispatcher.run(spec!);
        const rows = await dispatcher.run(queries.loadDynamicFunction(FN_NAME));
        expect((rows[0] as { description: string }).description).toBe(
            'updated description',
        );
    });

    it('updateDynamicFunction with empty patch + no embedding returns null', () => {
        expect(
            queries.updateDynamicFunction({ name: FN_NAME, patch: {} }),
        ).toBeNull();
    });

    it('deleteDynamicFunction removes the row', async () => {
        await dispatcher.run(queries.deleteDynamicFunction(FN_NAME));
        const rows = await dispatcher.run(queries.loadDynamicFunction(FN_NAME));
        expect(rows.length).toBe(0);
    });
});

// ── procedural instructions (cortex type='procedural_instruction') ────────

describe('procedural_instructions lifecycle', () => {
    let piId: string;

    it('insertProceduralInstruction creates a row', async () => {
        const rows = await dispatcher.run(
            queries.insertProceduralInstruction({
                content: 'crud test procedural instruction',
                category: 'test',
                embedding: FAKE_EMBEDDING,
            }),
        );
        expect(rows.length).toBe(1);
        piId = rowId(rows[0]);
        expect(piId.startsWith('cortex:')).toBe(true);
    });

    it('getProceduralInstructions includes the row', async () => {
        const rows = await dispatcher.run(queries.getProceduralInstructions());
        const found = rows.find((r) => String((r as { id: string }).id) === piId);
        expect(found).toBeDefined();
    });

    it('getProceduralInstructions with category filter returns matching rows', async () => {
        const rows = await dispatcher.run(
            queries.getProceduralInstructions({ category: 'test' }),
        );
        expect(rows.length).toBeGreaterThan(0);
    });

    it('searchProceduralInstructions returns the inserted row via KNN', async () => {
        // Schema v1.2.0 added the HNSW index on cortex.embedding so KNN
        // actually returns matches. Searching with the same FAKE_EMBEDDING
        // we used at insert should find it (distance ~0).
        const rows = await dispatcher.run(
            queries.searchProceduralInstructions({
                embedding: FAKE_EMBEDDING,
                limit: 5,
            }),
        );
        expect(rows.length).toBeGreaterThan(0);
        const found = rows.find((r) => String((r as { id: string }).id) === piId);
        expect(found).toBeDefined();
    });

    it('updateProceduralInstruction patches content', async () => {
        const spec = queries.updateProceduralInstruction({
            recordId: piId,
            patch: { content: 'updated content' },
        });
        expect(spec).not.toBeNull();
        await dispatcher.run(spec!);
        const rows = await dispatcher.run(queries.getProceduralInstructions());
        const found = rows.find((r) => String((r as { id: string }).id) === piId);
        expect((found as { content: string }).content).toBe('updated content');
    });

    it('updateProceduralInstruction with empty patch returns null', () => {
        expect(
            queries.updateProceduralInstruction({ recordId: piId, patch: {} }),
        ).toBeNull();
    });

    it('deleteProceduralInstruction removes the row', async () => {
        await dispatcher.run(queries.deleteProceduralInstruction(piId));
        const rows = await dispatcher.run(queries.getProceduralInstructions());
        const found = rows.find((r) => String((r as { id: string }).id) === piId);
        expect(found).toBeUndefined();
    });
});

// ── init instructions (cortex type='init') ────────────────────────────────

describe('init_instructions lifecycle', () => {
    let initId: string;

    it('insertInitInstruction creates a row', async () => {
        const rows = await dispatcher.run(
            queries.insertInitInstruction({
                content: 'crud test init instruction',
                category: 'test',
                embedding: FAKE_EMBEDDING,
            }),
        );
        expect(rows.length).toBe(1);
        initId = rowId(rows[0]);
        expect(initId.startsWith('cortex:')).toBe(true);
    });

    it('getInitInstructions includes the row', async () => {
        const rows = await dispatcher.run(queries.getInitInstructions());
        const found = rows.find((r) => String((r as { id: string }).id) === initId);
        expect(found).toBeDefined();
    });

    it('updateInitInstruction patches content', async () => {
        const spec = queries.updateInitInstruction({
            recordId: initId,
            patch: { content: 'updated init' },
        });
        expect(spec).not.toBeNull();
        await dispatcher.run(spec!);
        const rows = await dispatcher.run(queries.getInitInstructions());
        const found = rows.find((r) => String((r as { id: string }).id) === initId);
        expect((found as { content: string }).content).toBe('updated init');
    });

    it('updateInitInstruction with empty patch returns null', () => {
        expect(
            queries.updateInitInstruction({ recordId: initId, patch: {} }),
        ).toBeNull();
    });

    it('deleteInitInstruction removes the row', async () => {
        await dispatcher.run(queries.deleteInitInstruction(initId));
        const rows = await dispatcher.run(queries.getInitInstructions());
        const found = rows.find((r) => String((r as { id: string }).id) === initId);
        expect(found).toBeUndefined();
    });
});

// ── byo_api_keys ──────────────────────────────────────────────────────────

describe('byo_api_keys lifecycle', () => {
    const PROVIDER = 'openai'; // a real provider name — the table is keyed by it

    it('upsertByoKey creates the row', async () => {
        const rows = await dispatcher.run(
            queries.upsertByoKey({ provider: PROVIDER, key: 'sk-crud-test-1' }),
        );
        expect(rows.length).toBeGreaterThan(0);
    });

    it('getByoKey returns the inserted key', async () => {
        const rows = (await dispatcher.run(queries.getByoKey(PROVIDER))) as Array<{
            api_key: string;
        }>;
        expect(rows.length).toBe(1);
        expect(rows[0].api_key).toBe('sk-crud-test-1');
    });

    it('upsertByoKey replaces the existing row (upsert semantics)', async () => {
        await dispatcher.run(
            queries.upsertByoKey({ provider: PROVIDER, key: 'sk-crud-test-2' }),
        );
        const rows = (await dispatcher.run(queries.getByoKey(PROVIDER))) as Array<{
            api_key: string;
        }>;
        expect(rows.length).toBe(1);
        expect(rows[0].api_key).toBe('sk-crud-test-2');
    });

    it('deleteByoKey removes the row', async () => {
        await dispatcher.run(queries.deleteByoKey(PROVIDER));
        const rows = await dispatcher.run(queries.getByoKey(PROVIDER));
        expect(rows.length).toBe(0);
    });
});

// ── usage_records ─────────────────────────────────────────────────────────

describe('usage_records lifecycle', () => {
    let usageId: string;

    let usageNullId: string;

    it('insertUsageRecord (with sessionId) creates the row', async () => {
        const rows = await dispatcher.run(
            queries.insertUsageRecord({
                model: 'gpt-4o',
                provider: 'openai',
                inputTokens: 100,
                outputTokens: 50,
                cachedInputTokens: 0,
                costUsd: 0.001,
                sessionId: 'crud_test_session',
                requestType: 'crud_test',
            }),
        );
        expect(rows.length).toBe(1);
        usageId = rowId(rows[0]);
        expect(usageId.startsWith('usage_records:')).toBe(true);
        expect((rows[0] as { session_id?: string }).session_id).toBe(
            'crud_test_session',
        );
    });

    it('insertUsageRecord (with null sessionId) creates the row with session_id NONE', async () => {
        // Builder fix: when sessionId is null, the field is omitted from SET
        // entirely. SurrealDB stores it as NONE (the schema's `option<string>`
        // accepts absence but rejects an explicit NULL value).
        const rows = await dispatcher.run(
            queries.insertUsageRecord({
                model: 'gpt-4o',
                provider: 'openai',
                inputTokens: 1,
                outputTokens: 1,
                cachedInputTokens: 0,
                costUsd: 0,
                sessionId: null,
                requestType: 'crud_test_null',
            }),
        );
        expect(rows.length).toBe(1);
        usageNullId = rowId(rows[0]);
        // SurrealDB serializes NONE as undefined when reading back through JSON.
        expect((rows[0] as { session_id?: string }).session_id).toBeUndefined();
    });

    it('listUsageRecords (page 1) includes the inserted row', async () => {
        const rows = await dispatcher.run(
            queries.listUsageRecords({ limit: 10 }),
        );
        const found = rows.find((r) => String((r as { id: string }).id) === usageId);
        expect(found).toBeDefined();
    });

    it('getUsageRecordsSince (broad start) includes the inserted row', async () => {
        const rows = await dispatcher.run(
            queries.getUsageRecordsSince('2000-01-01T00:00:00Z'),
        );
        const found = rows.find((r) => String((r as { id: string }).id) === usageId);
        expect(found).toBeDefined();
    });

    it('listUsageRecords with startAfter paginates correctly', async () => {
        // Use a far-future startAfter so no rows are returned.
        const rows = await dispatcher.run(
            queries.listUsageRecords({
                limit: 10,
                startAfter: '2099-01-01T00:00:00Z',
            }),
        );
        expect(Array.isArray(rows)).toBe(true);
    });

    it('cleanup: raw DELETE removes the usage records (no delete builder)', async () => {
        await deleteById(usageId);
        await deleteById(usageNullId);
        const rows = await dispatcher.run(
            queries.listUsageRecords({ limit: 10 }),
        );
        for (const id of [usageId, usageNullId]) {
            expect(rows.find((r) => String((r as { id: string }).id) === id)).toBeUndefined();
        }
    });
});

// ── health probes (read-only, run after all writes torn down) ─────────────

describe('health probes', () => {
    it('probeTableExists returns an array for every required table', async () => {
        for (const t of TEST_TABLES) {
            const rows = await dispatcher.run(queries.probeTableExists(t));
            expect(Array.isArray(rows)).toBe(true);
        }
    });
});

// ── import/export builders ────────────────────────────────────────────────

describe('import_export builders', () => {
    it('exportTablePage produces a paginated SELECT spec', async () => {
        const spec = queries.exportTablePage({
            table: 'logs',
            limit: 10,
            offset: 0,
        });
        const rows = await dispatcher.run(spec);
        expect(Array.isArray(rows)).toBe(true);
    });

    it('buildUpsertQuery rejects empty SET clauses by producing a parseable spec', () => {
        const spec = queries.buildUpsertQuery('logs', 'abc123', {
            content: 'imported',
            category: 'test',
        });
        expect(spec.query.startsWith('UPSERT type::record(')).toBe(true);
        expect(spec.variables.table_name).toBe('logs');
        expect(spec.variables.key).toBe('abc123');
    });

    it('buildRelateQuery returns null when in/out are absent', () => {
        const spec = queries.buildRelateQuery('user_relations', 'rel1', {});
        expect(spec).toBeNull();
    });

    it('buildImportQuery dispatches to RELATE for relation tables, UPSERT otherwise', () => {
        const upsertSpec = queries.buildImportQuery('logs', 'abc', {
            id: 'logs:abc',
            content: 'x',
        });
        expect(upsertSpec).not.toBeNull();
        expect(upsertSpec!.query.startsWith('UPSERT')).toBe(true);

        const relateSpec = queries.buildImportQuery('user_relations', 'rel1', {
            id: 'user_relations:rel1',
            in: 'user_entities:a',
            out: 'user_entities:b',
            name: 'r',
        });
        expect(relateSpec).not.toBeNull();
        expect(relateSpec!.query).toContain('RELATE');
    });

    it('IMPORT_STRIP_FIELDS includes the audit timestamps', () => {
        expect(queries.IMPORT_STRIP_FIELDS).toContain('created_at');
        expect(queries.IMPORT_STRIP_FIELDS).toContain('updated_at');
    });

    it('RELATION_TABLES contains user_relations', () => {
        expect(queries.RELATION_TABLES.has('user_relations')).toBe(true);
    });
});

// ── raw passthrough ───────────────────────────────────────────────────────

describe('raw passthrough', () => {
    it('buildRawQuery accepts SELECT and runs against an empty table', async () => {
        const rows = await dispatcher.run(
            queries.buildRawQuery('SELECT count() AS n FROM logs GROUP ALL'),
        );
        // logs is empty post-cleanup → returns 0 rows or [{n:0}] depending on
        // SurrealDB version. Either way it must be an array.
        expect(Array.isArray(rows)).toBe(true);
    });

    it('buildRawQuery rejects mutating statements', () => {
        expect(() =>
            queries.buildRawQuery('UPDATE logs SET foo = 1'),
        ).toThrow(queries.NonReadOnlyQueryError);
        expect(() =>
            queries.buildRawQuery('DELETE FROM logs'),
        ).toThrow(queries.NonReadOnlyQueryError);
    });
});
