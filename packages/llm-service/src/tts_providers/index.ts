/**
 * TTS provider registry — single resolution point for combined LLM+TTS
 * handlers (smartchats-local-server `/llm/streamWithTTS` and the cloud
 * `llmTtsStreamHttp` function). Adapters are instantiated lazily on first
 * request so the server doesn't fail to boot when an optional provider
 * key is missing.
 *
 * Default is 'azure' as of 2026-06-27 (the voicebench winner: 0ms chunk-0→1,
 * ~1ms p95 gap). resolveAdapter falls back to 'openai' if the default isn't
 * configured.
 *
 * Lives in llm-service (not local-server) so both the open + cloud
 * handlers consume the same module. Cloud previously hardcoded
 * openaiTtsStream because the adapter abstraction shipped local-only;
 * this is the shared home that closes that divergence.
 *
 * To add a provider:
 *   1. Add an adapter under tts_providers/ implementing ServerTtsAdapter
 *   2. Wire it into the switch in `buildAdapter()`
 *   3. Add the provider id to the TtsProviderId union (and to the
 *      TTSProvider union in cortex/src/presets.ts if it should be
 *      preset-selectable)
 *   4. Document the env vars the build step requires
 */

import { AzureTtsAdapter } from './azure.js';
import { OpenAiTtsAdapter } from './openai.js';

import type { ServerTtsAdapter } from './_types.js';

export type TtsProviderId = 'openai' | 'azure';

export const DEFAULT_TTS_PROVIDER: TtsProviderId = 'azure';

/**
 * Minimal env-shaped config the registry needs to build each adapter.
 * Callers pass this directly (cloud reads from process.env; local
 * unwraps it from its richer ServerConfig). Decoupled from any host's
 * config shape so the registry stays portable.
 */
export interface TtsAdapterConfig {
    /** OpenAI API key. Required to build the openai adapter. */
    openaiKey: string | null;
    /** Azure Speech key. Required to build the azure adapter. */
    azureKey: string | null;
    /** Azure region (e.g. 'eastus'). Required to build the azure adapter. */
    azureRegion: string | null;
}

const adapters: Partial<Record<TtsProviderId, ServerTtsAdapter>> = {};
const buildErrors: Partial<Record<TtsProviderId, string>> = {};

function buildAdapter(name: TtsProviderId, config: TtsAdapterConfig): ServerTtsAdapter | null {
    try {
        switch (name) {
            case 'openai': {
                const key = config.openaiKey;
                if (!key) { buildErrors.openai = 'OPENAI_API_KEY not set'; return null; }
                return new OpenAiTtsAdapter(key);
            }
            case 'azure': {
                const key = config.azureKey;
                const region = config.azureRegion;
                if (!key) { buildErrors.azure = 'AZURE_SPEECH_KEY not set'; return null; }
                if (!region) { buildErrors.azure = 'AZURE_SPEECH_REGION not set'; return null; }
                return new AzureTtsAdapter(key, region);
            }
        }
    } catch (err) {
        buildErrors[name] = (err as Error).message;
        return null;
    }
}

/**
 * Returns the adapter for `name`, or for DEFAULT_TTS_PROVIDER if `name` is
 * undefined or not a known provider. Returns null only when neither the
 * requested provider nor the default can be built — caller should fail the
 * request with a clear error in that case.
 *
 * Adapters are cached at module scope across requests — same instance
 * reused, which is the right shape for stateful adapters like Azure's
 * persistent SpeechConfig.
 */
export function resolveAdapter(
    config: TtsAdapterConfig,
    name?: TtsProviderId | string | null,
): ServerTtsAdapter | null {
    const requested: TtsProviderId =
        (name === 'openai' || name === 'azure') ? name : DEFAULT_TTS_PROVIDER;
    if (!adapters[requested]) {
        const built = buildAdapter(requested, config);
        if (built) adapters[requested] = built;
    }
    if (adapters[requested]) return adapters[requested]!;
    // Requested provider couldn't be built — fall back to default if different.
    if (requested !== DEFAULT_TTS_PROVIDER) {
        if (!adapters[DEFAULT_TTS_PROVIDER]) {
            const fb = buildAdapter(DEFAULT_TTS_PROVIDER, config);
            if (fb) adapters[DEFAULT_TTS_PROVIDER] = fb;
        }
        return adapters[DEFAULT_TTS_PROVIDER] ?? null;
    }
    return null;
}

/** For diagnostics — which providers are available + why others aren't. */
export function getProviderStatus(config: TtsAdapterConfig): Array<{
    provider: TtsProviderId;
    available: boolean;
    isDefault: boolean;
    reason?: string;
}> {
    const result: ReturnType<typeof getProviderStatus> = [];
    for (const name of ['azure', 'openai'] as const) {
        if (!adapters[name] && !buildErrors[name]) {
            const built = buildAdapter(name, config);
            if (built) adapters[name] = built;
        }
        result.push({
            provider: name,
            available: !!adapters[name],
            isDefault: name === DEFAULT_TTS_PROVIDER,
            ...(adapters[name] ? {} : { reason: buildErrors[name] ?? 'unknown' }),
        });
    }
    return result;
}

export type {
    ServerTtsAdapter,
    TtsStreamOpts,
    TtsCostOpts,
    TtsCostEstimate,
} from './_types.js';
