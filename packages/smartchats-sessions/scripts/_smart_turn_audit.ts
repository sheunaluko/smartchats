#!/usr/bin/env -S npx tsx
// Ad-hoc audit for smart_turn_* + ack_* events over the last 3 days.
// User-authorized cloud read (2026-07-20).

import { createClient } from 'smartchats-database';

const url = process.env.SMARTCHATS_CLOUD_URL!;
const user = process.env.SMARTCHATS_CLOUD_USER!;
const password = process.env.SMARTCHATS_CLOUD_PASSWORD!;

const client = createClient({
    url,
    namespace: process.env.SMARTCHATS_SESSION_NS ?? 'production',
    database: process.env.SMARTCHATS_SESSION_DB ?? 'main',
    auth: { username: user, password },
});

async function main() {
    await client.connect();
    const surreal = (client as any).db;

    async function run(label: string, q: string) {
        try {
            const res = await surreal.query(q);
            console.log(`\n=== ${label} ===`);
            const out = Array.isArray(res) ? res[res.length - 1] : res;
            console.log(JSON.stringify(out, null, 2));
        } catch (err: any) {
            console.log(`\n=== ${label} — ERROR ===`);
            console.log(err?.message ?? String(err));
        }
    }

    // 1. Which smart_turn / ack event_types exist at all over 3d
    await run('Voice event-type histogram (3d)', `
        SELECT event_type, count() AS n
        FROM insights_events
        WHERE timestamp > time::now() - 3d
        AND (event_type CONTAINS 'smart_turn' OR event_type CONTAINS 'ack_' OR event_type = 'boot_complete' OR event_type = 'voice_session_start')
        GROUP BY event_type
        ORDER BY n DESC
    `);

    // 2. Recent warmup outcomes
    await run('smart_turn_warmup_complete (latest 10)', `
        SELECT timestamp, payload.ok AS ok, payload.duration_ms AS duration_ms, payload.cached AS cached, payload.error AS error
        FROM insights_events
        WHERE event_type = 'smart_turn_warmup_complete'
        AND timestamp > time::now() - 3d
        ORDER BY timestamp DESC
        LIMIT 10
    `);

    // 3. Distribution of decisions
    await run('smart_turn_decision distribution', `
        SELECT
            count() AS total,
            math::mean(payload.probability) AS avg_probability,
            math::mean(payload.latency_ms) AS avg_latency_ms,
            math::max(payload.latency_ms) AS max_latency_ms,
            math::min(payload.latency_ms) AS min_latency_ms
        FROM insights_events
        WHERE event_type = 'smart_turn_decision'
        AND timestamp > time::now() - 3d
    `);

    // 4. Mode / complete breakdown
    await run('Mode x complete breakdown', `
        SELECT payload.mode AS mode, payload.complete AS complete, count() AS n,
               math::mean(payload.probability) AS avg_prob,
               math::mean(payload.latency_ms) AS avg_latency_ms
        FROM insights_events
        WHERE event_type = 'smart_turn_decision'
        AND timestamp > time::now() - 3d
        GROUP BY mode, complete
        ORDER BY n DESC
    `);

    // 5. Recent decision samples
    await run('Latest 15 smart_turn_decision events', `
        SELECT timestamp, payload.mode AS mode, payload.probability AS probability,
               payload.complete AS complete, payload.latency_ms AS latency_ms, payload.shadow AS shadow
        FROM insights_events
        WHERE event_type = 'smart_turn_decision'
        AND timestamp > time::now() - 3d
        ORDER BY timestamp DESC
        LIMIT 15
    `);

    // 6. Ack events
    await run('Ack event summary', `
        SELECT event_type, count() AS n
        FROM insights_events
        WHERE (event_type = 'ack_cache_warmed' OR event_type = 'ack_played' OR event_type = 'ack_skipped' OR event_type = 'ack_cache_warm_error')
        AND timestamp > time::now() - 3d
        GROUP BY event_type
    `);

    // 7. Sessions with decisions (privacy: just counts, no session ids printed)
    await run('Sessions/day count with decisions', `
        SELECT count() AS total_decisions,
               array::len(array::distinct((SELECT VALUE session_id FROM insights_events WHERE event_type = 'smart_turn_decision' AND timestamp > time::now() - 3d))) AS distinct_sessions
        FROM insights_events
        WHERE event_type = 'smart_turn_decision'
        AND timestamp > time::now() - 3d
        LIMIT 1
    `);

    await client.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
