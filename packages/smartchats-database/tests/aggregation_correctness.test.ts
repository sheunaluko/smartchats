/**
 * Aggregation correctness — end-to-end SurrealQL verification of the
 * 1.5.0 event-time convention.
 *
 * Why this file exists: the unit-level tests in tests/unit/ verify that
 * query builders emit the correct SurrealQL strings, but never actually
 * execute them. This suite runs the queries against a real SurrealDB and
 * asserts on results. It demonstrates concretely that:
 *
 *   - GROUP BY local_date produces correct daily buckets per user-local
 *     calendar day (no UTC drift)
 *   - ORDER BY ts is monotonic across DST fall-back — the canonical bug
 *     the refactor fixes: two events at "1:30 AM" on the fall-back day
 *     have identical lts but distinct ts
 *   - Date-range filters via local_date select the right rows without
 *     tz arithmetic
 *   - Duration filters via ts >= cutoff use real-time math correctly
 *   - Cross-tz rows (Tokyo + Chicago, same local_date) co-bucket under
 *     local_date
 *   - buildMetricsQuery end-to-end returns correct daily/weekly aggregates
 *
 * Infrastructure:
 *   - Connects to AIO's exposed SurrealDB (default ws://localhost:8000/rpc)
 *   - Uses a dedicated database `smartchats/test_aggregation` so the
 *     user's real data is untouched
 *   - Applies the full schema on first run (idempotent — skips if version
 *     marker is current)
 *   - Cleans up rows in beforeAll / afterAll
 *
 * Run:
 *   - `npm run test:aggregation` (from packages/smartchats-database)
 *   - or `npx smartchats-test integration` (probes AIO, runs this suite)
 *
 * Prereqs:
 *   - SurrealDB must be reachable on `ws://localhost:8000/rpc`. Two
 *     supported paths:
 *       - `bin/aio` — runs the AIO Docker container and forwards both
 *         the app port (3000) and the SurrealDB port (8000) to the host.
 *       - `smartchats start` — runs surreal + server as native processes
 *         on the host (no Docker), with SurrealDB directly on :8000.
 *     Note: `smartchats launch` is the canonical end-user entry point
 *     (browser → app on :3000 → internal SurrealDB), but does NOT
 *     forward :8000 to the host. Use one of the two paths above for
 *     direct-DB integration testing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type Client, queries, type QuerySpec } from '../src/index.js';
import { applyLocalSchema, type LocalSchemaDb } from '../src/schema/local.js';

let client: Client;

beforeAll(async () => {
    const url = process.env.SMARTCHATS_LOCAL_URL ?? 'ws://localhost:8000/rpc';
    client = createClient({
        url,
        namespace: process.env.SMARTCHATS_LOCAL_NS ?? 'smartchats',
        database: process.env.SMARTCHATS_LOCAL_DB ?? 'test_aggregation',
        auth: { username: 'root', password: 'root' },
    });

    // 5s upper bound on connect so direct `npm run test:aggregation` without
    // AIO running bails fast with a clear error instead of waiting on the
    // SDK's silent retry. L3 in smartchats-test already TCP-probes the port
    // before invoking this suite, so the AIO-up path doesn't pay this cost.
    try {
        await Promise.race([
            client.connect(),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('connect timed out after 5s')), 5000),
            ),
        ]);
    } catch (err) {
        throw new Error(
            `SurrealDB unreachable at ${url} — is AIO running with --surreal-port 8000? (${(err as Error).message})`,
        );
    }

    // Apply schema. Idempotent: first run creates tables + runs migrations
    // and stamps version 1.5.0; subsequent runs see the version marker
    // and skip.
    const schemaDb: LocalSchemaDb = {
        query: (q: string, vars?: Record<string, unknown>) => client.runRaw(q, vars),
    };
    await applyLocalSchema(schemaDb, {});

    // Start every test run from a clean slate on this dedicated DB.
    await client.runRaw('DELETE FROM metrics; DELETE FROM logs;');
}, 30_000);

afterAll(async () => {
    if (!client) return;
    await client.runRaw('DELETE FROM metrics; DELETE FROM logs;');
    await client.close();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Insert a metric row with sensible test defaults for all the fields the
 * builder requires. Caller specifies the time-bundle fields and the
 * relevant value/name; everything else has a working default.
 */
