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
import type { LLMProvider, BYOKeyPreviews } from 'smartchats-backend';
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

export function keysRoutes(config: ServerConfig): Router {
    const r = express.Router();

    // GET /keys → masked preview of USER-configured (DB) keys only.
    // Env vars participate in resolveProviderKey for LLM calls but are NOT
    // reported here — they're system-level fallbacks, not user BYO. Cloud
    // parity: after a user deletes their BYO key, the preview is null.
    r.get('/', async (_req: Request, res: Response) => {
        const out: BYOKeyPreviews = { openai: null, anthropic: null, google: null };
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
