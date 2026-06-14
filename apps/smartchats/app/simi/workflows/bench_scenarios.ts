/**
 * Benchpress scenario workflows — one per scenario, model-agnostic.
 *
 * The Playwright matrix runner (packages/benchpress/scripts/run_bench.ts)
 * sets the model via updateSettings + saveSettings BEFORE invoking each
 * workflow, so the workflow itself never pins one.
 *
 * Inline-directive design (2026-06-14):
 *   The factory appends a per-scenario directive to the LAST user turn
 *   telling the agent to set `workspace.bench_answer = { value, kind, ... }`.
 *   This replaces the env-gated benchpress module that used to add a
 *   `submit_answer` tool — SCM now matches production verbatim, so the
 *   benchmark measures agents using only production primitives. The agent
 *   writes to `workspace` from its sandboxed code (it's already a sandbox
 *   global per `packages/cortex/src/cortex.ts:1093-1156`).
 */
import { defineWorkflow } from 'simi';
import { ALL_SCENARIOS, type BenchScenarioV1 } from 'benchpress';

type Kind = NonNullable<BenchScenarioV1['kind']>;

/**
 * Per-scenario directive appended to the LAST user turn. Tells the agent
 * exactly what shape to write into workspace.bench_answer. Scorer is lenient
 * — accepts bare primitives OR wrapped {value, kind} — but giving the agent
 * a concrete template improves compliance.
 */
function directive(scenario: BenchScenarioV1): string {
  const shapes: Record<Kind, string> = {
    scalar:     `{ value: <your_answer>, kind: 'scalar', unit: '<unit_if_applicable>' }`,
    date:       `{ value: '<YYYY-MM-DD>', kind: 'date' }`,
    list:       `{ value: [<items>], kind: 'list' }`,
    comparison: `{ value: { ...all_values_compared, winner: '<label>' }, kind: 'comparison' }`,
    negative:   `{ value: null, kind: 'negative', reason: '<why_no_data>' }`,
    composite:  `{ value: { ...your_structured_answer }, kind: 'composite' }`,
  };
  return ` After computing the answer, set workspace.bench_answer = ${shapes[scenario.kind]}. Then briefly reply.`;
}

function makeBenchWorkflow(scenario: BenchScenarioV1) {
  const rawPrompts = Array.isArray(scenario.prompt) ? scenario.prompt : [scenario.prompt];
  // Directive on the LAST turn only — earlier turns may be mutations or
  // setup that shouldn't trigger a bench_answer write yet.
  const prompts = rawPrompts.map((p, i) =>
    i === rawPrompts.length - 1 ? `${p}${directive(scenario)}` : p,
  );

  // Per-turn budget covers the whole agent loop for one sendMessageAsync:
  // every LLM call + tool execution + response emission. Default 30s; raised
  // on specific scenarios via scenario.maxTurnMs.
  const maxTurnMs = scenario.maxTurnMs ?? 30_000;

  const steps: any[] = [
    // Store + agent ready, model already set by the driver.
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10_000 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15_000 },

    // Fresh transcript + bench_answer cleared (so the waitFor below can't
    // trip on a prior scenario's submission left in workspace).
    { action: 'clearChat', args: [], wait: 300 },
    { action: 'updateWorkspace', args: [{ bench_answer: null }], wait: 200 },
  ];

  // Sequential user turns. Directive baked into the LAST prompt.
  prompts.forEach((prompt) => {
    steps.push({
      action: 'sendMessageAsync',
      args: [prompt],
      timeout: maxTurnMs,
      wait: 300,
    });
  });

  // bench_answer should be set during the last turn (agent's sandboxed code
  // writes `workspace.bench_answer = {...}`, cortex syncs it back via the
  // workspace_update event, store reflects it). 10s buffer for propagation.
  steps.push({ waitFor: 'state.workspace.bench_answer != null', timeout: 10_000 });
  // No structural assert — lenient scorer accepts bare values or {value, kind}.

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
