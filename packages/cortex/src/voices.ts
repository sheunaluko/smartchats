/**
 * Voice catalog — single source of truth for every TTS voice the app
 * knows about, keyed by provider.
 *
 * Consumed by (in order of discovery through the codebase):
 *
 *  1. Adapter `listVoices()` (llm-service/tts_providers/{openai,azure}.ts)
 *     — server-side, returns voice ids from this catalog.
 *  2. UI VoiceSelector (tivi + apps/smartchats SettingsPanel) — reads
 *     full VoiceInfo for the current provider to render labels + tooltips.
 *  3. Agent `set_voice` tool (apps/smartchats/app/modules/appearance.ts)
 *     — reads full catalog for current provider, auto-generates the
 *     "available voices" system-prompt line so the agent's option set
 *     updates when a new voice ships without touching the module.
 *  4. Tivi ack-cache preloader (tivi/lib/tts_acknowledgements.ts) —
 *     filters catalog by `hasAckCache: true` for the currently-active
 *     provider so only voices with pre-generated MP3s get preloaded.
 *  5. Preset validator (cortex/src/presets.ts) — asserts every preset's
 *     (ttsProvider, ttsVoice) pair exists in this catalog at module
 *     load; typos become build-time crashes instead of runtime
 *     Azure-adapter-throws-invalid-voice errors.
 *
 * Adding a voice = one entry here. Everything else picks it up.
 *
 * Location choice: cortex (not llm-service) because tivi consumes this
 * too, and tivi is a client-side package that can't depend on
 * llm-service (which pulls the OpenAI + Azure SDKs). Cortex is the
 * client-safe common denominator both llm-service and tivi already
 * depend on.
 */

import type { TTSProvider } from './presets.js';

export interface VoiceInfo {
    /** Provider-specific voice id — the exact string the adapter's
     *  stream() call accepts. */
    id: string;
    /** Human-friendly label shown in UI. */
    displayName: string;
    /** Short one-line character description. Used in UI tooltip and
     *  in the agent's system-prompt "available voices" line. */
    description: string;
    /** Which adapter serves this voice. Voice ids are provider-scoped
     *  in principle but happen to be globally unique in practice
     *  (nothing enforces this — `findVoice(id)` returns the first
     *  hit). */
    provider: TTSProvider;
    /** Free-form tags for filtering / grouping — 'female', 'multilingual',
     *  'warm', 'expressive', etc. Used by UI for grouped display and
     *  can be surfaced to the agent for "find me a warm voice" queries. */
    tags?: string[];
    /** True if tivi preloads acknowledgement MP3s for this voice on
     *  boot (from `apps/smartchats/public/audio/acks/{id}/`). A voice
     *  without an ack cache still works — the first "sure/hmm/ok"
     *  turn just goes through the full TTS pipeline instead of playing
     *  a cached buffer. */
    hasAckCache?: boolean;
}

/**
 * Voice catalog. Add voices here; every consumer picks them up.
 *
 * The current openai + azure lists match the pre-existing hardcoded
 * lists in {llm-service/tts_providers,tivi/lib/tts_acknowledgements,
 * apps/smartchats/app/modules/appearance}.ts as of 2026-07-02.
 * Descriptions were consolidated from appearance.ts (which had the
 * openai character descriptions but no other-provider entries).
 *
 * `hasAckCache` reflects the MP3s that actually exist under
 * apps/smartchats/public/audio/acks/. Only 6 of the 13 openai voices
 * have caches; the remaining 7 openai voices work but the ack path
 * fires the full TTS pipeline. Azure voices don't have ack caches
 * yet — set to `false` for now.
 */
