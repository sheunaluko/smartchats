import { defineWorkflow } from 'simi';

export const balanceFetchFlow = defineWorkflow({
  id: 'balance_fetch_flow',
  app: 'smartchats_billing',
  tags: ['smoke', 'billing'],
  steps: [
    // Fetch balance from backend
    { action: 'fetchBalance', args: [], timeout: 15000, wait: 500 },

    // Assert core balance fields
    { assert: 'typeof state.tier === "string" && state.tier.length > 0', message: 'tier should be a non-empty string' },
    { assert: 'typeof state.totalAvailable === "number" && state.totalAvailable >= 0', message: 'totalAvailable should be a number >= 0' },

    // Assert BYO keys object exists with all three provider keys
    { assert: 'state.byoKeys !== null && typeof state.byoKeys === "object"', message: 'byoKeys object should exist' },
    { assert: '"openai" in state.byoKeys', message: 'byoKeys should have openai key' },
    { assert: '"anthropic" in state.byoKeys', message: 'byoKeys should have anthropic key' },
    { assert: '"google" in state.byoKeys', message: 'byoKeys should have google key' },
  ],
});
