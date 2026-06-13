/**
 * Benchpress scenario workflows — one per scenario, model-agnostic.
 *
 * The Playwright matrix runner (packages/benchpress/scripts/run_bench.ts)
 * sets the model via updateSettings + saveSettings BEFORE invoking each
 * workflow, so the workflow itself never pins one. Run the workflows
 * sequentially (one per (scenario, model) pair) and the seeded DB gets
 * a fresh reload between runs that touch user_data (q08 mutation).
 *
 * Requires `window.__BENCHPRESS_MODE = true` at boot — see
 * `apps/smartchats/app/cortex_agent_web.ts`.
 */
import { defineWorkflow } from 'simi';
import { ALL_SCENARIOS, type BenchScenarioV1 } from 'benchpress';

function makeBenchWorkflow(scenario: BenchScenarioV1) {
  const prompts = Array.isArray(scenario.prompt) ? scenario.prompt : [scenario.prompt];

  const steps: any[] = [
    // Store + agent ready, model already set by the driver.
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10_000 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15_000 },

    // Fresh transcript + bench_answer cleared (so the waitFor below can't
    // trip on a prior scenario's submission left in workspace).
    { action: 'clearChat', args: [], wait: 300 },
    { action: 'updateWorkspace', args: [{ bench_answer: null }], wait: 200 },
  ];

  // Sequential user turns.
  prompts.forEach((prompt) => {
    steps.push({
      action: 'sendMessageAsync',
      args: [prompt],
      timeout: 120_000,
      wait: 300,
    });
  });

  // Final completion signal — the agent's typed answer. 180s budget; some
  // multi-step scenarios (KG navigation, hard composite) need more LLM time.
  // If the agent times out here, that's a real benchmark outcome (no
  // answer submitted within the budget), scored in Part 2.
  steps.push({ waitFor: 'state.workspace.bench_answer != null', timeout: 180_000 });

  // Soft structural sanity — value-correctness is scored post-hoc against
  // the exported session bundle. This catches obvious shape violations
  // (no kind, no value) without coupling the workflow to per-scenario truths.
  steps.push({
    assert: 'state.workspace.bench_answer.kind != null',
    message: `${scenario.id}: bench_answer.kind is required`,
  });

  return defineWorkflow({
    id: `bench_${scenario.id}`,
    app: 'smartchats',
    tags: ['benchpress', scenario.category, scenario.kind],
    // No setupWorkflows — complete_onboarding overwrites aiModel which
    // breaks the matrix-runner pattern (model set once per outer loop).
    // The runner runs complete_onboarding manually at session start.
    steps,
  });
}

export const BENCH_WORKFLOWS: Record<string, ReturnType<typeof makeBenchWorkflow>> = Object.fromEntries(
  ALL_SCENARIOS.map((s) => [`bench_${s.id}`, makeBenchWorkflow(s)]),
);
