/**
 * GET /health — aggregate readiness probe.
 *
 * Shape matches `HealthReport` from smartchats-backend so the client can
 * delegate directly. Each sub-probe runs independently with its own
 * try/catch so one failure doesn't mask the rest.
 *
 * HTTP status semantics:
 *   200 — server is running and can accept traffic. The SPA may still
 *         need configuration (no keys, etc.), but the listener is alive.
 *         The client inspects per-probe `ok` fields to gate UI.
 *   503 — server cannot serve. Only the `data` probe gates this — if
 *         SurrealDB is unreachable, no request can be answered.
 *
 * Probes:
 *   - data      — DB reachable + every required table responds (HARD gate)
 *   - providers — at least one LLM provider key is configured (soft)
 *   - tts       — OpenAI key is configured (soft)
 *
 * Why providers is soft: `smartchats start` polls this endpoint to detect
 * boot readiness. A fresh install (no .env yet) has no provider keys but
 * the server is still alive — the user is about to point their browser at
 * the SPA and configure keys via the settings UI. Treating "no keys" as
 * "service unavailable" would cause start to kill the server before the
 * user ever gets a chance to configure it.
 */

import type { Router, Request, Response } from 'express';
import express from 'express';
import type { HealthReport, LLMProvider } from 'smartchats-backend';
import { SMARTCHATS_REQUIRED_TABLES, LLM_PROVIDERS } from 'smartchats-backend';
import { queries } from 'smartchats-database';
import type { ServerConfig } from '../config.js';
import { getDb } from '../surreal.js';
import { resolveProviderKey } from './keys.js';

export function healthRoutes(config: ServerConfig): Router {
    const r = express.Router();

    r.get('/', async (_req: Request, res: Response) => {
        const checks: HealthReport['checks'] = {};
        let ok = true;

        // ─── data ────────────────────────────────────────────
        {
            const start = Date.now();
            try {
                const db = getDb();
                for (const name of SMARTCHATS_REQUIRED_TABLES) {
                    const probe = queries.probeTableExists(name);
                    await db.query(probe.query, probe.variables);
                }
                checks.data = { ok: true, latency_ms: Date.now() - start };
            } catch (err) {
                ok = false;
                checks.data = { ok: false, latency_ms: Date.now() - start, error: (err as Error).message };
            }
        }

        // ─── providers (any LLM provider configured counts as ok) ──
        // Soft check — see file header. The probe is reported so the SPA can
        // gate UI ("Configure an LLM provider to start chatting"), but a
        // missing key doesn't fail aggregate readiness.
        {
            const start = Date.now();
            try {
                const configured: LLMProvider[] = [];
                for (const p of LLM_PROVIDERS) {
                    const resolved = await resolveProviderKey(config, p);
                    if (resolved) configured.push(p);
                }
                const providersOk = configured.length > 0;
                checks.providers = {
                    ok: providersOk,
                    latency_ms: Date.now() - start,
                    ...(providersOk ? {} : { error: 'no LLM provider key configured' }),
                };
            } catch (err) {
                checks.providers = { ok: false, latency_ms: Date.now() - start, error: (err as Error).message };
            }
        }

        // ─── tts (OpenAI key, required for /tts/stream + /llm/streamWithTTS) ──
        {
            const start = Date.now();
            try {
                const resolved = await resolveProviderKey(config, 'openai');
                const ttsOk = resolved !== null;
                // TTS is a soft dependency — missing key doesn't fail aggregate readiness,
                // but the client can inspect `checks.tts.ok` to gate voice UI.
                checks.tts = {
                    ok: ttsOk,
                    latency_ms: Date.now() - start,
                    ...(ttsOk ? {} : { error: 'no OpenAI key configured' }),
                };
            } catch (err) {
                checks.tts = { ok: false, latency_ms: Date.now() - start, error: (err as Error).message };
            }
        }

        const report: HealthReport = { ok, id: 'local', checks };
        res.status(ok ? 200 : 503).json(report);
    });

    return r;
}
