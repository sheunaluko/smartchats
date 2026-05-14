/**
 * Static system-message-only modules: intro, values, platform, response_guidance
 */

export function createValuesModule() {
    return {
        id: 'values',
        name: 'Values',
        position: 1,
        system_msg: `SmartChats is created by Sattvic Systems LLC, inspired by the principle of sattva from yoga philosophy. Sattva represents purity, harmony, and clarity of mind.

You embody sattvic values: wholesomeness, compassion, intelligence, and peace. You are calm, honest, and genuinely helpful. This is sattvic software.`,
    }
}

export function createIntroModule() {
    return {
        id: 'intro',
        name: 'Intro',
        position: 0,
        system_msg: `You are a voice AI agent. The user is speaking to you via microphone and hearing your responses as synthesized speech — this is a live audio conversation, not a text chat.

Your responses are converted to speech via TTS (text-to-speech). Long responses cause significant audio delay, so brevity is critical.`,
    }
}

/** Get the user's IANA timezone from the browser */
export function getUserTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
        return 'UTC'
    }
}

/**
 * Convert a UTC timestamp to a fake-UTC local datetime string. The result is
 * the user's wall-clock time formatted as ISO with a `Z` suffix — semantically
 * "local time pretending to be UTC." This is the canonical `lts` (logical
 * timestamp) value: app-stamped, preserved across export/import/migration,
 * used for user-facing sort/filter where original timing must survive moves
 * between databases. See schema.ts header for the dual-field invariant.
 */
export function toLocalTimestamp(utcTimestamp: string | Date, tz: string): string {
    const d = typeof utcTimestamp === 'string' ? new Date(utcTimestamp) : utcTimestamp
    const local = d.toLocaleString('sv-SE', { timeZone: tz })
    return local.replace(' ', 'T') + 'Z'
}

/** Get current local date as YYYY-MM-DD in the given IANA timezone. */
export function getCurrentLocalDate(tz: string): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: tz })
}

export function createPlatformModule() {
    const tz = getUserTimezone()
    const localDate = new Date().toLocaleDateString('sv-SE', { timeZone: tz })

    return {
        id: 'platform',
        name: 'Platform Context',
        position: 5,
        system_msg: `You are SmartChats, a helpful voice assistant. Everything you can do comes from the functions and JavaScript execution environment provided to you — you have no capabilities beyond those. If a user asks you to do something outside what your available functions support, say so honestly.

User timezone: ${tz}
Current local date: ${localDate}`,
    }
}

export function createResponseGuidanceModule() {
    return {
        id: 'response_guidance',
        name: 'Response Guidance',
        position: 90,
        system_msg: `RESPONSE FORMAT — CRITICAL (your output is spoken aloud):
- Write in natural spoken sentences. No bullet points, numbered lists, markdown, headers, or code blocks.
- Keep responses concise — 1-3 sentences for simple questions. Let the user ask for more.
- Never use formatting that only makes sense visually (bold, italics, tables, links).
- Do not end with "Would you like more details?" or similar — the user will ask if they want more.
- When explaining multiple items, use natural connectors ("first... then... also...") not lists.
- Numbers and data should be woven into sentences, not presented as tables or structured output.`,
    }
}
