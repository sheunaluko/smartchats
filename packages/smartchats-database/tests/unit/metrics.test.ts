import { describe, it, expect } from 'vitest';
import {
    getMetrics,
    getRecentMetrics,
    getMetricsSummary,
    buildMetricsLtsFilter,
    buildMetricsQuery,
    insertMetric,
} from '../../src/queries/index.js';
import type { MetricsLtsFilterCtx } from '../../src/queries/index.js';

// Stub the injected tz helpers so date resolution is deterministic — the
// builders take these as a parameter precisely so they don't reach into the
// in-app system module.
const ctx: MetricsLtsFilterCtx = {
    getCurrentLocalDate: () => '2026-06-01',
    toLocalTimestamp: () => '2026-05-01T00:00:00Z',
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

    it('sorts by lts DESC so the user sees wall-clock order', () => {
        expect(getMetrics().query).toContain('ORDER BY lts DESC');
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

    it('inlines date bounds as d-literals on lts (not parameter-bound)', () => {
        const spec = getMetrics({ from_date: '2026-01-01', to_date: '2026-01-31' });
        expect(spec.query).toContain("lts >= d'2026-01-01T00:00:00Z'");
        expect(spec.query).toContain("lts <= d'2026-01-31T23:59:59Z'");
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

describe('buildMetricsLtsFilter', () => {
    it('resolves "today" through the injected ctx', () => {
        expect(buildMetricsLtsFilter({ date: 'today' }, 'UTC', ctx)).toBe(
            "lts >= d'2026-06-01T00:00:00Z' AND lts <= d'2026-06-01T23:59:59Z'",
        );
    });

    it('brackets an explicit single date to its local day', () => {
        expect(buildMetricsLtsFilter({ date: '2026-03-23' }, 'UTC', ctx)).toBe(
            "lts >= d'2026-03-23T00:00:00Z' AND lts <= d'2026-03-23T23:59:59Z'",
        );
    });

    it('defaults the range end to "today" when only from_date is given', () => {
        expect(buildMetricsLtsFilter({ from_date: '2026-03-01' }, 'UTC', ctx)).toBe(
            "lts >= d'2026-03-01T00:00:00Z' AND lts <= d'2026-06-01T23:59:59Z'",
        );
    });

    it('parses a recency duration into a single lower-bound cutoff', () => {
        expect(buildMetricsLtsFilter({ recency: '2d' }, 'UTC', ctx)).toBe("lts >= d'2026-05-01T00:00:00Z'");
    });

    it('throws on a malformed duration', () => {
        expect(() => buildMetricsLtsFilter({ recency: 'banana' }, 'UTC', ctx)).toThrow(/Invalid duration/);
    });

    it('honors priority: an explicit date wins over a recency duration', () => {
        const filter = buildMetricsLtsFilter({ date: '2026-03-23', recency: '90d' }, 'UTC', ctx);
        expect(filter).toContain("d'2026-03-23T00:00:00Z'");
        expect(filter).not.toContain('2026-05-01');
    });
});

describe('buildMetricsQuery', () => {
    const dated = { date: '2026-03-23' };

    it('raw mode selects rows ascending and binds a single metric name', () => {
        const spec = buildMetricsQuery({ metric_name: 'steps', ...dated }, 'UTC', ctx);
        expect(spec.query).toContain('SELECT * FROM metrics');
        expect(spec.query).toContain('metric_name = $metric_name');
        expect(spec.query).toContain('ORDER BY lts ASC');
        expect(spec.variables.metric_name).toBe('steps');
    });

    it('inlines an IN list for multiple metric names rather than binding them', () => {
        const spec = buildMetricsQuery({ metric_name: 'steps', metric_names: ['steps', 'water'], ...dated }, 'UTC', ctx);
        expect(spec.query).toContain("metric_name IN ['steps', 'water']");
        expect(spec.variables.metric_name).toBeUndefined();
    });

    it('daily aggregation buckets by day with the requested math function', () => {
        const spec = buildMetricsQuery({ metric_name: 'steps', aggregation: 'daily_sum', ...dated }, 'UTC', ctx);
        expect(spec.query).toContain("time::group(lts, 'day') AS bucket");
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

    it('weekly aggregation buckets by year + week (SurrealDB time::group has no week unit)', () => {
        const spec = buildMetricsQuery({ metric_name: 'steps', aggregation: 'weekly_avg', date: '2026-03-23' }, 'UTC', ctx);
        expect(spec.query).toContain('time::year(lts) AS yr');
        expect(spec.query).toContain('time::week(lts) AS wk');
        expect(spec.query).toContain('math::mean(value)');
        expect(spec.query).toContain('GROUP BY yr, wk, unit');
    });
});

describe('insertMetric', () => {
    const args = {
        metric_name: 'steps',
        value: 100,
        unit: 'count',
        metric_type: 'numeric',
        timestamp: '2026-03-23T10:00:00Z',
        lts: '2026-03-23T10:00:00Z',
        local_tz: 'UTC',
        source: 'manual',
        source_text: 'walked 100 steps',
        source_log_id: null,
        category: 'fitness',
        time_shift_quantity: null,
        time_shift_unit: null,
        note: null,
    };

    it('casts both timestamp and lts to datetime so the dual-timestamp invariant holds', () => {
        const spec = insertMetric(args);
        expect(spec.query).toContain('timestamp: <datetime> $timestamp');
        expect(spec.query).toContain('lts: <datetime> $lts');
    });

    it('server-stamps created_at on insert', () => {
        expect(insertMetric(args).query).toContain('created_at: time::now()');
    });
});