async function insertMetric(args: {
    metric_name: string;
    value: number;
    lts: string;
    ts: string;
    local_date: string;
    local_tz: string;
    unit?: string;
    metric_type?: string;
    category?: string;
}): Promise<string> {
    const spec = queries.insertMetric({
        metric_name: args.metric_name,
        value: args.value,
        unit: args.unit ?? 'count',
        metric_type: args.metric_type ?? 'numeric',
        lts: args.lts,
        ts: args.ts,
        local_date: args.local_date,
        local_tz: args.local_tz,
        source: 'test',
        source_text: '',
        source_log_id: null,
        category: args.category ?? 'test',
        time_shift_quantity: null,
        time_shift_unit: null,
        note: null,
    });
    return runInsert(spec);
}

async function insertLog(args: {
    content: string;
    category?: string;
    lts: string;
    ts: string;
    local_date: string;
    local_tz?: string;
}): Promise<string> {
    return runInsert(queries.insertLog({
        content: args.content,
        category: args.category ?? 'test',
        embedding: null,
        lts: args.lts,
        ts: args.ts,
        local_date: args.local_date,
        local_tz: args.local_tz ?? 'America/Chicago',
    }));
}

async function insertSession(args: {
    label: string;
    lts: string;
    ts: string;
    local_date: string;
    local_tz?: string;
}): Promise<string> {
    return runInsert(queries.insertSession({
        label: args.label,
        message_count: 0,
        chat_history: [],
        workspace: {},
        thought_history: [],
        execution_history: [],
        settings: {},
        lts: args.lts,
        ts: args.ts,
        local_date: args.local_date,
        local_tz: args.local_tz ?? 'America/Chicago',
    }));
}

async function insertTodo(args: {
    title: string;
    lts: string;
    ts: string;
    local_date: string;
    local_tz?: string;
    due_date?: string | null;
}): Promise<string> {
    return runInsert(queries.insertTodo({
        title: args.title,
        description: null,
        priority: 'medium',
        category: 'test',
        due_date: args.due_date ?? null,
        recurrence: null,
        metric_link: null,
        source_text: '',
        timestamp: args.ts,
        lts: args.lts,
        ts: args.ts,
        local_date: args.local_date,
        local_tz: args.local_tz ?? 'America/Chicago',
        tags: [],
    }));
}

async function insertTodoCompletion(args: {
    parentId: string;
    lts: string;
    ts: string;
    local_date: string;
    local_tz?: string;
}): Promise<string> {
    return runInsert(queries.insertTodoCompletion({
        parent_id: args.parentId,
        note: null,
        lts: args.lts,
        ts: args.ts,
        local_date: args.local_date,
        local_tz: args.local_tz ?? 'America/Chicago',
    }));
}

async function insertUsageRecord(args: {
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
}): Promise<string> {
    // usage_records is server-stamped: ts = time::now() at INSERT time.
    return runInsert(queries.insertUsageRecord({
        model: args.model ?? 'gpt-5.5',
        provider: args.provider ?? 'openai',
        inputTokens: args.inputTokens ?? 100,
        outputTokens: args.outputTokens ?? 50,
        cachedInputTokens: 0,
        costUsd: args.costUsd ?? 0.01,
        sessionId: null,
        requestType: 'chat',
    }));
}

async function runInsert(spec: QuerySpec): Promise<string> {
    const stmts = (await client.runRaw(spec.query, spec.variables)) as Array<{ status: string; result: unknown }>;
    if (stmts[0].status !== 'OK') {
        throw new Error(`Insert failed: ${JSON.stringify(stmts[0].result)}\nQuery: ${spec.query}`);
    }
    const rows = stmts[0].result as Array<{ id: unknown }>;
    return String(rows[0].id);
}

/**
 * Run a query spec and return the rows from the first statement.
 * Throws on a non-OK status with the SurrealDB error message in tow.
 */
