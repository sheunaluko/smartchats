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
 *   - AIO must be running with SurrealDB exposed on port 8000
 *     (`bin/aio --surreal-port 8000` — default)
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
}): Promise<string> {
    const spec = queries.insertMetric({
        metric_name: args.metric_name,
        value: args.value,
        unit: 'count',
        metric_type: 'numeric',
        lts: args.lts,
        ts: args.ts,
        local_date: args.local_date,
        local_tz: args.local_tz,
        source: 'test',
        source_text: '',
        source_log_id: null,
        category: 'test',
        time_shift_quantity: null,
        time_shift_unit: null,
        note: null,
    });
    const stmts = (await client.runRaw(spec.query, spec.variables)) as Array<{ status: string; result: unknown }>;
    if (stmts[0].status !== 'OK') {
        throw new Error(`Insert failed: ${JSON.stringify(stmts[0].result)}`);
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
        const now = new Date();
        const yesterday = new Date(now.getTime() - 86_400_000);
        const lastMonth = new Date(now.getTime() - 30 * 86_400_000);

        await insertMetric({
            metric_name: 'water', value: 1,
            lts: yesterday.toISOString(), ts: yesterday.toISOString(),
            local_date: yesterday.toISOString().slice(0, 10),
            local_tz: 'America/Chicago',
        });
        await insertMetric({
            metric_name: 'water', value: 1,
            lts: lastMonth.toISOString(), ts: lastMonth.toISOString(),
            local_date: lastMonth.toISOString().slice(0, 10),
            local_tz: 'America/Chicago',
        });

        const cutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString();
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
});
