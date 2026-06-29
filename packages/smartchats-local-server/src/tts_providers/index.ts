/**
 * TTS provider registry — single resolution point for the /llm/streamWithTTS
 * + /tts routes. Adapters are instantiated lazily on first request so the
 * server doesn't fail to boot when an optional provider key is missing.
 *
 * Default is 'azure' as of 2026-06-27 (the voicebench winner: 0ms chunk-0→1,
 * ~1ms p95 gap). Pre-flight check verifies the default is actually
 * configured; if not, falls back to 'openai' to preserve boot.
 *
 * To add a provider:
 *   1. Add an adapter under tts_providers/ implementing ServerTtsAdapter
 *   2. Wire it into the switch in `buildAdapter()`
 *   3. Add the provider id to the TTSProvider union (cortex/src/presets.ts)
 */

import type { ServerConfig } from '../config.js';
import { AzureTtsAdapter } from './azure.js';
import { OpenAiTtsAdapter } from './openai.js';

import type { ServerTtsAdapter } from './_types.js';

export type TtsProviderId = 'openai' | 'azure';

export const DEFAULT_TTS_PROVIDER: TtsProviderId = 'azure';

const adapters: Partial<Record<TtsProviderId, ServerTtsAdapter>> = {};
const buildErrors: Partial<Record<TtsProviderId, string>> = {};

function buildAdapter(name: TtsProviderId, config: ServerConfig): ServerTtsAdapter | null {
    try {
        switch (name) {
            case 'openai': {
                const key = config.providerEnvKeys.openai;
                if (!key) { buildErrors.openai = 'OPENAI_API_KEY not set'; return null; }
                return new OpenAiTtsAdapter(key);
            }
            case 'azure': {
                const key = config.providerEnvKeys.azure;
                const region = config.azure.region;
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
 * undefined or not configured. Returns null only when neither the requested
 * provider nor the default can be built — in which case the caller should
 * fail the request with a clear error.
 */
export function resolveAdapter(
    config: ServerConfig,
    name?: TtsProviderId | string,
): ServerTtsAdapter | null {
    const requested = (name && (name === 'openai' || name === 'azure')) ? name : DEFAULT_TTS_PROVIDER;
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
export function getProviderStatus(config: ServerConfig): Array<{
    provider: TtsProviderId;
    available: boolean;
    isDefault: boolean;
    reason?: string;
}> {
    const result: ReturnType<typeof getProviderStatus> = [];
    for (const name of ['azure', 'openai'] as const) {
        // Try a build to populate adapters or errors
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

export type { ServerTtsAdapter } from './_types.js';
