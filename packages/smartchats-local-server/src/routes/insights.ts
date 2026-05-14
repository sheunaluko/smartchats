/**
 * POST /insights/batch — write a batch of telemetry events.
 *
 * Events are inserted as-is into `insights_events` (schemaless). The client
 * sends OTel-shaped records; the server doesn't transform them — whatever
 * fields arrive get stored, which keeps `bin/save_session` exports faithful.
 */

import type { Router, Request, Response } from 'express';
import express from 'express';
import type { InsightEvent } from 'smartchats-backend';
import { getDb } from '../surreal.js';
import { log } from '../logger.js';

const routeLog = log.withTag('insights');

export function insightsRoutes(): Router {
    const r = express.Router();

    r.post('/batch', async (req: Request, res: Response) => {
        const events = (req.body?.events ?? null) as InsightEvent[] | null;

        if (!Array.isArray(events)) {
            return res.status(400).json({ error: 'events (array) is required' });
        }
        if (events.length === 0) {
            return res.json({ stored: 0 });
        }

        try {
            const db = getDb();
            // `insights_events.timestamp` is a `datetime` in SurrealDB; wire events
            // carry epoch ms. Convert before insert so the SDK serializes to
            // SurrealDB's datetime type instead of leaving a raw integer.
            const normalized = events.map((ev) => ({
                ...(ev as unknown as Record<string, unknown>),
                ...(typeof ev.timestamp === 'number' && { timestamp: new Date(ev.timestamp) }),
            }));
            const inserted = await db.insert('insights_events', normalized);
            res.json({ stored: Array.isArray(inserted) ? inserted.length : events.length });
        } catch (err) {
            const message = (err as Error)?.message ?? 'unknown error';
            routeLog.error(`batch insert failed (${events.length} events): ${message}`);
            res.status(500).json({ stored: 0, errors: [message] });
        }
    });

    return r;
}
