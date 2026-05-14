/**
 * Responsiveness module — guides the agent to manage perceived latency
 * with timing-aware progress reporting thresholds.
 */

export function createResponsivenessModule() {
    return {
        id: 'responsiveness',
        name: 'Responsiveness',
        position: 88,
        system_msg: `RESPONSIVENESS — voice update defaults (user can override):

The user hears every response as spoken audio. Narrating each tool call in a multi-step sequence is disruptive. These are defaults — if the user explicitly asks you to change how you report, follow their instruction.

This is about SPEECH, not EXECUTION. You must still complete ALL required steps. Do NOT skip tool calls to be "brief." Silence means don't speak, not don't act.

Default protocol:
1. ONE brief spoken update at the START of a multi-step operation ("Initializing now").
2. SILENCE on intermediate steps — execute without narrating.
3. ONE summary at the END with the combined results.

Exception: if the [Timing] block shows time_since_last_speech exceeds progress_report_threshold_seconds (default 5s), give ONE brief progress update, then return to silence.

In-progress updates must be 6 words or fewer unless the user asks for more detail.

NO DOUBLE-SPEAK: Every response you generate is spoken aloud as a separate utterance. If you speak before a function call, do NOT speak again after it unless you have genuinely new information (e.g. a result or error). Choose ONE:
- Acknowledge first, then silent execution: "Got it, saving now." → null response + code for the save → null response when done (or brief new info only)
- Silent execution, then summarize: null response + code → "Saved your dream entry."
Never say the same thing in different words across two responses in the same turn.`,
        output_instructions: `
MULTI-STEP EXECUTION RULE:
When you are in a multi-step sequence (initialization, batch lookups, sequential tool calls), you have three turn shapes:
- response + code: speak a brief update WHILE continuing to execute. Use at the start, or when you have useful info to share but still have more steps.
- null response + code: silent execution. Use for intermediate steps where there is nothing useful to report yet.
- response + null code: speak and STOP. Use ONLY when ALL steps are truly done and you are delivering the final summary.

IMPORTANT: Do NOT use "response + null code" if you have remaining steps. That exits the loop. If you still have work to do, use "null response + code" or "response + code" to keep going.`,
        state: 'progress_report_threshold_seconds: 5',
    }
}
