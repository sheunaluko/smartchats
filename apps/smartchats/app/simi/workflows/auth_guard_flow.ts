import { defineWorkflow } from 'simi';

export const authGuardFlow = defineWorkflow({
  id: 'auth_guard_flow',
  app: 'smartchats',
  tags: ['smoke', 'auth'],
  steps: [
    // Wait for store + agent initialization
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },

    // Switch to cloud storage — triggers checkAuth internally
    { action: 'switchStorageMode', args: ['cloud'], timeout: 15000, wait: 1000 },

    // Auth check should have run — isAuthenticated reflects the result
    { assert: 'typeof state.isAuthenticated === "boolean"', message: 'isAuthenticated should be a boolean after cloud mode attempt' },

    // Switch back to local to clean up
    { action: 'switchStorageMode', args: ['local'], timeout: 15000, wait: 1000 },

    // Verify we are back in local mode (settings reload should succeed)
    { assert: 'state.aiModel !== ""', message: 'Settings should still be loaded after switching back to local' },
  ],
});
