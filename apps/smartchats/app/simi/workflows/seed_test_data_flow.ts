import { defineWorkflow } from 'simi';

/**
 * Seed Test Data — populates realistic metrics and logs for testing.
 * Zero LLM. Uses callFunction to save metrics and logs directly.
 * Creates ~2 weeks of varied data across multiple categories.
 */
export const seedTestDataFlow = defineWorkflow({
  id: 'seed_test_data_flow',
  app: 'smartchats',
  tags: ['setup', 'data', 'metrics', 'logs'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // ── Setup ──
    { waitFor: 'state.agent !== null', timeout: 15000 },
    { action: 'seedAndLoadApps', args: [], timeout: 30000 },

    // ── Metrics: weight (daily, 14 days) ──
    { action: 'callFunction', args: ['save_metric', { metric_name: 'weight', value: 162, unit: 'lbs', category: 'health' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'weight', value: 161.5, unit: 'lbs', category: 'health', time_shift_quantity: -1, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'weight', value: 162.2, unit: 'lbs', category: 'health', time_shift_quantity: -2, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'weight', value: 163, unit: 'lbs', category: 'health', time_shift_quantity: -3, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'weight', value: 162.8, unit: 'lbs', category: 'health', time_shift_quantity: -5, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'weight', value: 163.5, unit: 'lbs', category: 'health', time_shift_quantity: -7, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'weight', value: 164, unit: 'lbs', category: 'health', time_shift_quantity: -10, time_shift_unit: 'day' }], timeout: 5000 },

    // ── Metrics: running (varied distances) ──
    { action: 'callFunction', args: ['save_metric', { metric_name: 'running_distance', value: 3.2, unit: 'miles', category: 'exercise' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'running_distance', value: 5.0, unit: 'miles', category: 'exercise', time_shift_quantity: -2, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'running_distance', value: 2.5, unit: 'miles', category: 'exercise', time_shift_quantity: -4, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'running_distance', value: 4.1, unit: 'miles', category: 'exercise', time_shift_quantity: -6, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'running_distance', value: 6.2, unit: 'miles', category: 'exercise', time_shift_quantity: -9, time_shift_unit: 'day' }], timeout: 5000 },

    // ── Metrics: pullups ──
    { action: 'callFunction', args: ['save_metric', { metric_name: 'pullups', value: 40, unit: 'reps', category: 'exercise' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'pullups', value: 35, unit: 'reps', category: 'exercise', time_shift_quantity: -1, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'pullups', value: 42, unit: 'reps', category: 'exercise', time_shift_quantity: -3, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'pullups', value: 38, unit: 'reps', category: 'exercise', time_shift_quantity: -5, time_shift_unit: 'day' }], timeout: 5000 },

    // ── Metrics: water intake ──
    { action: 'callFunction', args: ['save_metric', { metric_name: 'water_intake', value: 8, unit: 'glasses', category: 'nutrition' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'water_intake', value: 6, unit: 'glasses', category: 'nutrition', time_shift_quantity: -1, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'water_intake', value: 7, unit: 'glasses', category: 'nutrition', time_shift_quantity: -2, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'water_intake', value: 9, unit: 'glasses', category: 'nutrition', time_shift_quantity: -3, time_shift_unit: 'day' }], timeout: 5000 },

    // ── Metrics: meditation (boolean habit) ──
    { action: 'callFunction', args: ['save_metric', { metric_name: 'meditation', value: 1, unit: 'done', metric_type: 'boolean', category: 'wellness' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'meditation', value: 1, unit: 'done', metric_type: 'boolean', category: 'wellness', time_shift_quantity: -1, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'meditation', value: 0, unit: 'done', metric_type: 'boolean', category: 'wellness', time_shift_quantity: -2, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'meditation', value: 1, unit: 'done', metric_type: 'boolean', category: 'wellness', time_shift_quantity: -3, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'meditation', value: 1, unit: 'done', metric_type: 'boolean', category: 'wellness', time_shift_quantity: -4, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'meditation', value: 1, unit: 'done', metric_type: 'boolean', category: 'wellness', time_shift_quantity: -5, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'meditation', value: 0, unit: 'done', metric_type: 'boolean', category: 'wellness', time_shift_quantity: -6, time_shift_unit: 'day' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_metric', { metric_name: 'meditation', value: 1, unit: 'done', metric_type: 'boolean', category: 'wellness', time_shift_quantity: -7, time_shift_unit: 'day' }], timeout: 5000 },

    // ── Logs ──
    { action: 'callFunction', args: ['save_log', { text: 'Great morning run, felt strong on the hills', category: 'exercise' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_log', { text: 'Meditated for 20 minutes, very focused session', category: 'wellness' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_log', { text: 'Need to drink more water, felt dehydrated today', category: 'nutrition' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_log', { text: 'Weight trending down, diet changes are working', category: 'health' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_log', { text: 'Pulled off 42 pullups in one set, new personal best', category: 'exercise' }], timeout: 5000 },
    { action: 'callFunction', args: ['save_log', { text: 'Skipped meditation today, too busy with work', category: 'wellness' }], timeout: 5000 },
  ],
});
