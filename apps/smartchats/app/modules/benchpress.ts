/**
 * Benchpress module — env-gated, loaded only when `window.__BENCHPRESS_MODE === true`.
 *
 * Adds one tool: `submit_answer`. The agent calls it with a structured
 * payload BEFORE producing its prose response. The payload is written
 * into `state.workspace.bench_answer`, where a simi workflow can `waitFor`
 * it as the "agent done" signal — no prose parsing, no LLM-as-judge.
 *
 * Gating happens in `apps/smartchats/app/cortex_agent_web.ts` — this module
 * is only added to the SCM when the window flag is set, so production
 * boots never see it.
 *
 * See `packages/benchpress/` for the scenarios that drive the agent and
 * the scoring code that reads `bench_answer` from the exported session.
 */
export function createBenchpressModule() {
    return {
        id: 'benchpress',
        name: 'Benchpress Answer Submission',
        position: 11,
        system_msg: `BENCHPRESS MODE
You are running inside an automated benchmark. Every user question expects ONE definitive answer.

When you have computed the answer, call submit_answer({ value, kind, ... }) BEFORE replying with prose. The 'kind' field is required and must be one of:
  - scalar      — single number, string, or boolean
  - date        — a YYYY-MM-DD date string
  - list        — array of items (e.g. book titles)
  - comparison  — object with the values being compared (include all of them)
  - negative    — the data legitimately does not exist; set value to null and use 'reason' to explain
  - composite   — multi-field object when no other kind fits

Examples:
  submit_answer({ value: 147, kind: 'scalar', unit: 'pages' })
  submit_answer({ value: '2026-03-15', kind: 'date' })
  submit_answer({ value: null, kind: 'negative', reason: 'no tennis logs found in date range' })
  submit_answer({ value: ['Dune', 'Sapiens'], kind: 'list' })

If the data genuinely does not exist, submit a negative answer with value=null — never fabricate. If the question is ambiguous, ask the user to clarify before submitting.`,
        functions: [
            {
                enabled: true,
                name: 'submit_answer',
                description: 'Submit the final structured answer to the user\'s question. Must be called once you have computed the answer, before delivering prose to the user. See the BENCHPRESS MODE system message for the allowed kinds.',
                parameters: {
                    value: 'any',
                    kind: 'string',
                    unit: 'string',
                    reason: 'string',
                    source_tool: 'string',
                },
                fn: async (ops: any) => {
                    const { update_workspace, log } = ops.util
                    const { value, kind, unit, reason, source_tool } = ops.params

                    const payload = {
                        value: value ?? null,
                        kind,
                        unit: unit ?? null,
                        reason: reason ?? null,
                        source_tool: source_tool ?? null,
                        submitted_at: Date.now(),
                    }

                    log(`benchpress: submit_answer kind=${kind} value=${JSON.stringify(value)}`)
                    update_workspace({ bench_answer: payload })

                    return 'answer recorded'
                },
                return_type: 'string',
            },
        ],
    }
}
