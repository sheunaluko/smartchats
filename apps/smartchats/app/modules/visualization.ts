/**
 * Visualization functions: show_bar_chart, show_line_chart, show_pie_chart,
 * show_stat_card, show_table, show_image, show_metric_extraction_review.
 *
 * Each emits a `visualization_update` event with { vizType, props }.
 * The orchestrator routes to store → shell renders via VisualizationRenderer.
 */

export function validateExtractionData(
    sources: any[],
    extractions: Record<string, any>,
    sourceKey: string
): { ok: true } | { ok: false; errors: string[] } {
    const errors: string[] = [];
    if (!Array.isArray(sources) || sources.length === 0)
        errors.push('sources must be a non-empty array');
    if (!extractions || typeof extractions !== 'object')
        errors.push('extractions must be an object');
    if (errors.length) return { ok: false, errors };

    const missing = sources.filter(s => s[sourceKey] === undefined || s[sourceKey] === null);
    if (missing.length) errors.push(`${missing.length} sources missing '${sourceKey}' field`);

    const ids = new Set(sources.map(s => String(s[sourceKey])));
    const orphaned = Object.keys(extractions).filter(k => !ids.has(k));
    if (orphaned.length) errors.push(`${orphaned.length} extractions reference non-existent sources`);

    return errors.length ? { ok: false, errors } : { ok: true };
}

