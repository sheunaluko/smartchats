import { defineWorkflow } from 'simi';

/**
 * Verify that save_metric correctly applies time_shift to ts.
 *
 * Saves two test rows back-to-back:
 *   - simi_shift_realtime:  no shift → ts ≈ now
 *   - simi_shift_yesterday: -1 day shift → ts ≈ now − 24h
 *
 * Asserts the realtime save's ts is ~24h LATER than the yesterday save's
 * ts. Regression test for the prior bug where time_shift was stored as
 * metadata only and ts was always pinned to "now," which made charts
 * plot retroactive entries on the wrong day.
 *
 * Uses `id:` on each `callFunction` step + `results.<id>` in the assert —
 * direct callFunction invocations bypass the sandbox so `state.functionCalls`
 * isn't populated (that's the agent/LLM path). The Simi runner captures
 * action return values under `results.<id>` instead.
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
    }], id: 'realtime', timeout: 10000 },

    // ── Save with -1 day shift ──
    { action: 'callFunction', args: ['save_metric', {
      metric_name: 'simi_shift_yesterday',
      value: 1,
      unit: 'test',
      category: 'test',
      time_shift_quantity: -1,
      time_shift_unit: 'day',
    }], id: 'yesterday', timeout: 10000 },

    // ── Both calls returned. save_metric returns `response.rows` which is
    //    a 1-element array (the inserted row). Assert ts delta ≈ 24h. ──
    { assert: `(() => {
      const tsRealtime = results.realtime?.[0]?.ts;
      const tsYesterday = results.yesterday?.[0]?.ts;
      if (!tsRealtime || !tsYesterday) return false;
      const deltaHours = (new Date(tsRealtime).getTime() - new Date(tsYesterday).getTime()) / 3600000;
      // realtime is "now", yesterday is "now - 24h" → diff ≈ +24h (1h tolerance for DST / clock drift)
      return deltaHours > 23 && deltaHours < 25;
    })()`, message: 'time_shift=-1day should produce ts ~24h earlier than no-shift save (verify save_metric applies time_shift to ts, not just stores as metadata)' },
  ],
});
