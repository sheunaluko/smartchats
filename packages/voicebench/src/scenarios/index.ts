/**
 * Benchmark scenarios. Each scenario is a fixed text input that all
 * providers run against, so latency numbers are directly comparable.
 *
 * Goal: cover the realistic range of utterances a voice agent produces.
 * Short = templated-greeting-sized, Medium = typical LLM response,
 * Long = explanation-sized. Keep texts simple and TTS-neutral (no
 * provider-specific style tags) for the baseline scenarios — style is
 * a separate axis covered by with_style.
 */

export interface Scenario {
    id: string;
    /** One-line description shown in the report header. */
    description: string;
    text: string;
    /** Approximate word count — for ratio-of-realtime calculations. */
    approxWords: number;
}

export const SCENARIOS: Record<string, Scenario> = {
    short: {
        id: 'short',
        description: 'Greeting-sized utterance (~5 words). Templated-path equivalent.',
        text: 'Hello, this is a test.',
        approxWords: 5,
    },
    medium: {
        id: 'medium',
        description: 'Typical LLM response (~30 words).',
        text: "Sure, I can help with that. Based on what you've told me, the best approach is to break the problem into three smaller pieces. Let's start with the first one.",
        approxWords: 30,
    },
    long: {
        id: 'long',
        description: 'Explanation-sized utterance (~150 words).',
        text: [
            "Let me walk through this carefully so the reasoning is clear.",
            "First, consider the user's actual goal — not what they literally asked for,",
            "but the underlying outcome they're trying to achieve. Often these diverge,",
            "and addressing the surface request without checking the deeper one leads",
            "to thrash. Second, identify the constraints that are real versus the",
            "ones that are inherited assumptions. People often carry forward limits",
            "from older systems that no longer apply, and those constraints quietly",
            "shape every decision downstream. Third, pick the smallest change that",
            "moves toward the goal while leaving room to learn — a step you can",
            "evaluate honestly within a day or two, not one that locks you in for",
            "weeks. If after that step the direction still looks right, take the",
            "next one. If not, you've spent a manageable amount and can adjust.",
        ].join(' '),
        approxWords: 150,
    },
};

export function listScenarios(): string[] {
    return Object.keys(SCENARIOS);
}
