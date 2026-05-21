import { defineWorkflow } from 'simi';

export const byoKeyMultiProviderFlow = defineWorkflow({
  id: 'byo_key_multi_provider_flow',
  app: 'smartchats_billing',
  tags: ['e2e', 'billing', 'byo'],
  steps: [
    // Fetch initial balance
    { action: 'fetchBalance', args: [], timeout: 15000, wait: 500 },

    // Save keys for two providers at once
    { action: 'saveBYOKeys', args: [{ anthropic: 'TEST_ANTHROPIC_KEY_PLACEHOLDER', google: 'TEST_GOOGLE_KEY_PLACEHOLDER' }], timeout: 15000, wait: 500 },

    // Assert both keys are now set
    { assert: 'state.byoKeys.anthropic !== null', message: 'anthropic key should be non-null after save' },
    { assert: 'state.byoKeys.google !== null', message: 'google key should be non-null after save' },

    // Delete anthropic key only
    { action: 'deleteBYOKey', args: ['anthropic'], timeout: 15000, wait: 500 },

    // Assert anthropic is null, google still active
    { assert: 'state.byoKeys.anthropic === null', message: 'anthropic key should be null after delete' },
    { assert: 'state.byoKeys.google !== null', message: 'google key should still be active' },

    // Clean up: delete google key
    { action: 'deleteBYOKey', args: ['google'], timeout: 15000, wait: 500 },
    { assert: 'state.byoKeys.google === null', message: 'google key should be null after cleanup' },
  ],
});
