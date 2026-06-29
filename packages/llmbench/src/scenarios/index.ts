/**
 * LLM benchmark scenarios. Two for v1, both voice-agent-shaped:
 *
 *   snappy_qa  — single-sentence answer. Tiny output, latency-dominated.
 *                The TTFB metric here directly maps to "how long until
 *                the user hears the agent start replying."
 *
 *   conversation — 2-paragraph reasoning. Mid-length output, exercises
 *                both TTFB and steady-state token streaming. The typical
 *                shape of a voice-agent response.
 *
 * Keep the input texts FIXED across providers — that's the whole point
 * of "apples-to-apples." Prompt-cache effects are handled by the runner's
 * cold/warm split, not by varying the prompt.
 */

export interface Scenario {
    id: string;
    description: string;
    systemPrompt: string;
    userPrompt: string;
    /** Approximate target output length for cost estimation. */
    targetOutputTokens: number;
}

export const SCENARIOS: Record<string, Scenario> = {
    snappy_qa: {
        id: 'snappy_qa',
        description: 'One-sentence factual answer. Pure TTFB measurement.',
        systemPrompt:
            'You are a concise assistant. Answer in exactly one sentence. Do not add caveats or extra context.',
        userPrompt: 'What is the capital of France?',
        // 300 token target gives reasoning models (GPT-5, Grok-4) breathing
        // room for internal chain-of-thought before emitting visible text.
        // At a 5x cap multiplier, the budget is 1500 tokens — still small
        // total cost, but enough to never hit max_output_tokens.
        targetOutputTokens: 300,
    },
    conversation: {
        id: 'conversation',
        description: 'Two-paragraph explanation. Typical voice-agent response shape.',
        systemPrompt:
            'You are a clear, friendly explainer. Use plain language and keep responses to two short paragraphs.',
        userPrompt:
            'Explain how WebSocket streaming differs from HTTP chunked transfer encoding, and when you would choose one over the other.',
        targetOutputTokens: 600,
    },
};

export function listScenarios(): string[] {
    return Object.keys(SCENARIOS);
}
