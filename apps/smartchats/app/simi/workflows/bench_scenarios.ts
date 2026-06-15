/**
 * Benchpress scenario workflows — one per scenario, model-agnostic.
 *
 * The Playwright matrix runner (packages/benchpress/scripts/run_bench.ts)
 * sets the model via updateSettings + saveSettings BEFORE invoking each
 * workflow, so the workflow itself never pins one.
 *
 * Two factory paths, branched on scenario.kind:
 *
 *   - Value-answer kinds (scalar/date/list/comparison/negative/composite):
 *     send the prompt with an inline directive that tells the agent to set
 *     workspace.bench_answer = {...}. Workflow awaits state.workspace
 *     .bench_answer. SCM is identical to prod.
 *
 *   - tool_sequence: tests whether the agent infers a multi-step plan from
 *     a minimal user prompt (e.g. "I want to record a dream" → accumulate_text
 *     → save_log). No directive. Workflow uses sendChatMessage (fire-and-
 *     forget through transcriptionCb) so the workflow can stay sequential
 *     while the agent runs in the background. When cor.is_running_function
 *     flips true, the workflow dispatches scripted text chunks via the same
 *     sendChatMessage path — transcriptionCb auto-routes them to
 *     handle_function_input. After the chunks are fed, the workflow waits
 *     for the agent's full turn to complete.
 */
import { defineWorkflow } from 'simi';
import { ALL_SCENARIOS, type BenchScenarioV1 } from 'benchpress';

type Kind = NonNullable<BenchScenarioV1['kind']>;

/**
 * Per-scenario directive appended to the LAST user turn for value-answer
 * kinds. Scorer is lenient — accepts bare primitives OR wrapped {value, kind}
 * — but giving the agent a concrete template improves compliance.
 */
function directive(scenario: BenchScenarioV1): string {
  const shapes: Partial<Record<Kind, string>> = {
    scalar:     `{ value: <your_answer>, kind: 'scalar', unit: '<unit_if_applicable>' }`,
    date:       `{ value: '<YYYY-MM-DD>', kind: 'date' }`,
    list:       `{ value: [<items>], kind: 'list' }`,
    comparison: `{ value: { ...all_values_compared, winner: '<label>' }, kind: 'comparison' }`,
    negative:   `{ value: null, kind: 'negative', reason: '<why_no_data>' }`,
    composite:  `{ value: { ...your_structured_answer }, kind: 'composite' }`,
  };
  const shape = shapes[scenario.kind];
  if (!shape) return '';  // tool_sequence and unknown kinds get no directive
  return ` After computing the answer, set workspace.bench_answer = ${shape}. Then briefly reply.`;
}

/**
 * Value-answer workflow path — used for every kind EXCEPT tool_sequence.
 */
function makeValueAnswerWorkflow(scenario: BenchScenarioV1) {
  const rawPrompts = Array.isArray(scenario.prompt) ? scenario.prompt : [scenario.prompt];
  const prompts = rawPrompts.map((p, i) =>
    i === rawPrompts.length - 1 ? `${p}${directive(scenario)}` : p,
  );
  const maxTurnMs = scenario.maxTurnMs ?? 30_000;

  const steps: any[] = [
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10_000 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15_000 },
    { action: 'clearChat', args: [], wait: 300 },
    { action: 'updateWorkspace', args: [{ bench_answer: null }], wait: 200 },
  ];

  prompts.forEach((prompt) => {
    steps.push({
      action: 'sendMessageAsync',
      args: [prompt],
      timeout: maxTurnMs,
      wait: 300,
    });
  });

  steps.push({ waitFor: 'state.workspace.bench_answer != null', timeout: 10_000 });

  return defineWorkflow({
    id: `bench_${scenario.id}`,
    app: 'smartchats',
    tags: ['benchpress', scenario.category, scenario.kind],
    steps,
  });
}

/**
 * tool_sequence workflow path — for action-plan inference scenarios. Uses
 * sendChatMessage (non-blocking) so the workflow can sequentially feed
 * scripted text chunks once the agent enters is_running_function.
 *
 * No directive is appended; the prompt is sent verbatim. The agent must
 * infer the multi-step plan unaided.
 */
