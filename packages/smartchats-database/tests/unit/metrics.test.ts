import { describe, it, expect } from 'vitest';
import {
    getMetrics,
    getRecentMetrics,
    getMetricsSummary,
    buildMetricsTimeFilter,
    buildMetricsQuery,
    insertMetric,
} from '../../src/queries/index.js';
import type { MetricsTimeFilterCtx } from '../../src/queries/index.js';

// Stub the injected tz helper so date resolution is deterministic — the
// builders take it as a parameter precisely so they don't reach into the
// in-app system module.
const ctx: MetricsTimeFilterCtx = {
    getCurrentLocalDate: () => '2026-06-01',
};

describe('getMetrics', () => {
    it('defaults the limit to 50', () => {
        expect(getMetrics().query).toMatch(/LIMIT 50$/);
    });

    it('clamps an oversized limit to 200 and a zero/negative limit to 1', () => {
        expect(getMetrics({ limit: 9999 }).query).toMatch(/LIMIT 200$/);
        expect(getMetrics({ limit: 0 }).query).toMatch(/LIMIT 1$/);
        expect(getMetrics({ limit: -3 }).query).toMatch(/LIMIT 1$/);
    });

    it('sorts by ts DESC so the newest reading leads', () => {
        expect(getMetrics().query).toContain('ORDER BY ts DESC');
    });

    it('emits no WHERE clause when no filters are passed', () => {
        expect(getMetrics().query).not.toContain('WHERE');
    });

    it('binds metric_name and category filters', () => {
        const spec = getMetrics({ metric_name: 'steps', category: 'fitness' });
        expect(spec.query).toContain('metric_name = $metric_name');
        expect(spec.query).toContain('category = $category');
        expect(spec.variables).toEqual({ metric_name: 'steps', category: 'fitness' });
    });

    it('inlines calendar bounds as plain local_date strings, not parameter-bound', () => {
        // local_date is YYYY-MM-DD, so lexicographic comparison IS date
        // comparison — no tz arithmetic and no datetime cast needed.
        const spec = getMetrics({ from_date: '2026-01-01', to_date: '2026-01-31' });
        expect(spec.query).toContain("local_date >= '2026-01-01'");
        expect(spec.query).toContain("local_date <= '2026-01-31'");
        expect(spec.variables.from_date).toBeUndefined();
    });
});

describe('getRecentMetrics', () => {
    it('omits the LIMIT clause entirely when no cap is given (full visualization)', () => {
        expect(getRecentMetrics().query).not.toContain('LIMIT');
    });

    it('floors a fractional limit and clamps a zero/negative one up to 1', () => {
        expect(getRecentMetrics({ limit: 3.9 }).query).toMatch(/LIMIT 3$/);
        expect(getRecentMetrics({ limit: 0 }).query).toMatch(/LIMIT 1$/);
    });
});

describe('getMetricsSummary', () => {
    it('groups by metric_type so boolean habits stay distinct from numeric metrics', () => {
        const q = getMetricsSummary().query;
        expect(q).toContain('count() AS entry_count');
        expect(q).toContain('GROUP BY metric_name, unit, category, metric_type');
    });
});

describe('buildMetricsTimeFilter', () => {
    // Two filter families, deliberately different columns:
    //   calendar (date / from_date / to_date) → local_date, lexicographic
    //   duration (recency / date_range)       → ts, real-UTC math
    // Calendar filters must NOT go through ts, or a user outside UTC gets
    // the wrong day; duration filters must NOT go through local_date, or
    // the math breaks across DST and travel.

    it('resolves "today" through the injected ctx and pins it to one local day', () => {
        expect(buildMetricsTimeFilter({ date: 'today' }, 'UTC', ctx)).toBe("local_date = '2026-06-01'");
    });

    it('matches an explicit single date exactly, with no range arithmetic', () => {
        expect(buildMetricsTimeFilter({ date: '2026-03-23' }, 'UTC', ctx)).toBe("local_date = '2026-03-23'");
    });

    it('defaults the range end to "today" when only from_date is given', () => {
        expect(buildMetricsTimeFilter({ from_date: '2026-03-01' }, 'UTC', ctx)).toBe(
            "local_date >= '2026-03-01' AND local_date <= '2026-06-01'",
        );
    });

    it('turns a recency duration into a single real-UTC lower bound on ts', () => {
        const filter = buildMetricsTimeFilter({ recency: '2d' }, 'UTC', ctx);
        expect(filter).toMatch(/^ts >= d'.+'$/);
        // Cutoff is computed from the wall clock, so assert the offset
        // rather than a literal instant.
        const cutoff = new Date(filter.slice("ts >= d'".length, -1)).getTime();
        expect(Date.now() - cutoff).toBeGreaterThan(2 * 86400000 - 5000);
        expect(Date.now() - cutoff).toBeLessThan(2 * 86400000 + 5000);
    });

    it('falls back to a 4w window when neither a date nor a duration is given', () => {
        expect(buildMetricsTimeFilter({}, 'UTC', ctx)).toMatch(/^ts >= d'.+'$/);
    });

    it('throws on a malformed duration', () => {
        expect(() => buildMetricsTimeFilter({ recency: 'banana' }, 'UTC', ctx)).toThrow(/Invalid duration/);
    });

    it('honors priority: an explicit date wins over a recency duration', () => {
        const filter = buildMetricsTimeFilter({ date: '2026-03-23', recency: '90d' }, 'UTC', ctx);
        expect(filter).toBe("local_date = '2026-03-23'");
        expect(filter).not.toContain('ts >=');
    });

    it('honors priority: a from_date range wins over a recency duration', () => {
        const filter = buildMetricsTimeFilter({ from_date: '2026-03-01', recency: '90d' }, 'UTC', ctx);
        expect(filter).toContain("local_date >= '2026-03-01'");
        expect(filter).not.toContain('ts >=');
    });
});