export function createVisualizationModule() {
    return {
        id: 'visualization_functions',
        name: 'Visualization Functions',
        position: 51,
        system_msg: `## Visualization
When the user asks for progress updates during a multi-step interaction or sequence, default to using show_progress_bar or show_progress_pie with a viz_id to visually track progress — don't just describe it in text. Update the same viz_id as progress changes so the chart updates in place.

Use show_calendar for monthly habit views (boolean mode: filled/empty circles) or daily metric heatmaps (quantitative mode: color intensity). The calendar supports month navigation and hover tooltips. For metric-driven calendars, prefer display_metrics with presentation "calendar" instead — it handles the data query automatically.

When displaying time-series data, default to dense mode (time_mode: "dense") so the user can see the full date range including days with no data. Dense mode fills missing days with 0 and keeps lines connected, making gaps in tracking visible.`,
        functions: [
            {
                enabled: true,
                name: 'show_bar_chart',
                description: `Display a horizontal bar chart. Provide viz_id to update in place.`,
                parameters: { title: 'string', items: 'array', unit: 'string', yMin: 'number', yMax: 'number', viz_id: 'string' },
                fn: async (ops: any) => {
                    const { title, items, unit, yMin, yMax, viz_id } = ops.params;
                    ops.util.event({ type: 'visualization_update', vizType: 'bar_chart', props: { title, items, unit, yMin, yMax }, vizId: viz_id });
                    return viz_id ? "Bar chart updated" : "Bar chart displayed";
                },
                return_type: 'string',
            },
            {
                enabled: true,
                name: 'show_line_chart',
                description: `Display a line chart with one or more series. Provide viz_id to update in place.`,
                parameters: { title: 'string', series: 'array', xLabel: 'string', yLabel: 'string', yMin: 'number', yMax: 'number', viz_id: 'string' },
                fn: async (ops: any) => {
                    const { title, series, xLabel, yLabel, yMin, yMax, viz_id } = ops.params;
                    ops.util.event({ type: 'visualization_update', vizType: 'line_chart', props: { title, series, xLabel, yLabel, yMin, yMax }, vizId: viz_id });
                    return viz_id ? "Line chart updated" : "Line chart displayed";
                },
                return_type: 'string',
            },
            {
                enabled: true,
                name: 'show_pie_chart',
                description: `Display a pie chart showing proportions.`,
                parameters: { title: 'string', slices: 'array', viz_id: 'string' },
                fn: async (ops: any) => {
                    const { title, slices, viz_id } = ops.params;
                    ops.util.event({ type: 'visualization_update', vizType: 'pie_chart', props: { title, slices }, vizId: viz_id });
                    return viz_id ? "Pie chart updated" : "Pie chart displayed";
                },
                return_type: 'string',
            },
            {
                enabled: true,
                name: 'show_jitter_plot',
                description: `Display a jitter/strip plot — points by category with vertical spread. Good for distributions and group comparison.`,
                parameters: { title: 'string', categories: 'array', yLabel: 'string', yMin: 'number', yMax: 'number', pointSize: 'number', viz_id: 'string' },
                fn: async (ops: any) => {
                    const { title, categories, yLabel, yMin, yMax, pointSize, viz_id } = ops.params;
                    ops.util.event({ type: 'visualization_update', vizType: 'jitter_plot', props: { title, categories, yLabel, yMin, yMax, pointSize }, vizId: viz_id });
                    return viz_id ? "Jitter plot updated" : "Jitter plot displayed";
                },
                return_type: 'string',
            },
            {
                enabled: true,
                name: 'show_stat_card',
                description: `Display a large metric card with number and optional delta/direction indicator.`,
                parameters: { label: 'string', value: 'string', delta: 'string', deltaDirection: 'string', viz_id: 'string' },
                fn: async (ops: any) => {
                    const { label, value, delta, deltaDirection, viz_id } = ops.params;
                    ops.util.event({ type: 'visualization_update', vizType: 'stat_card', props: { label, value, delta, deltaDirection }, vizId: viz_id });
                    return viz_id ? "Stat card updated" : "Stat card displayed";
                },
                return_type: 'string',
            },
            {
                enabled: true,
                name: 'show_table',
                description: `Display a compact data table with headers and rows.`,
                parameters: { title: 'string', columns: 'array', rows: 'array', viz_id: 'string' },
                fn: async (ops: any) => {
                    const { title, columns, rows, viz_id } = ops.params;
                    ops.util.event({ type: 'visualization_update', vizType: 'table', props: { title, columns, rows }, vizId: viz_id });
                    return viz_id ? "Table updated" : "Table displayed";
                },
                return_type: 'string',
            },
            {
                enabled: true,
                name: 'show_image',
                description: `Display an image with optional caption.`,
                parameters: { url: 'string', alt: 'string', caption: 'string' },
                fn: async (ops: any) => {
                    const { url, alt, caption } = ops.params;
                    ops.util.event({ type: 'visualization_update', vizType: 'image', props: { url, alt, caption } });
                    return "Image displayed";
                },
                return_type: 'string',
            },
            {
                enabled: true,
                name: 'show_progress_bar',
                description: `Display a progress bar showing value out of max. Provide viz_id to update in place.`,
                parameters: { label: 'string', value: 'number', max: 'number', unit: 'string', title: 'string', viz_id: 'string' },
                fn: async (ops: any) => {
                    const { label, value, max, unit, title, viz_id } = ops.params;
                    const v = Number(value) || 0;
                    const m = Number(max) || 1;
                    const props = {
                        title: title || `${label}: ${v}/${m}${unit ? ` ${unit}` : ''}`,
                        items: [{ label: label || 'Progress', value: v }],
                        unit: unit || '',
                        yMin: 0,
                        yMax: m,
                    };
                    ops.util.event({ type: 'visualization_update', vizType: 'bar_chart', props, vizId: viz_id });
                    return viz_id ? "Progress bar updated" : "Progress bar displayed";
                },
                return_type: 'string',
            },
            {
                enabled: true,
                name: 'show_progress_pie',
                description: `Display progress as completed vs remaining pie slices.`,
                parameters: { label: 'string', value: 'number', max: 'number', title: 'string', viz_id: 'string' },
                fn: async (ops: any) => {
                    const { label, value, max, title, viz_id } = ops.params;
                    const v = Math.min(Number(value) || 0, Number(max) || 1);
                    const m = Number(max) || 1;
                    const remaining = m - v;
                    const props = {
                        title: title || `${label}: ${v}/${m}`,
                        slices: [
                            { label: 'Completed', value: v },
                            ...(remaining > 0 ? [{ label: 'Remaining', value: remaining, color: 'var(--sc-surface-secondary, #333)' }] : []),
                        ],
                    };
                    ops.util.event({ type: 'visualization_update', vizType: 'pie_chart', props, vizId: viz_id });
                    return viz_id ? "Progress pie updated" : "Progress pie displayed";
                },
                return_type: 'string',
            },
            {
                enabled: true,
                description: `Display a monthly calendar heatmap. Supports boolean habits (done/not done) and quantitative metrics (color intensity).`,
                name: 'show_calendar',
                parameters: { title: 'string', year: 'number', month: 'number', days: 'array', mode: 'string', unit: 'string', viz_id: 'string' },
                fn: async (ops: any) => {
                    const { title, year, month, days, mode, unit, viz_id } = ops.params;
                    if (!year || !month || !Array.isArray(days)) {
                        return 'Error: year (number), month (1-12), and days (array) are required';
                    }
                    ops.util.event({
                        type: 'visualization_update',
                        vizType: 'calendar',
                        props: { title, year, month, days, mode: mode || 'boolean', unit },
                        vizId: viz_id,
                    });
                    return viz_id ? 'Calendar updated' : 'Calendar displayed';
                },
                return_type: 'string',
            },
        ],
    };
}
