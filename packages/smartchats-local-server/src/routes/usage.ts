/**
 * GET /usage/records — paginated list of usage rows
 * GET /usage/summary?since=<iso> — aggregate for a time window
 *
 * Self-hosted mode: creditsCharged is always 0, chargedFrom always 'byo_key'.
 * Clients gate credit-related UI on `capabilities.billing === false`.
 */

import type { Router, Request, Response } from 'express';
import express from 'express';
import type {
    UsageRecord,
    UsageSummary,
    UsageSummaryModelStats,
    PeriodSummary,
} from 'smartchats-backend';
import { queries } from 'smartchats-database';
import { getDb } from '../surreal.js';
import { log } from '../logger.js';

const routeLog = log.withTag('usage');

type DbUsageRow = {
    lts: string;
    model: string;
    provider: string;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    cost_usd: number;
    credits_charged: number;
    charged_from: string;
    session_id?: string | null;
    request_type?: string | null;
};

function toUsageRecord(r: DbUsageRow): UsageRecord {
    return {
        lts: r.lts,
        model: r.model,
        provider: r.provider,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        costUsd: r.cost_usd,
        creditsCharged: r.credits_charged,
        chargedFrom: 'byo_key',
    };
}

async function runRawOrEmpty<T>(query: string, vars: Record<string, unknown>): Promise<T[]> {
    try {
        const db = getDb();
        const result = await db.runRaw<T[]>(query, vars);
        const first = result[0];
        if (first?.status !== 'OK') return [];
        return Array.isArray(first.result) ? first.result : [];
    } catch (err) {
        routeLog.error(`query failed: ${(err as Error).message}`);
        return [];
    }
}

export function usageRoutes(): Router {
    const r = express.Router();

    r.get('/records', async (req: Request, res: Response) => {
        const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 500);
        const startAfter = typeof req.query.startAfter === 'string' ? req.query.startAfter : null;

        const listSpec = queries.listUsageRecords({ limit, startAfter });
        const rows = await runRawOrEmpty<DbUsageRow>(listSpec.query, listSpec.variables);

        // Period summary: last 30 days of activity (approximate "period")
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const periodSpec = queries.getUsageRecordsSince(thirtyDaysAgo);
        const periodRows = await runRawOrEmpty<DbUsageRow>(periodSpec.query, periodSpec.variables);

        const periodSummary: PeriodSummary = {
            totalCreditsUsed: 0,
            totalCostUsd: periodRows.reduce((sum, row) => sum + (row.cost_usd || 0), 0),
            requestCount: periodRows.length,
            topModels: buildTopModels(periodRows, 5),
        };

        res.json({
            records: rows.map(toUsageRecord),
            hasMore: rows.length === limit,
            periodSummary,
        });
    });

    r.get('/summary', async (req: Request, res: Response) => {
        const since = typeof req.query.since === 'string' ? req.query.since : null;
        if (!since || Number.isNaN(Date.parse(since))) {
            return res.status(400).json({ error: 'since (ISO timestamp) is required' });
        }

        const summarySpec = queries.getUsageRecordsSince(since);
        const rows = await runRawOrEmpty<DbUsageRow>(summarySpec.query, summarySpec.variables);

        const byModel = new Map<string, UsageSummaryModelStats>();
        for (const row of rows) {
            const stats = byModel.get(row.model) ?? {
                model: row.model, credits: 0, count: 0, tokens: 0,
            };
            stats.count += 1;
            stats.tokens += (row.input_tokens || 0) + (row.output_tokens || 0);
            byModel.set(row.model, stats);
        }

        const summary: UsageSummary = {
            totalCredits: 0,
            requestCount: rows.length,
            models: Array.from(byModel.values()).sort((a, b) => b.tokens - a.tokens),
            purchases: [],
        };
        res.json(summary);
    });

    return r;
}

function buildTopModels(
    rows: DbUsageRow[],
    take: number,
): Array<{ model: string; credits: number; count: number }> {
    const byModel = new Map<string, { model: string; credits: number; count: number }>();
    for (const row of rows) {
        const entry = byModel.get(row.model) ?? { model: row.model, credits: 0, count: 0 };
        entry.count += 1;
        byModel.set(row.model, entry);
    }
    return Array.from(byModel.values()).sort((a, b) => b.count - a.count).slice(0, take);
}
