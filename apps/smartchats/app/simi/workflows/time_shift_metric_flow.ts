import { defineWorkflow } from 'simi';

/**
 * Verify that save_metric correctly applies time_shift to lts.
 *
 * Saves two test rows back-to-back:
 *   - simi_shift_realtime:  no shift → lts ≈ now
 *   - simi_shift_yesterday: -1 day shift → lts ≈ now − 24h
 *
 * Asserts the realtime save's lts is ~24h LATER than the yesterday save's
 * lts. Regression test for the prior bug where time_shift was stored as
 * metadata only and lts was always pinned to "now," which made charts
 * plot retroactive entries on the wrong day.
 */
export const timeShiftMetricFlow = defineWorkflow({
  id: 'time_shift_metric_flow',
  app: 'smartchats',
  tags: ['e2e', 'metrics', 'time_shift'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    { waitFor: 'state.agent !== null', timeout: 15000 },

    // ── Save real-time (no shift) ──
    { action: 'callFunction', args: ['save_metric', {
      metric_name: 'simi_shift_realtime',
      value: 1,
      unit: 'test',
      category: 'test',
    }], timeout: 10000 },
    { waitFor: 'state.functionCalls.some(c => c.name === "save_metric" && c.args?.[0]?.metric_name === "simi_shift_realtime" && c.status === "success")', timeout: 15000 },

    // ── Save with -1 day shift ──
    { action: 'callFunction', args: ['save_metric', {
      metric_name: 'simi_shift_yesterday',
      value: 1,
      unit: 'test',
      category: 'test',
      time_shift_quantity: -1,
      time_shift_unit: 'day',
    }], timeout: 10000 },
    { waitFor: 'state.functionCalls.some(c => c.name === "save_metric" && c.args?.[0]?.metric_name === "simi_shift_yesterday" && c.status === "success")', timeout: 15000 },

    // ── Assert lts delta is ~24h (allow a 1h tolerance for clock drift / TZ DST edges) ──
    { assert: `(() => {
      const realtime = state.functionCalls.find(c => c.name === "save_metric" && c.args?.[0]?.metric_name === "simi_shift_realtime");
      const yesterday = state.functionCalls.find(c => c.name === "save_metric" && c.args?.[0]?.metric_name === "simi_shift_yesterday");
      if (!realtime?.result || !yesterday?.result) return false;
      const ltsRealtime = realtime.result?.[0]?.lts || realtime.result?.lts;
      const ltsYesterday = yesterday.result?.[0]?.lts || yesterday.result?.lts;
      if (!ltsRealtime || !ltsYesterday) return false;
      const deltaHours = (new Date(ltsRealtime).getTime() - new Date(ltsYesterday).getTime()) / 3600000;
      return deltaHours > 23 && deltaHours < 25;
    })()`, message: 'time_shift=-1day should produce lts ~24h earlier than no-shift save (verify save_metric applies time_shift to lts, not just stores as metadata)' },
  ],
});
