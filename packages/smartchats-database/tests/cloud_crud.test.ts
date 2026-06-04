/**
 * Cloud CRUD + cross-user isolation tests.
 *
 * Validates the canonical cloud schema by authenticating as TWO distinct
 * users (`alice` and `bob`) via SIGNUP /
 * SIGNIN against a local SurrealDB instance with the cloud schema applied.
 *
 * What's asserted:
 *   1. SIGNUP + SIGNIN work end-to-end with the SIGNIN-secret defense.
 *   2. Each user can write + read their own rows across every user-data table.
 *   3. **Cross-user isolation**: bob's authenticated SELECT against tables
 *      with alice's data returns empty. bob's UPDATE/DELETE against alice's
 *      specific record id is a no-op. This is the core security property the
 *      cloud schema enforces; if any of these fails, the canonical PERMISSIONS
 *      block is broken and user data can leak.
 *   4. SIGNIN with a wrong secret fails (proves the defense-in-depth gate works).
 *
 * Preconditions:
 *   - `bin/cloud_test_db` running on port 8001 (override via SMARTCHATS_CLOUD_TEST_URL).
 *   - The SIGNIN secret is read from `~/.smartchats/cloud_test_secret` (created
 *     by `cloud_test_db` on first run).
 *
 * Run: `npm run test:cloud-crud` from `packages/smartchats-database`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// Phase 9.1: tests use the same Client interface every other consumer does.
// `createClient` for root, `createUserClient` for the per-user signin path.
// No direct surrealdb import here — keeps the "ONE direct importer"
// invariant intact (the only file importing `surrealdb` is `client.ts`).
import { createClient, createUserClient, type Client } from '../src/index.js';
import * as queries from '../src/index.js';

const URL = process.env.SMARTCHATS_CLOUD_TEST_URL ?? 'ws://localhost:8001/rpc';
const NAMESPACE = 'production';
const DATABASE = 'main';
const SECRET_FILE = process.env.SMARTCHATS_CLOUD_TEST_SECRET_FILE
    ?? join(homedir(), '.smartchats', 'cloud_test_secret');

// Per-run unique emails so re-runs don't collide on the UNIQUE index.
const RUN_TAG = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const ALICE = {
    email: `alice_${RUN_TAG}@cloud-crud.test`,
    user_id: `alice_uid_${RUN_TAG}`,
};
const BOB = {
    email: `bob_${RUN_TAG}@cloud-crud.test`,
    user_id: `bob_uid_${RUN_TAG}`,
};

// 1536-dim embedding (HNSW indexes require this dimension on logs / KG tables).
const FAKE_EMBEDDING = Array.from({ length: 1536 }, (_, i) => (i % 100) / 1000);

let signinSecret: string;
let aliceDb: Client;
let bobDb: Client;
let rootDb: Client;
let aliceUserId: string; // SurrealDB record id of alice's user row
let bobUserId: string;

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

beforeAll(async () => {
    try {
        signinSecret = readFileSync(SECRET_FILE, 'utf8').trim();
    } catch (err) {
        throw new Error(
            `Could not read SIGNIN secret from ${SECRET_FILE}. ` +
                `Run \`bin/cloud_test_db\` first to start the test SurrealDB and generate the secret. (${(err as Error).message})`,
        );
    }
    if (signinSecret.length < 32) {
        throw new Error(`SIGNIN secret in ${SECRET_FILE} looks too short (${signinSecret.length} chars).`);
    }

    // Root client — used for setup + teardown only.
    rootDb = createClient({
        url: URL,
        namespace: NAMESPACE,
        database: DATABASE,
        auth: { username: 'root', password: 'root' },
    });
    try {
        await rootDb.connect();
    } catch (err) {
        throw new Error(
            `Could not connect to ${URL} as root. Is \`bin/cloud_test_db\` running? (${(err as Error).message})`,
        );
    }

    // SIGN UP alice + bob — each gets a JWT and an authenticated client.
    // Separate Client instances per user so concurrent queries don't trip
    // over each other's auth state.
    aliceDb = createUserClient({ url: URL, namespace: NAMESPACE, database: DATABASE });
    await aliceDb.connect();
    await aliceDb.signupAsUser({
        access: 'user',
        variables: { ...ALICE, secret: signinSecret },
    });

    bobDb = createUserClient({ url: URL, namespace: NAMESPACE, database: DATABASE });
    await bobDb.connect();
    await bobDb.signupAsUser({
        access: 'user',
        variables: { ...BOB, secret: signinSecret },
    });

    // Capture user record ids for cleanup.
    const aliceUserResult = (await rootDb.query(
        `SELECT id FROM user WHERE email = $email LIMIT 1`,
        { email: ALICE.email },
    )) as Array<Array<{ id: unknown }>>;
    aliceUserId = String(aliceUserResult[0]?.[0]?.id ?? '');
    const bobUserResult = (await rootDb.query(
        `SELECT id FROM user WHERE email = $email LIMIT 1`,
        { email: BOB.email },
    )) as Array<Array<{ id: unknown }>>;
    bobUserId = String(bobUserResult[0]?.[0]?.id ?? '');

    expect(aliceUserId.startsWith('user:')).toBe(true);
    expect(bobUserId.startsWith('user:')).toBe(true);
}, 60_000);

afterAll(async () => {
    // Clean up everything this run created. We use root so the owner-scoped
    // permissions don't get in the way. DELETE FROM <table> WHERE owner =
    // <user_id> handles per-table data; then DELETE the user records themselves.
    if (!rootDb) return;
    try {
        const userRefs = [aliceUserId, bobUserId].filter(Boolean);
        if (userRefs.length === 0) return;

        const ownedTables = [
            'logs', 'metrics', 'sessions', 'user_entities', 'user_relations',
            'user_data', 'app_data', 'cortex', 'cortex_dynamic_functions',
            'smartchats_apps', 'smartchats_app_installs',
        ];
        for (const t of ownedTables) {
            await rootDb.query(
                `DELETE FROM type::table($t) WHERE owner IN $owners`,
                { t, owners: userRefs },
            ).catch(() => undefined);
        }
        for (const id of userRefs) {
            await rootDb.query(`DELETE ${id}`).catch(() => undefined);
        }
    } finally {
        await Promise.all([
            aliceDb?.close().catch(() => undefined),
            bobDb?.close().catch(() => undefined),
            rootDb?.close().catch(() => undefined),
        ]);
    }
}, 30_000);

// ── Helper: dispatch a QuerySpec via a Client and return rows ──

async function runAs(db: Client, spec: queries.QuerySpec): Promise<unknown[]> {
    const result = (await db.query(spec.query, spec.variables)) as unknown[];
    // db.query returns array<statementResult>; for single-statement queries,
    // statementResult IS the rows array.
    const first = result[0];
    return Array.isArray(first) ? first : [];
}

// ─── Cross-user isolation: write as alice, verify bob can't see ─────────

describe('SIGNIN/SIGNUP secret enforcement', () => {
    it('SIGNIN with wrong secret fails', async () => {
        const wrongDb = createUserClient({ url: URL, namespace: NAMESPACE, database: DATABASE });
        try {
            await wrongDb.connect();
            await expect(
                wrongDb.signinAsUser({
                    access: 'user',
                    variables: { ...ALICE, secret: 'wrong-secret-value' },
                }),
            ).rejects.toThrow();
        } finally {
            await wrongDb.close().catch(() => undefined);
        }
    });

    it('SIGNIN with correct secret succeeds', async () => {
        const ok = createUserClient({ url: URL, namespace: NAMESPACE, database: DATABASE });
        try {
            await ok.connect();
            // signinAsUser returns the access JWT string and switches the
            // underlying connection to that user's auth context.
            const token = await ok.signinAsUser({
                access: 'user',
                variables: { ...ALICE, secret: signinSecret },
            });
            expect(typeof token).toBe('string');
            expect(token.length).toBeGreaterThan(20);
        } finally {
            await ok.close().catch(() => undefined);
        }
    });

    it('SIGNUP with wrong secret fails (no user record created, UNIQUE preserved)', async () => {
        // The IF guard in DEFINE ACCESS SIGNUP returns NONE when the secret
        // doesn't match → SurrealDB treats this as a failed signup.
        const evil = createUserClient({ url: URL, namespace: NAMESPACE, database: DATABASE });
        const targetEmail = `evil_${RUN_TAG}@cloud-crud.test`;
        try {
            await evil.connect();
            await expect(
                evil.signupAsUser({
                    access: 'user',
                    variables: {
                        email: targetEmail,
                        user_id: `evil_uid_${RUN_TAG}`,
                        secret: 'wrong-secret-value',
                    },
                }),
            ).rejects.toThrow();
        } finally {
            await evil.close().catch(() => undefined);
        }

        // Verify no user row landed (would have blocked legitimate signup
        // with this email via UNIQUE index).
        const check = (await rootDb.query(
            `SELECT id FROM user WHERE email = $email LIMIT 1`,
            { email: targetEmail },
        )) as Array<Array<{ id: unknown }>>;
        expect(check[0]).toEqual([]);
    });

    it('SIGNUP without supplying secret at all fails', async () => {
        // Same defense: missing $secret → IF condition is NONE = $secret =>
        // false → IF returns NONE → no row created → signup fails.
        const noSecret = createUserClient({ url: URL, namespace: NAMESPACE, database: DATABASE });
        try {
            await noSecret.connect();
            await expect(
                noSecret.signupAsUser({
                    access: 'user',
                    variables: {
                        email: `nosecret_${RUN_TAG}@cloud-crud.test`,
                        user_id: `nosecret_uid_${RUN_TAG}`,
                    },
                }),
            ).rejects.toThrow();
        } finally {
            await noSecret.close().catch(() => undefined);
        }
    });
});

describe('logs cross-user isolation', () => {
    let aliceLogId: string;

    it('alice writes a log', async () => {
        const ts = nowIso();
        const rows = await runAs(aliceDb, queries.insertLog({
            content: `alice_${RUN_TAG}_log_content`,
            category: 'test',
            embedding: FAKE_EMBEDDING,
            ts,
            local_date: ts.slice(0, 10),
            local_tz: 'UTC',
        }));
        expect(rows.length).toBe(1);
        aliceLogId = String((rows[0] as { id: unknown }).id);
        expect(aliceLogId.startsWith('logs:')).toBe(true);
    });

    it('alice sees her own log via listLogs', async () => {
        const rows = await runAs(aliceDb, queries.listLogs({ limit: 50 }));
        const found = rows.find((r) => String((r as { id: unknown }).id) === aliceLogId);
        expect(found).toBeDefined();
    });

    it('bob does NOT see alice\'s log via listLogs', async () => {
        const rows = await runAs(bobDb, queries.listLogs({ limit: 50 }));
        const leaked = rows.find((r) => String((r as { id: unknown }).id) === aliceLogId);
        expect(leaked).toBeUndefined();
    });

    it('bob does NOT see alice\'s log via direct id select', async () => {
        // Try to grab the row by alice's specific id — owner WHERE clause should
        // filter it out for bob.
        const rows = (await bobDb.query(`SELECT * FROM ${aliceLogId}`)) as unknown[];
        expect(Array.isArray(rows[0]) ? rows[0] : []).toEqual([]);
    });

    it('bob cannot UPDATE alice\'s log', async () => {
        // Permission rule says only the owner can update. The query may either
        // return [] or throw; either way alice's content must be unchanged.
        await bobDb.query(
            `UPDATE ${aliceLogId} SET content = 'bob_overwrite'`,
        ).catch(() => undefined);
        const rows = await runAs(aliceDb, queries.listLogs({ limit: 50 }));
        const aliceRow = rows.find((r) => String((r as { id: unknown }).id) === aliceLogId);
        expect((aliceRow as { content: string }).content).toBe(`alice_${RUN_TAG}_log_content`);
    });

    it('bob cannot DELETE alice\'s log', async () => {
        await bobDb.query(`DELETE ${aliceLogId}`).catch(() => undefined);
        const rows = await runAs(aliceDb, queries.listLogs({ limit: 50 }));
        const stillThere = rows.find((r) => String((r as { id: unknown }).id) === aliceLogId);
        expect(stillThere).toBeDefined();
    });
});

describe('metrics cross-user isolation', () => {
    let aliceMetricId: string;
    const ts = nowIso();

    it('alice writes a metric', async () => {
        const rows = await runAs(aliceDb, queries.insertMetric({
            metric_name: `alice_${RUN_TAG}_metric`,
            value: 42,
            unit: 'reps',
            metric_type: 'numeric',
            ts,
            local_date: ts.slice(0, 10),
            local_tz: 'UTC',
            source: 'test',
            source_text: 'cross-user iso',
            source_log_id: null,
            category: 'test',
            time_shift_quantity: null,
            time_shift_unit: null,
            note: null,
        }));
        expect(rows.length).toBe(1);
        aliceMetricId = String((rows[0] as { id: unknown }).id);
    });

    it('bob\'s getMetrics returns no rows for alice\'s metric', async () => {
        const rows = await runAs(bobDb, queries.getMetrics({
            metric_name: `alice_${RUN_TAG}_metric`,
            limit: 50,
        }));
        expect(rows.length).toBe(0);
    });

    it('bob\'s getMetricsSummary does NOT include alice\'s metric_name', async () => {
        const rows = await runAs(bobDb, queries.getMetricsSummary());
        const leaked = (rows as Array<{ metric_name: string }>).find(
            (r) => r.metric_name === `alice_${RUN_TAG}_metric`,
        );
        expect(leaked).toBeUndefined();
    });

    it('bob writes his own metric (same name) — confirms isolation symmetry', async () => {
        const rows = await runAs(bobDb, queries.insertMetric({
            metric_name: `alice_${RUN_TAG}_metric`, // same name; different owner
            value: 99,
            unit: 'reps',
            metric_type: 'numeric',
            ts,
            local_date: ts.slice(0, 10),
            local_tz: 'UTC',
            source: 'test',
            source_text: 'bob copy',
            source_log_id: null,
            category: 'test',
            time_shift_quantity: null,
            time_shift_unit: null,
            note: null,
        }));
        expect(rows.length).toBe(1);
        // Each side now has 1 row of this metric_name.
        const aliceRows = await runAs(aliceDb, queries.findMetricByName(`alice_${RUN_TAG}_metric`));
        const bobRows = await runAs(bobDb, queries.findMetricByName(`alice_${RUN_TAG}_metric`));
        expect(aliceRows.length).toBe(1);
        expect(bobRows.length).toBe(1);
    });
});

describe('sessions cross-user isolation', () => {
    let aliceSessionId: string;

    it('alice creates a session', async () => {
        const ts = nowIso();
        const rows = await runAs(aliceDb, queries.insertSession({
            label: `alice_${RUN_TAG}_session`,
            message_count: 0,
            chat_history: [],
            workspace: {},
            thought_history: [],
            execution_history: [],
            settings: {},
            ts,
            local_date: ts.slice(0, 10),
            local_tz: 'UTC',
        }));
        expect(rows.length).toBe(1);
        aliceSessionId = String((rows[0] as { id: unknown }).id);
    });

    it('bob\'s listSessions does NOT include alice\'s session', async () => {
        const rows = await runAs(bobDb, queries.listSessions({ limit: 50 }));
        const leaked = rows.find((r) => String((r as { id: unknown }).id) === aliceSessionId);
        expect(leaked).toBeUndefined();
    });

    it('alice can deleteSession her own', async () => {
        await runAs(aliceDb, queries.deleteSession(aliceSessionId));
        const rows = await runAs(aliceDb, queries.loadSession(aliceSessionId));
        expect(rows.length).toBe(0);
    });
});

describe('knowledge graph cross-user isolation', () => {
    const aliceEntity = `alice_${RUN_TAG}_entity`;

    it('alice creates an entity', async () => {
        const ts = nowIso();
        const spec = queries.buildKnowledgeInsertQuery({
            entities: [{ name: aliceEntity, embedding: FAKE_EMBEDDING }],
            relations: [],
            ts,
            local_date: ts.slice(0, 10),
            local_tz: 'UTC',
        });
        const rows = await runAs(aliceDb, spec);
        expect(rows.length).toBeGreaterThan(0);
    });

    it('bob\'s searchEntitiesByName does NOT find alice\'s entity', async () => {
        const rows = await runAs(bobDb, queries.searchEntitiesByName({
            query: `alice_${RUN_TAG}`,
            limit: 50,
        }));
        const leaked = (rows as Array<{ name: string }>).find((r) => r.name === aliceEntity);
        expect(leaked).toBeUndefined();
    });

    it('bob\'s getAllEntities does NOT include alice\'s entity', async () => {
        const rows = await runAs(bobDb, queries.getAllEntities({ limit: 200 }));
        const leaked = (rows as Array<{ name: string }>).find((r) => r.name === aliceEntity);
        expect(leaked).toBeUndefined();
    });
});

describe('user_data cross-user isolation (todos)', () => {
    let aliceTodoId: string;

    it('alice writes a todo', async () => {
        const ts = nowIso();
        const rows = await runAs(aliceDb, queries.insertTodo({
            title: `alice_${RUN_TAG}_todo`,
            description: null,
            priority: 'medium',
            category: 'test',
            due_date: null,
            recurrence: null,
            metric_link: null,
            source_text: 'cross-user-iso',
            due_at: ts,
            ts,
            local_date: ts.slice(0, 10),
            local_tz: 'UTC',
            tags: [],
        }));
        expect(rows.length).toBe(1);
        aliceTodoId = String((rows[0] as { id: unknown }).id);
    });

    it('bob\'s getTodos active does NOT include alice\'s todo', async () => {
        const rows = await runAs(bobDb, queries.getTodos({ status: 'active', limit: 100 }));
        const leaked = rows.find((r) => String((r as { id: unknown }).id) === aliceTodoId);
        expect(leaked).toBeUndefined();
    });
});

describe('insights_events root-only enforcement', () => {
    // Telemetry table — PERMISSIONS NONE means no JWT-authed user has any
    // access. Only root (which the smartchats Next.js insights writer uses)
    // can write or read. These tests prove the boundary holds.

    it('root can write an insights_events row', async () => {
        const eventId = `root_insights_${RUN_TAG}`;
        const result = (await rootDb.query(
            `CREATE type::record('insights_events', $event_id) SET event_id = $event_id, event_type = 'test', timestamp = time::now()`,
            { event_id: eventId },
        )) as unknown[];
        const rows = Array.isArray(result[0]) ? result[0] : [];
        expect(rows.length).toBe(1);
    });

    it('alice (JWT user) CANNOT read insights_events', async () => {
        // SELECT against a PERMISSIONS NONE table from a JWT'd connection
        // returns empty rows — SurrealDB silently filters them.
        const result = (await aliceDb.query(`SELECT * FROM insights_events LIMIT 10`)) as unknown[];
        expect(Array.isArray(result[0]) ? result[0] : []).toEqual([]);
    });

    it('alice (JWT user) CANNOT write to insights_events', async () => {
        // CREATE on PERMISSIONS NONE either errors or no-ops. Either way,
        // alice's attempted row must NOT land — verify root sees no new
        // event_id matching alice's attempt.
        const aliceEventId = `alice_attempt_${RUN_TAG}`;
        await aliceDb.query(
            `CREATE type::record('insights_events', $event_id) SET event_id = $event_id, event_type = 'evil_attempt'`,
            { event_id: aliceEventId },
        ).catch(() => undefined);
        // Verify via root that no row landed.
        const check = (await rootDb.query(
            `SELECT event_id FROM insights_events WHERE event_id = $event_id`,
            { event_id: aliceEventId },
        )) as Array<Array<{ event_id: string }>>;
        expect(check[0] ?? []).toEqual([]);
    });

    it('root cleanup of test events', async () => {
        const eventIds = [`root_insights_${RUN_TAG}`, `alice_attempt_${RUN_TAG}`];
        await rootDb.query(
            `DELETE FROM insights_events WHERE event_id IN $ids`,
            { ids: eventIds },
        );
    });
});

describe('apps cross-user isolation', () => {
    const aliceAppId = `alice_${RUN_TAG}_app`;

    it('alice publishes an app', async () => {
        const rows = await runAs(aliceDb, queries.insertApp({
            app_id: aliceAppId,
            name: 'Alice Test App',
            version: '1.0.0',
            description: 'cross-user iso test',
            author: { name: 'alice' },
            icon: null,
            source: 'test',
            categories: ['test'],
            tags: ['crud'],
            embedding: FAKE_EMBEDDING,
            modules: {},
            interaction_mode: 'voice',
            html_templates: [],
            display_mode: 'inline',
            state_schema: {},
            permissions: {},
            requested_functions: [],
            voice_hooks: {},
            on_activate: null,
            on_deactivate: null,
            external_scripts: [],
            migrations: [],
            min_tier: 'free',
            version_history: [],
            forked_from: null,
            _content_hash: 'hash_v1',
            published_at: nowIso(),
        }));
        expect(rows.length).toBe(1);
    });

    it('bob\'s listApps does NOT include alice\'s app', async () => {
        const rows = await runAs(bobDb, queries.listApps({ source: 'test' }));
        const leaked = rows.find((r) => (r as { app_id?: string }).app_id === aliceAppId);
        expect(leaked).toBeUndefined();
    });

    it('bob can publish an app with the SAME app_id (UNIQUE is per-owner)', async () => {
        // smartchats_apps_owner_app_id is UNIQUE on (owner, app_id) — different
        // owners can independently use the same app_id without collision.
        const rows = await runAs(bobDb, queries.insertApp({
            app_id: aliceAppId, // same id, different owner
            name: 'Bob Test App',
            version: '1.0.0',
            description: 'bob copy',
            author: { name: 'bob' },
            icon: null,
            source: 'test',
            categories: ['test'],
            tags: ['crud'],
            embedding: FAKE_EMBEDDING,
            modules: {},
            interaction_mode: 'voice',
            html_templates: [],
            display_mode: 'inline',
            state_schema: {},
            permissions: {},
            requested_functions: [],
            voice_hooks: {},
            on_activate: null,
            on_deactivate: null,
            external_scripts: [],
            migrations: [],
            min_tier: 'free',
            version_history: [],
            forked_from: null,
            _content_hash: 'hash_v1',
            published_at: nowIso(),
        }));
        expect(rows.length).toBe(1);
    });
});
