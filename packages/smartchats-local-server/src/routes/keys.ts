/**
 * BYO API key routes.
 *
 * Resolution order per provider (highest precedence first):
 *   1. SMARTCHATS_<PROVIDER>_API_KEY env var
 *   2. <PROVIDER>_API_KEY env var
 *   3. DB-stored (byo_api_keys table)
 *
 * `GET /keys` returns the masked preview of whichever source resolves.
 * `POST /keys` only writes to the DB. `DELETE /keys/:provider` only removes from the DB.
 * The server warns callers (via response field) when DB-write is shadowed by an env var.
 */

import type { Router, Request, Response } from 'express';
import express from 'express';
import type { LLMProvider, BYOKeyPreviews, ProviderAvailability, ProvidersReport } from 'smartchats-backend';
import { LLM_PROVIDERS } from 'smartchats-backend';
import { queries } from 'smartchats-database';
import type { ServerConfig } from '../config.js';
import { getDb } from '../surreal.js';
import { log } from '../logger.js';

const routeLog = log.withTag('keys');

function mask(key: string): string {
    if (!key || key.length < 8) return '****';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

async function getDbKey(provider: LLMProvider): Promise<string | null> {
    const db = getDb();
    try {
        const spec = queries.getByoKey(provider);
        const result = await db.runRaw<Array<{ api_key?: string }>>(spec.query, spec.variables);
        const first = result[0];
        if (first?.status !== 'OK') return null;
        const rows = first.result as Array<{ api_key?: string }> | undefined;
        return rows?.[0]?.api_key ?? null;
    } catch (err) {
        routeLog.error(`getDbKey(${provider}) failed: ${(err as Error).message}`);
        return null;
    }
}

function envKey(config: ServerConfig, provider: LLMProvider): string | null {
    return config.providerEnvKeys[provider];
}

/** Server-side resolver — call this from any route that needs to USE a key. */
export async function resolveProviderKey(
    config: ServerConfig,
    provider: LLMProvider,
): Promise<{ key: string; source: 'env' | 'db' } | null> {
    const fromEnv = envKey(config, provider);
    if (fromEnv) return { key: fromEnv, source: 'env' };
    const fromDb = await getDbKey(provider);
    if (fromDb) return { key: fromDb, source: 'db' };
    return null;
}

// ── Provider availability probe (feeds client PresetMenu gray-out) ─────
//
// For each provider we surface: (a) is a key resolvable right now, (b)
// where from (env vs BYO DB), (c) the primary env var name + a
// user-facing hint so the client can show "how do I enable this?"
// tooltips without hardcoding paths.

interface ProviderDescriptor {
    /** Primary env var name — shown in the tooltip. */
    envVar: string;
    /** Hint text — references the smartchats CLI, which is the intended
     *  configuration path for local users. */
    hint: string;
}

const PROVIDER_DESCRIPTORS: Record<LLMProvider, ProviderDescriptor> = {
    openai: {
        envVar: 'OPENAI_API_KEY',
        hint: "Run `smartchats config set OPENAI_API_KEY=…` or add via Settings → BYO Keys.",
    },
    anthropic: {
        envVar: 'ANTHROPIC_API_KEY',
        hint: "Run `smartchats config set ANTHROPIC_API_KEY=…` or add via Settings → BYO Keys.",
    },
    google: {
        envVar: 'GEMINI_API_KEY',
        hint: "Run `smartchats config set GEMINI_API_KEY=…` (or GOOGLE_API_KEY) or add via Settings → BYO Keys.",
    },
    xai: {
        envVar: 'XAI_API_KEY',
        hint: "Run `smartchats config set XAI_API_KEY=…` or add via Settings → BYO Keys.",
    },
    azure: {
        envVar: 'AZURE_SPEECH_KEY',
        hint: "Set AZURE_SPEECH_KEY + AZURE_SPEECH_REGION via `smartchats config set …`.",
    },
};

/** Which providers can serve LLM requests. Excludes 'azure' — Azure is
 *  TTS-only in this stack. */
const LLM_KEY_PROVIDERS: readonly LLMProvider[] = ['openai', 'anthropic', 'google', 'xai'] as const;
/** Which providers can serve TTS requests. */
const TTS_KEY_PROVIDERS: readonly LLMProvider[] = ['openai', 'azure'] as const;

async function probeProvider(
    config: ServerConfig,
    provider: LLMProvider,
): Promise<ProviderAvailability> {
    const desc = PROVIDER_DESCRIPTORS[provider];
    const resolved = await resolveProviderKey(config, provider);
    if (!resolved) {
        return { provider, available: false, envVar: desc.envVar, hint: desc.hint };
    }
    // Azure additionally requires a region — a key alone isn't enough.
    if (provider === 'azure' && !config.azure?.region) {
        return {
            provider,
            available: false,
            envVar: desc.envVar,
            hint: 'AZURE_SPEECH_KEY is set but AZURE_SPEECH_REGION is missing.',
        };
    }
    return {
        provider,
        available: true,
        source: resolved.source === 'env' ? 'env' : 'byo',
        envVar: desc.envVar,
        hint: desc.hint,
    };
}

export async function getProvidersReport(config: ServerConfig): Promise<ProvidersReport> {
    const [llm, tts] = await Promise.all([
        Promise.all(LLM_KEY_PROVIDERS.map((p) => probeProvider(config, p))),
        Promise.all(TTS_KEY_PROVIDERS.map((p) => probeProvider(config, p))),
    ]);
    return { llm, tts };
}

export function keysRoutes(config: ServerConfig): Router {
    const r = express.Router();

    // GET /keys/providers → runtime availability per LLM / TTS provider.
    // Client PresetMenu calls this on boot + after every BYO save.
    r.get('/providers', async (_req: Request, res: Response) => {
        try {
            const report = await getProvidersReport(config);
            res.json(report);
        } catch (err) {
            routeLog.error(`/providers failed: ${(err as Error).message}`);
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // GET /keys → masked preview of USER-configured (DB) keys only.
    // Env vars participate in resolveProviderKey for LLM calls but are NOT
    // reported here — they're system-level fallbacks, not user BYO. Cloud
    // parity: after a user deletes their BYO key, the preview is null.
    r.get('/', async (_req: Request, res: Response) => {
        const out: BYOKeyPreviews = { openai: null, anthropic: null, google: null, xai: null, azure: null };
        for (const p of LLM_PROVIDERS) {
            const dbKey = await getDbKey(p);
            out[p] = dbKey ? mask(dbKey) : null;
        }
        res.json(out);
    });

    // POST /keys  body: { keys: { openai?, anthropic?, google? } }
    r.post('/', async (req: Request, res: Response) => {
        const { keys } = (req.body ?? {}) as { keys?: Partial<Record<LLMProvider, string>> };
        if (!keys || typeof keys !== 'object') {
            return res.status(400).json({ error: 'keys object is required' });
        }

        const db = getDb();
        const configured: LLMProvider[] = [];
        const shadowedByEnv: LLMProvider[] = [];

        for (const p of LLM_PROVIDERS) {
            const value = keys[p];
            if (value === undefined) continue;
            if (typeof value !== 'string' || value.trim().length === 0) {
                return res.status(400).json({ error: `keys.${p} must be a non-empty string` });
            }
            try {
                const spec = queries.upsertByoKey({ provider: p, key: value.trim() });
                await db.runRaw(spec.query, spec.variables);
                configured.push(p);
                if (envKey(config, p)) shadowedByEnv.push(p);
            } catch (err) {
                routeLog.error(`save(${p}) failed: ${(err as Error).message}`);
                return res.status(500).json({ error: `save failed for ${p}` });
            }
        }

        res.json({
            configured,
            ...(shadowedByEnv.length > 0 && {
                warning: `env vars take precedence; DB keys for [${shadowedByEnv.join(', ')}] will be ignored at call time`,
            }),
        });
    });

    // DELETE /keys/:provider
    r.delete('/:provider', async (req: Request, res: Response) => {
        const provider = req.params.provider as LLMProvider;
        if (!LLM_PROVIDERS.includes(provider)) {
            return res.status(400).json({ error: `unknown provider: ${provider}` });
        }
        try {
            const db = getDb();
            const spec = queries.deleteByoKey(provider);
            await db.runRaw(spec.query, spec.variables);
            res.json({ ok: true });
        } catch (err) {
            routeLog.error(`delete(${provider}) failed: ${(err as Error).message}`);
            res.status(500).json({ error: (err as Error).message });
        }
    });

    return r;
}
