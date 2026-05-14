import { defineWorkflow } from 'simi';

export const byoKeyLifecycleFlow = defineWorkflow({
  id: 'byo_key_lifecycle_flow',
  app: 'smartchats_billing',
  tags: ['e2e', 'billing', 'byo'],
  steps: [
    // Fetch initial balance to get current BYO key state
    { action: 'fetchBalance', args: [], timeout: 15000, wait: 500 },

    // Save a test OpenAI key
    { action: 'saveBYOKeys', args: [{ openai: 'sk-test-00000000000000000000' }], timeout: 15000, wait: 500 },

    // After save, fetchBalance is called internally — verify key is now masked (non-null)
    { assert: 'state.byoKeys.openai !== null', message: 'openai key should be non-null after save' },
    { assert: 'typeof state.byoKeys.openai === "string"', message: 'openai key should be a masked string' },

    // Delete the key
    { action: 'deleteBYOKey', args: ['openai'], timeout: 15000, wait: 500 },

    // Verify key is null again
    { assert: 'state.byoKeys.openai === null', message: 'openai key should be null after delete' },
  ],
});