async function queryRows<T = unknown>(spec: QuerySpec): Promise<T[]> {
    const stmts = (await client.runRaw(spec.query, spec.variables)) as Array<{ status: string; result: unknown }>;
    if (stmts[0].status !== 'OK') {
        throw new Error(`Query failed: ${JSON.stringify(stmts[0].result)}`);
    }
    return stmts[0].result as T[];
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('daily aggregation via local_date', () => {
    beforeEach(async () => {
        await client.runRaw('DELETE FROM metrics;');
    });

    it('GROUP BY local_date with math::sum returns one bucket per local calendar day', async () => {
        // 3 entries across 2 days. Day 1 has two entries summing to 5.
        await insertMetric({ metric_name: 'water', value: 2, lts: '2026-05-29T08:00:00Z', ts: '2026-05-29T13:00:00Z', local_date: '2026-05-29', local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'water', value: 3, lts: '2026-05-29T20:00:00Z', ts: '2026-05-30T01:00:00Z', local_date: '2026-05-29', local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'water', value: 1, lts: '2026-05-30T08:00:00Z', ts: '2026-05-30T13:00:00Z', local_date: '2026-05-30', local_tz: 'America/Chicago' });

        const rows = await queryRows<{ bucket: string; total: number }>({
            query: `SELECT local_date AS bucket, math::sum(value) AS total FROM metrics WHERE metric_name = 'water' GROUP BY bucket ORDER BY bucket ASC`,
            variables: {},
        });

        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({ bucket: '2026-05-29', total: 5 });
        expect(rows[1]).toEqual({ bucket: '2026-05-30', total: 1 });
    });

    it('handles a 30-day month-shape window correctly', async () => {
        // Seed 30 daily entries through May 2026.
        for (let day = 1; day <= 30; day++) {
            const d = String(day).padStart(2, '0');
            await insertMetric({
                metric_name: 'pushups', value: day,
                lts: `2026-05-${d}T08:00:00Z`,
                ts: `2026-05-${d}T13:00:00Z`,
                local_date: `2026-05-${d}`,
                local_tz: 'America/Chicago',
            });
        }
        const rows = await queryRows<{ bucket: string }>({
            query: `SELECT local_date AS bucket, math::sum(value) AS total FROM metrics WHERE metric_name = 'pushups' GROUP BY bucket ORDER BY bucket ASC`,
            variables: {},
        });
        expect(rows).toHaveLength(30);
        expect(rows[0].bucket).toBe('2026-05-01');
        expect(rows[29].bucket).toBe('2026-05-30');
    });
});

describe('DST fall-back — the canonical bug fixed by ts (real-UTC)', () => {
    beforeEach(async () => {
        await client.runRaw('DELETE FROM metrics;');
    });

    it('two events at identical local 1:30 AM have identical lts but distinct ts; ORDER BY ts is correct, ORDER BY lts is ambiguous', async () => {
        // 2026-11-01: clocks fall back at 2:00 AM CDT → 1:00 AM CST.
        // The reading "1:30 AM" happens twice in real time, ~1 hour apart:
        //   pre-fall-back:  01:30 CDT = 06:30 UTC
        //   post-fall-back: 01:30 CST = 07:30 UTC
        // Both store local wall-clock 01:30 → identical fake-UTC lts.
        const id_pre = await insertMetric({
            metric_name: 'water', value: 1,
            lts: '2026-11-01T01:30:00Z',
            ts: '2026-11-01T06:30:00Z',
            local_date: '2026-11-01',
            local_tz: 'America/Chicago',
        });
        const id_post = await insertMetric({
            metric_name: 'water', value: 1,
            lts: '2026-11-01T01:30:00Z',
            ts: '2026-11-01T07:30:00Z',
            local_date: '2026-11-01',
            local_tz: 'America/Chicago',
        });

        // The fix: ORDER BY ts distinguishes them in real-time order.
        const byTs = await queryRows<{ id: unknown; ts: string }>({
            query: `SELECT id, ts FROM metrics WHERE metric_name = 'water' ORDER BY ts ASC`,
            variables: {},
        });
        expect(byTs).toHaveLength(2);
        expect(String(byTs[0].id)).toBe(id_pre);
        expect(String(byTs[1].id)).toBe(id_post);

        // The bug: both rows carry identical lts strings.
        const ltsValues = await queryRows<{ lts: string }>({
            query: `SELECT lts FROM metrics WHERE metric_name = 'water'`,
            variables: {},
        });
        const ltsStrings = ltsValues.map((r) => String(r.lts));
        expect(ltsStrings[0]).toBe(ltsStrings[1]);

        // Both rows land in the same calendar-day bucket — what the user expects.
        const buckets = await queryRows<{ bucket: string; n: number }>({
            query: `SELECT local_date AS bucket, count() AS n FROM metrics WHERE metric_name = 'water' GROUP BY bucket`,
            variables: {},
        });
        expect(buckets).toHaveLength(1);
        expect(buckets[0]).toEqual({ bucket: '2026-11-01', n: 2 });
    });
});

describe('cross-tz rows co-bucket under local_date', () => {
    beforeEach(async () => {
        await client.runRaw('DELETE FROM metrics;');
    });

    it('Tokyo and Chicago rows with the same local_date appear in the same daily bucket regardless of querier tz', async () => {
        // Same local calendar day in two different zones.
        await insertMetric({
            metric_name: 'water', value: 1,
            lts: '2026-05-31T22:00:00Z', ts: '2026-05-31T13:00:00Z',
            local_date: '2026-05-31', local_tz: 'Asia/Tokyo',
        });
        await insertMetric({
            metric_name: 'water', value: 2,
            lts: '2026-05-31T20:00:00Z', ts: '2026-06-01T01:00:00Z',
            local_date: '2026-05-31', local_tz: 'America/Chicago',
        });

        const rows = await queryRows<{ bucket: string; total: number; n: number }>({
            query: `SELECT local_date AS bucket, math::sum(value) AS total, count() AS n FROM metrics WHERE metric_name = 'water' GROUP BY bucket`,
            variables: {},
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({ bucket: '2026-05-31', total: 3, n: 2 });
    });
});

describe('calendar date filter via local_date (lexicographic string comparison)', () => {
    beforeEach(async () => {
        await client.runRaw('DELETE FROM metrics;');
    });

    it('local_date >= from AND local_date <= to selects the right range', async () => {
        for (const date of ['2026-05-28', '2026-05-30', '2026-06-01', '2026-06-05']) {
            await insertMetric({
                metric_name: 'water', value: 1,
                lts: `${date}T08:00:00Z`, ts: `${date}T13:00:00Z`,
                local_date: date, local_tz: 'America/Chicago',
            });
        }

        const rows = await queryRows<{ local_date: string }>(
            queries.getMetrics({
                metric_name: 'water',
                from_date: '2026-05-30',
                to_date: '2026-06-01',
            }),
        );

        const dates = rows.map((r) => r.local_date).sort();
        expect(dates).toEqual(['2026-05-30', '2026-06-01']);
    });
});

describe('duration filter via ts (real-time math)', () => {
    beforeEach(async () => {
        await client.runRaw('DELETE FROM metrics;');
    });

    it('ts >= now - 7d returns only rows within the past 7 days of real time', async () => {
        // SurrealDB's `d'...'` literal parses ISO datetimes; strip milliseconds
        // to match the format used by other working tests (the existing
        // nowIso() helper in local_crud.test.ts does the same).
        const stripMs = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
        const now = new Date();
        const yesterday = new Date(now.getTime() - 86_400_000);
        const lastMonth = new Date(now.getTime() - 30 * 86_400_000);

        await insertMetric({
            metric_name: 'water', value: 1,
            lts: stripMs(yesterday), ts: stripMs(yesterday),
            local_date: yesterday.toISOString().slice(0, 10),
            local_tz: 'America/Chicago',
        });
        await insertMetric({
            metric_name: 'water', value: 1,
            lts: stripMs(lastMonth), ts: stripMs(lastMonth),
            local_date: lastMonth.toISOString().slice(0, 10),
            local_tz: 'America/Chicago',
        });

        const cutoff = stripMs(new Date(now.getTime() - 7 * 86_400_000));
        const rows = await queryRows({
            query: `SELECT * FROM metrics WHERE metric_name = 'water' AND ts >= d'${cutoff}'`,
            variables: {},
        });
        expect(rows).toHaveLength(1);
    });
});

describe('weekly aggregation via time::year/week(<datetime> local_date)', () => {
    beforeEach(async () => {
        await client.runRaw('DELETE FROM metrics;');
    });

    it('groups by ISO year/week derived from local_date', async () => {
        // 2026 ISO weeks (Mon-Sun):
        //   Week 22: May 25-31
        //   Week 23: June 1-7
        await insertMetric({ metric_name: 'water', value: 5, lts: '2026-05-27T08:00:00Z', ts: '2026-05-27T13:00:00Z', local_date: '2026-05-27', local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'water', value: 3, lts: '2026-05-29T08:00:00Z', ts: '2026-05-29T13:00:00Z', local_date: '2026-05-29', local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'water', value: 7, lts: '2026-06-03T08:00:00Z', ts: '2026-06-03T13:00:00Z', local_date: '2026-06-03', local_tz: 'America/Chicago' });

        const rows = await queryRows<{ yr: number; wk: number; total: number }>({
            query: `SELECT time::year(<datetime> local_date) AS yr, time::week(<datetime> local_date) AS wk, math::sum(value) AS total FROM metrics WHERE metric_name = 'water' GROUP BY yr, wk ORDER BY yr ASC, wk ASC`,
            variables: {},
        });

        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({ yr: 2026, wk: 22, total: 8 });
        expect(rows[1]).toEqual({ yr: 2026, wk: 23, total: 7 });
    });
});

describe('builder-emitted queries return correct results end-to-end', () => {
    beforeEach(async () => {
        await client.runRaw('DELETE FROM metrics;');
    });

    it('getRecentMetrics orders by ts DESC', async () => {
        await insertMetric({ metric_name: 'water', value: 1, lts: '2026-05-29T08:00:00Z', ts: '2026-05-29T13:00:00Z', local_date: '2026-05-29', local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'water', value: 2, lts: '2026-05-30T08:00:00Z', ts: '2026-05-30T13:00:00Z', local_date: '2026-05-30', local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'water', value: 3, lts: '2026-05-28T08:00:00Z', ts: '2026-05-28T13:00:00Z', local_date: '2026-05-28', local_tz: 'America/Chicago' });

        const rows = await queryRows<{ local_date: string }>(queries.getRecentMetrics({ limit: 3 }));
        expect(rows).toHaveLength(3);
        // DESC: latest first
        expect(rows.map((r) => r.local_date)).toEqual(['2026-05-30', '2026-05-29', '2026-05-28']);
    });

    it('buildMetricsQuery daily_sum groups by local_date with correct totals', async () => {
        await insertMetric({ metric_name: 'water', value: 2, lts: '2026-05-29T08:00:00Z', ts: '2026-05-29T13:00:00Z', local_date: '2026-05-29', local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'water', value: 3, lts: '2026-05-29T18:00:00Z', ts: '2026-05-29T23:00:00Z', local_date: '2026-05-29', local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'water', value: 1, lts: '2026-05-30T08:00:00Z', ts: '2026-05-30T13:00:00Z', local_date: '2026-05-30', local_tz: 'America/Chicago' });

        const ctx = { getCurrentLocalDate: (_tz: string) => '2026-06-01' };
        const spec = queries.buildMetricsQuery(
            {
                metric_name: 'water',
                aggregation: 'daily_sum',
                from_date: '2026-05-28',
                to_date: '2026-06-01',
            },
            'America/Chicago',
            ctx,
        );

        const rows = await queryRows<{ bucket: string; value: number }>(spec);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({ bucket: '2026-05-29', value: 5, unit: 'count' });
        expect(rows[1]).toEqual({ bucket: '2026-05-30', value: 1, unit: 'count' });
    });

    it('listLogs orders by ts DESC and filters by local_date range', async () => {
        // Use insertLog via the builder
        for (const [date, content] of [
            ['2026-05-28', 'oldest'],
            ['2026-05-30', 'middle'],
            ['2026-06-01', 'newest'],
        ] as const) {
            const spec = queries.insertLog({
                content,
                category: 'test',
                embedding: null,
                lts: `${date}T08:00:00Z`,
                ts: `${date}T13:00:00Z`,
                local_date: date,
                local_tz: 'America/Chicago',
            });
            await client.runRaw(spec.query, spec.variables);
        }

        const all = await queryRows<{ content: string }>(queries.listLogs({}));
        expect(all.map((r) => r.content)).toEqual(['newest', 'middle', 'oldest']);

        const ranged = await queryRows<{ content: string }>(
            queries.listLogs({
                dateFilter: ` AND local_date >= '2026-05-29' AND local_date <= '2026-05-31'`,
            }),
        );
        expect(ranged).toHaveLength(1);
        expect(ranged[0].content).toBe('middle');
    });

    it('searchLogs substring + dateFilter end-to-end', async () => {
        await insertLog({ content: 'drank water today', lts: '2026-05-28T08:00:00Z', ts: '2026-05-28T13:00:00Z', local_date: '2026-05-28' });
        await insertLog({ content: 'water again later', lts: '2026-05-30T08:00:00Z', ts: '2026-05-30T13:00:00Z', local_date: '2026-05-30' });
        await insertLog({ content: 'unrelated entry',   lts: '2026-05-30T18:00:00Z', ts: '2026-05-30T23:00:00Z', local_date: '2026-05-30' });

        const hits = await queryRows<{ content: string }>(
            queries.listLogs({ searchText: 'water' }),
        );
        expect(hits.map((r) => r.content).sort()).toEqual(['drank water today', 'water again later']);

        const dateConstrained = await queryRows<{ content: string }>(
            queries.listLogs({
                searchText: 'water',
                dateFilter: ` AND local_date = '2026-05-30'`,
            }),
        );
        expect(dateConstrained.map((r) => r.content)).toEqual(['water again later']);
    });
});

// ── New coverage: metrics builder modes not yet exercised ─────────────────

describe('buildMetricsQuery — modes not covered above', () => {
    beforeEach(async () => {
        await client.runRaw('DELETE FROM metrics;');
    });

    const ctx = { getCurrentLocalDate: (_tz: string) => '2026-06-15' };

    it('raw mode returns every row in ts ASC order', async () => {
        await insertMetric({ metric_name: 'water', value: 2, lts: '2026-05-29T08:00:00Z', ts: '2026-05-29T13:00:00Z', local_date: '2026-05-29', local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'water', value: 1, lts: '2026-05-30T08:00:00Z', ts: '2026-05-30T13:00:00Z', local_date: '2026-05-30', local_tz: 'America/Chicago' });

        const spec = queries.buildMetricsQuery(
            { metric_name: 'water', aggregation: 'raw', from_date: '2026-05-28', to_date: '2026-06-01' },
            'America/Chicago',
            ctx,
        );
        const rows = await queryRows<{ value: number; local_date: string }>(spec);
        expect(rows.map((r) => r.value)).toEqual([2, 1]);
    });

    it('weekly_sum via the builder groups across ISO weeks', async () => {
        await insertMetric({ metric_name: 'water', value: 5, lts: '2026-05-27T08:00:00Z', ts: '2026-05-27T13:00:00Z', local_date: '2026-05-27', local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'water', value: 3, lts: '2026-05-29T08:00:00Z', ts: '2026-05-29T13:00:00Z', local_date: '2026-05-29', local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'water', value: 7, lts: '2026-06-03T08:00:00Z', ts: '2026-06-03T13:00:00Z', local_date: '2026-06-03', local_tz: 'America/Chicago' });

        const spec = queries.buildMetricsQuery(
            { metric_name: 'water', aggregation: 'weekly_sum', from_date: '2026-05-25', to_date: '2026-06-15' },
            'America/Chicago',
            ctx,
        );
        const rows = await queryRows<{ yr: number; wk: number; value: number }>(spec);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ yr: 2026, wk: 22, value: 8 });
        expect(rows[1]).toMatchObject({ yr: 2026, wk: 23, value: 7 });
    });

    it.each([
        ['daily_max', 'math::max', 7],
        ['daily_min', 'math::min', 1],
        ['daily_avg', 'math::mean', 4],
    ] as const)('%s on one day with values 1, 4, 7 returns the right aggregate', async (agg, _fn, expected) => {
        for (const [value, hour] of [[1, '08'], [4, '12'], [7, '16']] as const) {
            await insertMetric({ metric_name: 'reps', value, lts: `2026-05-30T${hour}:00:00Z`, ts: `2026-05-30T${hour}:00:00Z`, local_date: '2026-05-30', local_tz: 'America/Chicago' });
        }
        const spec = queries.buildMetricsQuery(
            { metric_name: 'reps', aggregation: agg, from_date: '2026-05-30', to_date: '2026-05-30' },
            'America/Chicago',
            ctx,
        );
        const rows = await queryRows<{ bucket: string; value: number }>(spec);
        expect(rows).toHaveLength(1);
        expect(rows[0].value).toBe(expected);
    });

    it('stacked group_mode splits the series by metric_name', async () => {
        await insertMetric({ metric_name: 'water', value: 2, lts: '2026-05-29T08:00:00Z', ts: '2026-05-29T13:00:00Z', local_date: '2026-05-29', local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'sleep', value: 7, lts: '2026-05-29T08:00:00Z', ts: '2026-05-29T13:00:00Z', local_date: '2026-05-29', local_tz: 'America/Chicago', unit: 'hours' });
        await insertMetric({ metric_name: 'water', value: 3, lts: '2026-05-30T08:00:00Z', ts: '2026-05-30T13:00:00Z', local_date: '2026-05-30', local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'sleep', value: 6, lts: '2026-05-30T08:00:00Z', ts: '2026-05-30T13:00:00Z', local_date: '2026-05-30', local_tz: 'America/Chicago', unit: 'hours' });

        const spec = queries.buildMetricsQuery(
            {
                metric_name: 'water',
                metric_names: ['water', 'sleep'],
                aggregation: 'daily_sum',
                group_mode: 'stacked',
                from_date: '2026-05-28',
                to_date: '2026-06-01',
            },
            'America/Chicago',
            ctx,
        );
        const rows = await queryRows<{ bucket: string; metric_name: string; value: number }>(spec);
        expect(rows).toHaveLength(4);
        const byKey = new Map(rows.map((r) => [`${r.bucket}/${r.metric_name}`, r.value]));
        expect(byKey.get('2026-05-29/water')).toBe(2);
        expect(byKey.get('2026-05-29/sleep')).toBe(7);
        expect(byKey.get('2026-05-30/water')).toBe(3);
        expect(byKey.get('2026-05-30/sleep')).toBe(6);
    });

    it('recency mode (e.g. "3d") restricts to the past 3 days of real time', async () => {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 86_400_000);
        const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000);
        const stripMs = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
        await insertMetric({ metric_name: 'reps', value: 10, lts: stripMs(yesterday), ts: stripMs(yesterday), local_date: yesterday.toISOString().slice(0, 10), local_tz: 'America/Chicago' });
        await insertMetric({ metric_name: 'reps', value: 20, lts: stripMs(twoWeeksAgo), ts: stripMs(twoWeeksAgo), local_date: twoWeeksAgo.toISOString().slice(0, 10), local_tz: 'America/Chicago' });

        const spec = queries.buildMetricsQuery(
            { metric_name: 'reps', aggregation: 'daily_sum', recency: '3d' },
            'America/Chicago',
            ctx,
        );
        const rows = await queryRows<{ value: number }>(spec);
        expect(rows).toHaveLength(1);
        expect(rows[0].value).toBe(10);
    });
});

