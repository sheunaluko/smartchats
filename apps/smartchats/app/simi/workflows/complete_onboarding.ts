import { defineWorkflow } from 'simi';

/**
 * Setup workflow — establishes a clean test baseline for any workflow that
 * talks to the agent. Referenced via `setupWorkflows: ['complete_onboarding']`.
 *
 * Two things it guarantees:
 *   1. Onboarding is marked `skipped` so the agent doesn't fire the explainer
 *      on first turn.
 *   2. The active model is pinned to `gpt-5.2` so tests don't inherit a model
 *      from a previous run (Playwright's persistent profile keeps localStorage
 *      across tests — otherwise a prior `model_switch_flow` run can leave
 *      Opus/Gemini active, yielding provider-specific response quirks).
 *
 * Idempotent: onboarding action short-circuits when already skipped; model
 * update is a no-op when already gpt-5.2.
 */
export const completeOnboardingFlow = defineWorkflow({
  id: 'complete_onboarding',
  app: 'smartchats',
  tags: ['setup'],
  steps: [
    // Agent must be mounted before `markOnboardingSkipped` can persist its KG triple.
    { waitFor: 'state.agent !== null', timeout: 10000 },
    // 30s timeout (not 10s): cold-DB cloud-mode markOnboardingSkipped can take
    // ~25s — embeds 3 entity names via OpenAI (~2s each) then writes them.
    // Warm DBs (live cloud, dev AIO with prior runs) short-circuit on cache and
    // finish in <1s. The longer ceiling protects fresh-DB runs without slowing
    // anything down on warm ones.
    { action: 'completeOnboardingForTests', args: [], timeout: 30000 },
    { waitFor: 'state.onboardingTestComplete === true', timeout: 5000 },
    // Reset to baseline model so tests don't inherit prior-run state.
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 200 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 200 },
    { waitFor: 'state.aiModel === "gpt-5.2" && !state.llmRunning', timeout: 10000 },
  ],
});
