/**
 * Agent presets — named bundles of (LLM model, TTS provider, TTS voice).
 *
 * The atomic unit users + the agent itself switch between. Stored as a
 * single id in tivi settings (e.g. 'snappy'); the store's `applyPreset`
 * action unpacks the id into aiModel + ttsProvider + ttsVoice fields
 * in one atomic write.
 *
 * To add a preset: append to AGENT_PRESETS below. To change the system
 * default: edit DEFAULT_PRESET_ID. To deprecate a preset: leave it in
 * the list (users' saved choices still resolve) but flag in description.
 *
 * Cross-package import target: this module is referenced by
 *   - packages/smartchats-local-server (server-side route resolution)
 *   - apps/smartchats (store + TopBar selector + agent tools)
 * so it lives in cortex (which both depend on) rather than tivi (which
 * apps/smartchats depends on but the server doesn't).
 */

/**
 * TTS provider id — must match a built adapter in llm-service's tts_providers
 * registry. Narrowed to the productionized set; xai_ws / gemini_live live
 * in voicebench only and aren't selectable from agent presets. Expand this
 * union (and the registry's TtsProviderId in llm-service/tts_providers/index.ts)
 * together when promoting a new adapter.
 */
export type TTSProvider = 'openai' | 'azure';

export interface AgentPreset {
    /** Stable id used everywhere (persisted, agent tool args, etc). */
    id: string;
    /** Short user-facing label. Shown in the TopBar dropdown. */
    name: string;
    /** One-line pitch — what's this preset for. */
    description: string;
    /** LLM model id (key in MODEL_REGISTRY). */
    aiModel: string;
    /** TTS provider id (must match a registered ServerTtsAdapter). */
    ttsProvider: TTSProvider;
    /** Provider-specific voice identifier. */
    ttsVoice: string;
    /** Free-form tags for filtering / agent self-selection. */
    recommendedFor: string[];
}

/**
 * Starting set as of 2026-06-27. Picked based on benchpress (LLM) + voicebench
 * (TTS) results — see apps/site/content/blog/voice-stutter-tts-benchmark.md
 * + the llmbench results in packages/llmbench/results/.
 */
export const AGENT_PRESETS: AgentPreset[] = [
    {
        id: 'snappy',
        name: 'Snappy',
        description: 'Lowest perceived latency. Grok 4.20 non-reasoning + Azure Ava. Best for real-time voice.',
        aiModel: 'grok-4.20-0309-non-reasoning',
        ttsProvider: 'azure',
        ttsVoice: 'en-US-AvaMultilingualNeural',
        recommendedFor: ['voice-first', 'real-time', 'low-latency'],
    },
    {
        id: 'quality',
        name: 'Quality',
        description: 'Best accuracy on complex tasks. Grok 4.3 + Azure Ava. ~2.5s TTFB.',
        aiModel: 'grok-4.3',
        ttsProvider: 'azure',
        ttsVoice: 'en-US-AvaMultilingualNeural',
        recommendedFor: ['complex-reasoning', 'high-stakes', 'accuracy'],
    },
    {
        id: 'frugal',
        name: 'Frugal',
        description: 'Cheap + fast. Gemini Flash Lite + Azure Ava. For high-volume / easy queries.',
        aiModel: 'gemini-3.1-flash-lite',
        ttsProvider: 'azure',
        ttsVoice: 'en-US-AvaMultilingualNeural',
        recommendedFor: ['high-volume', 'cost-sensitive', 'simple-queries'],
    },
    {
        id: 'legacy_openai',
        name: 'Legacy (OpenAI)',
        description: 'GPT-5.5 + OpenAI marin voice. Pre-Azure default — keep available for A/B.',
        aiModel: 'gpt-5.5',
        ttsProvider: 'openai',
        ttsVoice: 'marin',
        recommendedFor: ['legacy', 'a-b-comparison'],
    },
];

/** System default — applied to new installs + any settings load that
 *  encounters an unknown / missing preset id. */
export const DEFAULT_PRESET_ID = 'snappy';

const _byId: Record<string, AgentPreset> = Object.fromEntries(
    AGENT_PRESETS.map((p) => [p.id, p]),
);

export function getPreset(id: string): AgentPreset | undefined {
    return _byId[id];
}

export function getPresetOrDefault(id: string | undefined | null): AgentPreset {
    if (id && _byId[id]) return _byId[id];
    return _byId[DEFAULT_PRESET_ID]!;
}

/**
 * Reverse-lookup: given the current (model, provider, voice) triple, find the
 * preset whose values match (if any). Used so the UI can show "currently:
 * Snappy" even when the user lands on the values via individual settings
 * tweaks. Returns null if the triple doesn't match any preset (= "custom").
 */
export function findMatchingPreset(
    aiModel: string,
    ttsProvider: string,
    ttsVoice: string,
): AgentPreset | null {
    for (const p of AGENT_PRESETS) {
        if (p.aiModel === aiModel && p.ttsProvider === ttsProvider && p.ttsVoice === ttsVoice) {
            return p;
        }
    }
    return null;
}