// ── New coverage: sessions / todos / usage_records / KG read paths ───────

describe('listSessions ordering', () => {
    beforeEach(async () => {
        await client.runRaw('DELETE FROM sessions;');
    });

    it('orders by ts DESC (real-UTC instant)', async () => {
        await insertSession({ label: 'oldest', lts: '2026-05-28T08:00:00Z', ts: '2026-05-28T13:00:00Z', local_date: '2026-05-28' });
        await insertSession({ label: 'newest', lts: '2026-05-30T08:00:00Z', ts: '2026-05-30T13:00:00Z', local_date: '2026-05-30' });
        await insertSession({ label: 'middle', lts: '2026-05-29T08:00:00Z', ts: '2026-05-29T13:00:00Z', local_date: '2026-05-29' });

        const rows = await queryRows<{ label: string }>(queries.listSessions({ limit: 10 }));
        expect(rows.map((r) => r.label)).toEqual(['newest', 'middle', 'oldest']);
    });
});

describe('todos read paths', () => {
    beforeEach(async () => {
        await client.runRaw('DELETE FROM user_data;');
    });

    it('getTodos active + ts DESC ordering', async () => {
        await insertTodo({ title: 'oldest', lts: '2026-05-28T08:00:00Z', ts: '2026-05-28T13:00:00Z', local_date: '2026-05-28' });
        await insertTodo({ title: 'newest', lts: '2026-05-30T08:00:00Z', ts: '2026-05-30T13:00:00Z', local_date: '2026-05-30' });
        await insertTodo({ title: 'middle', lts: '2026-05-29T08:00:00Z', ts: '2026-05-29T13:00:00Z', local_date: '2026-05-29' });

        const rows = await queryRows<{ data: { title: string } }>(queries.getTodos({ status: 'active', limit: 10 }));
        expect(rows.map((r) => r.data.title)).toEqual(['newest', 'middle', 'oldest']);
    });

    it('getCompletionsInPeriod filters by real-UTC ts range', async () => {
        const todoId = await insertTodo({ title: 'recurring', lts: '2026-05-28T08:00:00Z', ts: '2026-05-28T13:00:00Z', local_date: '2026-05-28' });
        await insertTodoCompletion({ parentId: todoId, lts: '2026-05-28T18:00:00Z', ts: '2026-05-28T23:00:00Z', local_date: '2026-05-28' });
        await insertTodoCompletion({ parentId: todoId, lts: '2026-05-30T18:00:00Z', ts: '2026-05-30T23:00:00Z', local_date: '2026-05-30' });
        await insertTodoCompletion({ parentId: todoId, lts: '2026-06-02T18:00:00Z', ts: '2026-06-02T23:00:00Z', local_date: '2026-06-02' });

        const spec = queries.getCompletionsInPeriod({
            parentId: todoId,
            start: '2026-05-29T00:00:00Z',
            end: '2026-05-31T23:59:59Z',
        });
        const rows = await queryRows(spec);
        expect(rows).toHaveLength(1);
    });
});

