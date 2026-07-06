import { defineWorkflow } from 'simi';

export const booleanMetricsFlow = defineWorkflow({
  id: 'boolean_metrics_flow',
  app: 'smartchats',
  tags: ['e2e', 'metrics', 'boolean'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // ── Setup ──
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'clearChat', args: [], wait: 500 },

    // ── Step 1: Save a positive boolean metric ──
    // Explicit phrasing ("use boolean metrics to note...") nudges the agent
    // toward an immediate save_metric call rather than asking whether to
    // track-vs-log when the metric isn't already in the tracked set.
    { action: 'sendMessageAsync', args: ['use boolean metrics to note that I meditated today'], timeout: 60000, wait: 500 },

    // Wait for save_metric to complete (functionCalls resets per execution)
    { waitFor: 'state.functionCalls.some(c => c.name === "save_metric" && c.status === "success")', timeout: 30000 },

    // Assert it was saved as boolean with value 1
    { assert: 'state.functionCalls.some(c => c.name === "save_metric" && c.args?.[0]?.metric_type === "boolean")', message: 'save_metric should have metric_type "boolean"' },
    { assert: 'state.functionCalls.some(c => c.name === "save_metric" && (c.args?.[0]?.value === 1 || c.args?.[0]?.value === undefined))', message: 'Boolean metric value should be 1 (or omitted to default)' },
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should have confirmed the save' },

    // ── Step 2: Save a negative boolean metric ──
    // Wait for LLM to finish before sending next message
    { waitFor: '!state.llmRunning', timeout: 30000 },
    // Pin the metric name explicitly in the prompt. Without this the
    // agent sometimes asks whether to create a new metric or use a log
    // category — that's a reasonable judgment call for an ambiguous
    // mention but it's variance the test can't accommodate. Naming the
    // metric in the user message takes that decision off the table.
    { action: 'sendMessageAsync', args: ['use boolean metrics to note that I did not journal today. use a metric name of "daily_journal".'], timeout: 60000, wait: 500 },

    // Wait for save_metric to complete in this execution
    { waitFor: 'state.functionCalls.some(c => c.name === "save_metric" && c.status === "success")', timeout: 30000 },

    // Assert the negative metric was saved with value 0
    { assert: 'state.functionCalls.some(c => c.name === "save_metric" && c.args?.[0]?.value === 0)', message: 'Negated boolean metric should have value 0' },

    // ── Step 3: Ask about habit summary ──
    { waitFor: '!state.llmRunning', timeout: 30000 },
    { action: 'sendMessageAsync', args: ['How is my meditation streak? Check my habit summary.'], timeout: 60000, wait: 500 },

    // Wait for retrieve_habit_summary to be called
    { waitFor: 'state.functionCalls.some(c => c.name === "retrieve_habit_summary" && c.status === "success")', timeout: 30000 },

    // Assert the habit summary was retrieved for meditation
    { assert: 'state.functionCalls.some(c => c.name === "retrieve_habit_summary" && c.args?.[0]?.metric_name === "meditation")', message: 'retrieve_habit_summary should be called for meditation' },
    { assert: 'state.lastAiMessage.length > 0', message: 'AI should have responded with habit summary' },
  ],
});