describe('buildMetricsQuery', () => {
    const dated = { date: '2026-03-23' };

    it('raw mode selects rows ascending and binds a single metric name', () => {
        const spec = buildMetricsQuery({ metric_name: 'steps', ...dated }, 'UTC', ctx);
        expect(spec.query).toContain('SELECT * FROM metrics');
        expect(spec.query).toContain('metric_name = $metric_name');
        expect(spec.query).toContain('ORDER BY ts ASC');
        expect(spec.variables.metric_name).toBe('steps');
    });

    it('inlines an IN list for multiple metric names rather than binding them', () => {
        const spec = buildMetricsQuery({ metric_name: 'steps', metric_names: ['steps', 'water'], ...dated }, 'UTC', ctx);
        expect(spec.query).toContain("metric_name IN ['steps', 'water']");
        expect(spec.variables.metric_name).toBeUndefined();
    });

    it('daily aggregation buckets on the indexed local_date column, not time::group', () => {
        // time::group(ts, 'day') would bucket in UTC — wrong for any user
        // outside UTC. local_date is already the user's calendar day.
        const spec = buildMetricsQuery({ metric_name: 'steps', aggregation: 'daily_sum', ...dated }, 'UTC', ctx);
        expect(spec.query).toContain('local_date AS bucket');
        expect(spec.query).not.toContain('time::group');
        expect(spec.query).toContain('math::sum(value)');
        expect(spec.query).toContain('GROUP BY bucket, unit');
    });

    it('stacked grouping keeps metric_name in the projection and GROUP BY', () => {
        const spec = buildMetricsQuery(
            { metric_name: 'a', metric_names: ['a', 'b'], aggregation: 'daily_sum', group_mode: 'stacked', ...dated },
            'UTC',
            ctx,
        );
        expect(spec.query).toContain('GROUP BY bucket, metric_name, unit');
    });

    it('weekly aggregation derives year + week from local_date (time::group has no week unit)', () => {
        // Casting local_date to datetime yields midnight of the local
        // calendar day, so the ISO week matches the user's local week.
        const spec = buildMetricsQuery({ metric_name: 'steps', aggregation: 'weekly_avg', date: '2026-03-23' }, 'UTC', ctx);
        expect(spec.query).toContain("<int> time::format(<datetime> local_date, '%G') AS yr");
        expect(spec.query).toContain("<int> time::format(<datetime> local_date, '%V') AS wk");
        expect(spec.query).toContain('math::mean(value)');
        expect(spec.query).toContain('GROUP BY yr, wk, unit');
    });

    it('takes BOTH halves of the weekly bucket from the ISO calendar', () => {
        // Regression guard. time::year() is the CALENDAR year and disagrees
        // with the ISO week number at a year boundary: 2025-12-29 is ISO
        // 2026-W01, but time::year returns 2025 — bucketing it as (2025, 1),
        // which splits one ISO week in two AND sorts late December ahead of
        // January under `ORDER BY yr, wk`. %G (ISO week-year) is the only
        // year that pairs correctly with %V.
        const spec = buildMetricsQuery({ metric_name: 'steps', aggregation: 'weekly_sum', date: '2026-03-23' }, 'UTC', ctx);
        expect(spec.query).not.toContain('time::year(');
        expect(spec.query).not.toContain('time::week(');
    });
});

describe('insertMetric', () => {
    const args = {
        metric_name: 'steps',
        value: 100,
        unit: 'count',
        metric_type: 'numeric',
        ts: '2026-03-23T10:00:00Z',
        local_date: '2026-03-23',
        local_tz: 'UTC',
        source: 'manual',
        source_text: 'walked 100 steps',
        source_log_id: null,
        category: 'fitness',
        time_shift_quantity: null,
        time_shift_unit: null,
        note: null,
    };

    it('casts the event-time triple, keeping local_date a string', () => {
        const spec = insertMetric(args);
        expect(spec.query).toContain('ts: <datetime> $ts');
        expect(spec.query).toContain('local_date: <string> $local_date');
        expect(spec.query).toContain('local_tz: <string> $local_tz');
    });

    it('server-stamps created_at on insert', () => {
        expect(insertMetric(args).query).toContain('created_at: time::now()');
    });
});