describe('usage_records read paths', () => {
    beforeEach(async () => {
        await client.runRaw('DELETE FROM usage_records;');
    });

    it('listUsageRecords orders by ts DESC and paginates via startAfter cursor', async () => {
        const ids: string[] = [];
        // Server-stamps ts = time::now(), so each insert is monotonically later.
        for (let i = 0; i < 5; i++) {
            ids.push(await insertUsageRecord({ inputTokens: i * 100 }));
            // Tiny delay so ts differs row-to-row (surreal's time::now() is microsecond).
            await new Promise((r) => setTimeout(r, 5));
        }

        const firstPage = await queryRows<{ id: unknown; ts: string }>(
            queries.listUsageRecords({ limit: 2 }),
        );
        expect(firstPage).toHaveLength(2);
        // DESC: newest first → last inserted
        expect(String(firstPage[0].id)).toBe(ids[4]);
        expect(String(firstPage[1].id)).toBe(ids[3]);

        const secondPage = await queryRows<{ id: unknown }>(
            queries.listUsageRecords({ limit: 2, startAfter: firstPage[1].ts }),
        );
        expect(secondPage).toHaveLength(2);
        expect(String(secondPage[0].id)).toBe(ids[2]);
        expect(String(secondPage[1].id)).toBe(ids[1]);
    });

    it('getUsageRecordsSince filters by ts >= cutoff', async () => {
        const beforeCutoff = await insertUsageRecord({ inputTokens: 10 });
        // Capture cutoff between the two inserts. Keep millisecond precision —
        // stripping ms would floor to the second, which on tight timing could
        // make beforeCutoff's stamp >= cutoff and break the test.
        await new Promise((r) => setTimeout(r, 50));
        const cutoff = new Date().toISOString();
        await new Promise((r) => setTimeout(r, 50));
        const afterCutoff = await insertUsageRecord({ inputTokens: 20 });

        const rows = await queryRows<{ id: unknown }>(queries.getUsageRecordsSince(cutoff));
        expect(rows.map((r) => String(r.id))).toEqual([afterCutoff]);
        // Sanity: the pre-cutoff row exists in the DB
        const all = await queryRows<{ id: unknown }>({
            query: 'SELECT id FROM usage_records',
            variables: {},
        });
        expect(all.map((r) => String(r.id)).sort()).toEqual([beforeCutoff, afterCutoff].sort());
    });
});