// Object.keys order determines display order in the client (VoiceSelector
// + PresetMenu iterate via Object.keys). Azure is listed first so users
// see the productionized default provider (Azure Ava = 'quality' + 'snappy')
// at the top of the Voice column; OpenAI is the legacy fallback below.
export const VOICE_CATALOG: Record<TTSProvider, VoiceInfo[]> = {
    azure: [
        { id: 'en-US-AvaMultilingualNeural',    displayName: 'Ava',    description: 'Warm, multilingual — voicebench favorite',       provider: 'azure', tags: ['female', 'multilingual', 'warm'],       hasAckCache: false },
        { id: 'en-US-AndrewMultilingualNeural', displayName: 'Andrew', description: 'Confident, multilingual',                        provider: 'azure', tags: ['male', 'multilingual', 'confident'],    hasAckCache: false },
        { id: 'en-US-EmmaMultilingualNeural',   displayName: 'Emma',   description: 'Friendly, multilingual',                         provider: 'azure', tags: ['female', 'multilingual', 'friendly'],   hasAckCache: false },
        { id: 'en-US-BrianMultilingualNeural',  displayName: 'Brian',  description: 'Natural, multilingual',                          provider: 'azure', tags: ['male', 'multilingual', 'natural'],      hasAckCache: false },
        { id: 'en-US-JennyNeural',              displayName: 'Jenny',  description: 'Professional, neutral',                          provider: 'azure', tags: ['female', 'professional'],              hasAckCache: false },
        { id: 'en-US-GuyNeural',                displayName: 'Guy',    description: 'Friendly, neutral',                              provider: 'azure', tags: ['male', 'friendly'],                    hasAckCache: false },
        { id: 'en-US-AriaNeural',               displayName: 'Aria',   description: 'Warm, articulate',                               provider: 'azure', tags: ['female', 'warm', 'articulate'],        hasAckCache: false },
        { id: 'en-US-DavisNeural',              displayName: 'Davis',  description: 'Grounded, steady',                               provider: 'azure', tags: ['male', 'steady'],                      hasAckCache: false },
    ],
    openai: [
        { id: 'alloy',   displayName: 'Alloy',   description: 'Neutral, balanced',        provider: 'openai', tags: ['neutral'],                     hasAckCache: true },
        { id: 'ash',     displayName: 'Ash',     description: 'Calm, measured',           provider: 'openai', tags: ['calm'],                        hasAckCache: false },
        { id: 'ballad',  displayName: 'Ballad',  description: 'Smooth, melodic',          provider: 'openai', tags: ['smooth'],                      hasAckCache: false },
        { id: 'coral',   displayName: 'Coral',   description: 'Warm, engaging',           provider: 'openai', tags: ['warm'],                        hasAckCache: false },
        { id: 'echo',    displayName: 'Echo',    description: 'Warm, conversational',     provider: 'openai', tags: ['warm', 'conversational'],      hasAckCache: true },
        { id: 'fable',   displayName: 'Fable',   description: 'Expressive, storytelling', provider: 'openai', tags: ['expressive'],                  hasAckCache: true },
        { id: 'nova',    displayName: 'Nova',    description: 'Friendly, natural',        provider: 'openai', tags: ['friendly'],                    hasAckCache: true },
        { id: 'onyx',    displayName: 'Onyx',    description: 'Deep, authoritative',      provider: 'openai', tags: ['deep'],                        hasAckCache: true },
        { id: 'sage',    displayName: 'Sage',    description: 'Wise, steady',             provider: 'openai', tags: ['steady'],                      hasAckCache: false },
        { id: 'shimmer', displayName: 'Shimmer', description: 'Clear, bright',            provider: 'openai', tags: ['bright'],                      hasAckCache: true },
        { id: 'verse',   displayName: 'Verse',   description: 'Poetic, expressive',       provider: 'openai', tags: ['expressive'],                  hasAckCache: false },
        { id: 'marin',   displayName: 'Marin',   description: 'Bright, cheerful',         provider: 'openai', tags: ['bright', 'cheerful'],          hasAckCache: false },
        { id: 'cedar',   displayName: 'Cedar',   description: 'Grounded, natural',        provider: 'openai', tags: ['natural'],                     hasAckCache: false },
    ],
};

/** All VoiceInfo entries for the given provider. Empty array if the
 *  provider isn't in the catalog (shouldn't happen for the productionized
 *  set — TTSProvider union constrains callers). */
export function listVoicesForProvider(provider: TTSProvider): VoiceInfo[] {
    return VOICE_CATALOG[provider] ?? [];
}

/** Just the voice ids for a provider, in catalog order. Suitable as
 *  the return of `ServerTtsAdapter.listVoices()`. */
export function listVoiceIdsForProvider(provider: TTSProvider): string[] {
    return listVoicesForProvider(provider).map((v) => v.id);
}

/** First matching entry by id across every provider. Returns null when
 *  the id isn't registered — useful for validating agent tool input or
 *  preset entries. */
export function findVoice(voiceId: string): VoiceInfo | null {
    for (const provider of Object.keys(VOICE_CATALOG) as TTSProvider[]) {
        const v = VOICE_CATALOG[provider].find((x) => x.id === voiceId);
        if (v) return v;
    }
    return null;
}

/** All voice ids across every provider. Rare; useful when the caller
 *  is trying to look up a voice without knowing its provider. */
export function listAllVoices(): VoiceInfo[] {
    return (Object.keys(VOICE_CATALOG) as TTSProvider[])
        .flatMap((p) => VOICE_CATALOG[p]);
}