function makeToolSequenceWorkflow(scenario: BenchScenarioV1) {
  if (typeof scenario.prompt !== 'string') {
    throw new Error(`tool_sequence scenario ${scenario.id} requires a single-string prompt`);
  }
  const startTimeout = scenario.functionStartTimeoutMs ?? 15_000;
  const completeTimeout = scenario.turnCompleteTimeoutMs ?? 20_000;

  const steps: any[] = [
    // Readiness gates.
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10_000 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15_000 },
    { action: 'clearChat', args: [], wait: 300 },

    // Disable the transcription cooldown for the duration of this scenario.
    // useOrchestrator.transcriptionCb (apps/smartchats/app/hooks/useOrchestrator.ts:404)
    // gates calls behind `state.speechCooldownMs` (default 2000ms) — so a
    // burst of scripted chunks fed via sendChatMessage would silently drop
    // everything after the first. Setting cooldown=0 is workflow-local; the
    // runner reloads the page between scenarios so user settings stay safe.
    { action: 'updateSettings', args: [{ speechCooldownMs: 0 }], wait: 100 },

    // Send initial prompt via the chat-input path. sendChatMessage →
    // transcriptionCb → sendMessageSync (fire-and-forget). The agent's
    // runLlm kicks off in the background; workflow advances immediately.
    { action: 'setChatInput', args: [scenario.prompt] },
    { action: 'sendChatMessage', args: [] },

    // Wait for the agent to enter a blocking function (accumulate_text,
    // save_memo, etc.). If the agent skips straight to a non-blocking
    // tool — like save_log — this likely times out, which is a real
    // benchmark failure ("didn't gather content before saving").
    //
    // The settling `wait: 500` gives accumulate_text time to reach its
    // first `await get_user_data()` after is_running_function flips on
    // (the flag is set before the awaited code actually awaits).
    {
      waitFor: 'state.agent && state.agent.is_running_function === true',
      timeout: startTimeout,
      wait: 500,
    },
  ];

  // Feed the scripted text chunks. While is_running_function is true,
  // sendChatMessage routes through handle_function_input — chunks land in
  // the function-input channel that accumulate_text awaits.
  //
  // We assume the scripted_responses are keyed by the FIRST blocking tool
  // the agent should enter. For dream-record: accumulate_text's chunks.
  // Future scenarios with save_memo etc. would key under that tool name;
  // this loop concatenates all declared chunks in declaration order.
  //
  // The `wait: 400` on sendChatMessage is the inter-chunk delay — bare
  // `{ wait: N }` steps are no-ops in simi's runner (they don't match the
  // action/assert/waitFor branches), so the wait must be a field on a
  // real step. 400 ms gives accumulate_text's loop body (push + feedback
  // + next await) time to settle before the next chunk lands.
  if (scenario.scripted_responses) {
    for (const chunks of Object.values(scenario.scripted_responses)) {
      for (const chunk of chunks) {
        steps.push({ action: 'setChatInput', args: [chunk] });
        steps.push({ action: 'sendChatMessage', args: [], wait: 400 });
      }
    }
  }

  // Wait for the agent's full turn to complete. Covers accumulate_text
  // returning + subsequent tool calls (save_log) + final reply.
  steps.push({
    waitFor: 'state.llmRunning === false',
    timeout: completeTimeout,
  });

  return defineWorkflow({
    id: `bench_${scenario.id}`,
    app: 'smartchats',
    tags: ['benchpress', scenario.category, scenario.kind],
    steps,
  });
}

function makeBenchWorkflow(scenario: BenchScenarioV1) {
  if (scenario.kind === 'tool_sequence') {
    return makeToolSequenceWorkflow(scenario);
  }
  return makeValueAnswerWorkflow(scenario);
}

export const BENCH_WORKFLOWS: Record<string, ReturnType<typeof makeBenchWorkflow>> = Object.fromEntries(
  ALL_SCENARIOS.map((s) => [`bench_${s.id}`, makeBenchWorkflow(s)]),
);
