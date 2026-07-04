'use client';

/**
 * Capabilities store — per-provider LLM/TTS availability.
 *
 * The server (local or cloud) is the authoritative source: it resolves
 * env → BYO-DB → nothing for each provider and reports what can serve
 * requests right now. The client mirrors this into Zustand so PresetMenu
 * can gray out unavailable rows without doing its own key discovery.
 *
 * Fetch triggers:
 *   - once at boot (fetchOnce)
 *   - after every BYO save (billing_store hooks into refresh() below)
 *   - on backend-mode switch (bootstrap wrapper re-mounts anyway)
 *
 * Initial render is optimistic — before the probe returns, assume every
 * provider is available so the menu doesn't briefly flash all-locked on
 * cold load.
 */

import { createInsightStore } from 'smartchats-common';
import type { ProvidersReport, ProviderAvailability, LLMProvider } from 'smartchats-backend';
import { getBackend } from '@/lib/backend';

/** Optimistic default — every provider is treated as available until
 *  the probe returns. Prevents cold-load "everything grayed out" flash. */
function optimisticReport(): ProvidersReport {
    const mk = (provider: LLMProvider): ProviderAvailability => ({
        provider,
        available: true,
        envVar: '',
        hint: '',
    });
    return {
        llm: (['openai', 'anthropic', 'google', 'xai'] as LLMProvider[]).map(mk),
        tts: (['openai', 'azure'] as LLMProvider[]).map(mk),
    };
}

interface CapabilitiesState {
    report: ProvidersReport;
    /** null until first fetch completes. Optimistic report is served in the
     *  meantime; consumers can watch this to know when the real answer is in. */
    lastFetched: number | null;
    isLoading: boolean;
    error: string | null;

    /** Fetches only if not already fetched. Boot-time entry point. */
    fetchOnce: () => Promise<void>;
    /** Force a fresh fetch — called after BYO save/delete. */
    refresh: () => Promise<void>;
}

export const useCapabilitiesStore = createInsightStore<CapabilitiesState>({
    appName: 'smartchats_capabilities',
    silent: ['fetchOnce'],  // no-op fast-path shouldn't emit
    creator: (set, get) => ({
        report: optimisticReport(),
        lastFetched: null,
        isLoading: false,
        error: null,

        async fetchOnce() {
            if (get().lastFetched !== null || get().isLoading) return;
            await get().refresh();
        },

        async refresh() {
            if (get().isLoading) return;
            set({ isLoading: true, error: null });
            try {
                const report = await getBackend().providers();
                set({ report, lastFetched: Date.now(), isLoading: false, error: null });
            } catch (err) {
                // On probe failure, keep the optimistic report — better UX
                // than freezing the menu. Log the error for triage.
                const msg = (err as Error).message ?? String(err);
                set({ isLoading: false, error: msg });
                // eslint-disable-next-line no-console
                console.warn('[capabilities] probe failed — keeping optimistic report:', msg);
            }
        },
    }),
});

// ─── Selectors ──────────────────────────────────────────────────────

/** Maps MODEL_REGISTRY's `provider` field ('gemini' etc.) to the
 *  LLMProvider used for key resolution ('google'). Historical mismatch —
 *  see packages/cortex/src/model_registry.ts. Callers pass the model's
 *  own `provider` string; this function normalizes. */
export function modelProviderToKeyProvider(p: string): LLMProvider | null {
    switch (p) {
        case 'openai': return 'openai';
        case 'anthropic': return 'anthropic';
        case 'gemini': return 'google';
        case 'google': return 'google';
        case 'xai': return 'xai';
        case 'azure': return 'azure';
        default: return null;
    }
}

export function isModelAvailable(report: ProvidersReport, modelProvider: string): boolean {
    const key = modelProviderToKeyProvider(modelProvider);
    if (!key) return true;  // Unknown provider — don't block; the actual call will error more helpfully.
    return report.llm.find((p) => p.provider === key)?.available ?? true;
}

export function isTtsProviderAvailable(report: ProvidersReport, ttsProvider: string): boolean {
    return report.tts.find((p) => p.provider === ttsProvider)?.available ?? true;
}

/** Find the missing-provider info for a tooltip — returns null if the
 *  provider is available or unknown. */
export function missingProviderInfo(
    report: ProvidersReport,
    scope: 'llm' | 'tts',
    provider: string,
): ProviderAvailability | null {
    const key = scope === 'llm' ? modelProviderToKeyProvider(provider) : (provider as LLMProvider);
    if (!key) return null;
    const info = report[scope].find((p) => p.provider === key);
    if (!info || info.available) return null;
    return info;
}
