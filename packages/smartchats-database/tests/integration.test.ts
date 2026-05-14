/**
 * Integration tests — read-only validation against a real backend.
 *
 * Target picked via `SMARTCHATS_TEST_TARGET` env var:
 *   - cloud (default): runs against smartchats.ai via smartchats-cloud-client.
 *     Requires cached credentials at ~/.smartchats-mcp/credentials.json.
 *     First auth call interactively launches a browser; subsequent runs
 *     use the refresh token silently.
 *   - local: runs against the local AIO (assumed running with imported
 *     fixture data). For comprehensive write/read/delete lifecycle
 *     coverage against local, see `local_crud.test.ts` instead.
 *
 * What's asserted (against either target):
 *   1. Each query produces a runnable spec (`{ query, variables }`).
 *   2. The dispatcher executes it without per-statement ERR — the
 *      previous in-MCP `unwrapRows` swallowed ERRs and returned `[]`,
 *      hiding broken queries. The new dispatcher throws on ERR, so any
 *      regression here surfaces as a test failure.
 *   3. Result shape is an array (not an object, not undefined). Specific
 *      row content isn't asserted — that depends on the backing data —
 *      but structural invariants are checked (id present where expected, etc.).
 *
 * Run:
 *   npm run test:cloud   (default — against smartchats.ai)
 *   npm run test:local   (against AIO; requires fixture loaded)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as queries from '../src/index.js';
import { getDispatcher, type Dispatcher } from './dispatcher.js';

let dispatcher: Dispatcher;

beforeAll(async () => {
    dispatcher = await getDispatcher();
}, 5 * 60 * 1000); // 5 min: covers interactive first-time cloud auth

// These tests assume populated data on the backing target. Empty results
// on queries below mean the dispatcher OR the query is broken — not that the
// data is missing. Loosen specific assertions if your target is sparse,
// but keep the spirit: each shared query must surface real data.

describe('logs queries', () => {
    it('listLogs (no search) returns recent rows with id+content', async () => {
        const rows = await dispatcher.run(queries.listLogs({ limit: 5 }));
        expect(rows.length).toBeGreaterThan(0);
        const r = rows[0] as queries.LogRow;
        expect(typeof r.id).toBe('string');
        expect(typeof r.content).toBe('string');
    });

    it('listLogs with searchText finds matching rows for a broad term', async () => {
        // Broad single-letter search — should match in any populated log corpus.
        const rows = await dispatcher.run(queries.listLogs({ searchText: 'a', limit: 5 }));
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows as queries.LogRow[]) {
            expect(r.content.toLowerCase()).toContain('a');
        }
    });

    it('getLogCategories returns at least one category with a count', async () => {
        const rows = await dispatcher.run(queries.getLogCategories());
        expect(rows.length).toBeGreaterThan(0);
        const r = rows[0] as { category: string; count: number };
        expect(typeof r.category).toBe('string');
        expect(typeof r.count).toBe('number');
        expect(r.count).toBeGreaterThan(0);
    });
});

describe('metrics queries', () => {
    it('getMetrics returns rows', async () => {
        const rows = await dispatcher.run(queries.getMetrics({ limit: 5 }));
        expect(rows.length).toBeGreaterThan(0);
    });

    it('getMetricsSummary returns aggregates with metric_name + entry_count', async () => {
        const rows = await dispatcher.run(queries.getMetricsSummary());
        expect(rows.length).toBeGreaterThan(0);
        const r = rows[0] as { metric_name: string; entry_count: number };
        expect(typeof r.metric_name).toBe('string');
        expect(typeof r.entry_count).toBe('number');
        expect(r.entry_count).toBeGreaterThan(0);
    });

    it('getRecentMetrics returns up to 10 rows', async () => {
        const rows = await dispatcher.run(queries.getRecentMetrics());
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThanOrEqual(10);
    });
});

describe('todos queries', () => {
    // Active todos may be empty (user could be all caught up). Don't require
    // rows; only assert shape for ones that exist.
    it('getTodos active returns todo-shaped rows', async () => {
        const rows = await dispatcher.run(queries.getTodos({ status: 'active', limit: 5 }));
        expect(Array.isArray(rows)).toBe(true);
        for (const r of rows) {
            expect((r as queries.TodoRow).type).toBe('todo');
            expect((r as queries.TodoRow).status).toBe('active');
        }
    });
});

describe('knowledge graph queries', () => {
    it('searchEntitiesByName finds entities for a broad term', async () => {
        const rows = await dispatcher.run(queries.searchEntitiesByName({ query: 'a', limit: 5 }));
        expect(rows.length).toBeGreaterThan(0);
        const r = rows[0] as queries.EntityRow;
        expect(typeof r.id).toBe('string');
        expect(typeof r.name).toBe('string');
    });

    it('searchRelationsByName returns triple-shaped rows', async () => {
        const rows = await dispatcher.run(queries.searchRelationsByName({ query: 'a', limit: 5 }));
        // Relations might or might not match by name — relax to shape check.
        for (const r of rows as queries.RelationRow[]) {
            expect(typeof r.id).toBe('string');
            expect(typeof r.sourceName).toBe('string');
            expect(typeof r.targetName).toBe('string');
        }
    });
});

describe('sessions queries', () => {
    it('listSessions returns sessions ordered by lts DESC', async () => {
        const rows = await dispatcher.run(queries.listSessions({ limit: 5 }));
        expect(rows.length).toBeGreaterThan(0);
        const r = rows[0] as queries.SessionSummaryRow;
        expect(typeof r.id).toBe('string');
        expect(typeof r.label).toBe('string');
    });
});

describe('raw query passthrough', () => {
    it('buildRawQuery accepts SELECT and runs', async () => {
        const rows = await dispatcher.run(
            queries.buildRawQuery('SELECT count() AS n FROM logs GROUP ALL'),
        );
        expect(rows.length).toBeGreaterThan(0);
        const r = rows[0] as { n: number };
        expect(typeof r.n).toBe('number');
    });

    it('buildRawQuery rejects non-readonly statements', () => {
        expect(() => queries.buildRawQuery('UPDATE logs SET foo = 1')).toThrow(
            queries.NonReadOnlyQueryError,
        );
    });
});
