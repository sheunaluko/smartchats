import type { Router, Request, Response } from 'express';
import express from 'express';
import { SMARTCHATS_REQUIRED_TABLES } from 'smartchats-backend';
import { queries } from 'smartchats-database';
import { getDb } from '../surreal.js';
import { log } from '../logger.js';

const routeLog = log.withTag('data');

export function dataRoutes(): Router {
    const r = express.Router();

    r.post('/query', async (req: Request, res: Response) => {
        const { query, variables } = (req.body ?? {}) as {
            query?: string;
            variables?: Record<string, unknown>;
        };
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'query (string) is required' });
        }

        const summary = query.replace(/\s+/g, ' ').trim().slice(0, 120);
        routeLog.info(`query: ${summary}`);

        try {
            const db = getDb();
            // runRaw wraps SurrealDB's `queryRaw` — returns an array of
            // `{status, result, time}` per statement. status is 'OK' on success
            // or 'ERR' with a string result on per-statement failure. Shape
            // matches `DataStatementResult` in the backend interface directly.
            const statements = await db.runRaw(query, variables ?? {});
            const errs = statements.filter((s) => s.status === 'ERR');
            if (errs.length > 0) {
                for (const e of errs) routeLog.warn(`statement ERR: ${String((e as any).result).slice(0, 200)}`);
            }
            res.json({ statements });
        } catch (err) {
            // Only catches connection-level / protocol errors; statement errors come through `status: 'ERR'`.
            const message = (err as Error)?.message ?? 'unknown error';
            routeLog.error(`query failed: ${message}`);
            res.status(503).json({
                statements: [{ status: 'ERR' as const, result: message }],
            });
        }
    });

    r.get('/health', async (_req: Request, res: Response) => {
        const start = Date.now();
        const tables: Record<string, { ok: boolean; error?: string }> = {};
        let ok = true;

        try {
            const db = getDb();
            for (const name of SMARTCHATS_REQUIRED_TABLES) {
                try {
                    const probe = queries.probeTableExists(name);
                    await db.query(probe.query, probe.variables);
                    tables[name] = { ok: true };
                } catch (err) {
                    ok = false;
                    tables[name] = { ok: false, error: (err as Error).message };
                }
            }
        } catch (err) {
            return res.status(503).json({
                ok: false,
                latency_ms: Date.now() - start,
                tables: {},
                error: `database unreachable: ${(err as Error).message}`,
            });
        }

        res.json({ ok, latency_ms: Date.now() - start, tables });
    });

    return r;
}
