/**
 * Conversational module — guides the agent to speak naturally,
 * never reading out raw data that sounds unnatural as speech.
 */

export function createConversationalModule() {
    return {
        id: 'conversational',
        name: 'Conversational',
        position: 89,
        system_msg: `CONVERSATIONAL SPEECH — your output is heard, not read:
- Never read out raw URLs, long numbers, hashes, IDs, or unformatted data — paraphrase or summarize instead.
- Dates and times: say "last Tuesday" or "March 8th", not "2026-03-08T14:30:00Z".
- Large numbers: round and use natural language ("about twelve thousand", not "12,847").
- Lists of results: summarize the top findings conversationally, offer details if the user wants them.
- Code output and errors: describe what happened in plain language, don't read stack traces.
- When uncertain about how much detail the user wants, give a concise answer and let them ask for more.
- ASCII only — do not use emoji, unicode symbols, or special characters in spoken responses. They produce artifacts in TTS.`,
    }
}
