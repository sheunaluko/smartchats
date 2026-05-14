import { defineWorkflow } from 'simi';

export const usageFetchFlow = defineWorkflow({
  id: 'usage_fetch_flow',
  app: 'smartchats_billing',
  tags: ['smoke', 'billing', 'usage'],
  steps: [
    // Fetch usage with periodOnly
    { action: 'fetchUsage', args: [{ periodOnly: true }], timeout: 15000, wait: 500 },

    // Assert usage records is an array
    { assert: 'Array.isArray(state.usageRecords)', message: 'usageRecords should be an array' },

    // Assert periodSummary is present (may be null for new users with no usage, or an object)
    { assert: 'state.periodSummary === null || typeof state.periodSummary === "object"', message: 'periodSummary should be null or an object' },

    // Assert no loading state lingering
    { assert: 'state.usageLoading === false', message: 'usageLoading should be false after fetch' },
    { assert: 'state.usageError === null', message: 'usageError should be null on success' },
  ],
});
