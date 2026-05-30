#!/usr/bin/env node
/**
 * smartchats-local-server CLI entrypoint.
 */

import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { connectSurreal, initSchema } from './surreal.js';
import { log } from './logger.js';

// Keep the process alive on provider-level failures we can't reach from the
// route handlers. Background pumps inside @google/genai (and similar SDKs)
// can throw on fire-and-forget code paths that don't propagate to our
// `for await` try/catch in routes/llm.ts; those manifest as
// uncaughtException / unhandledRejection at the process level. Default
// Node behavior would terminate; we log and continue so a single bad
// upstream response can't take the whole local-server down. The route
// handlers still surface the error to the client via the NDJSON `error`
// frame — this only catches the leak.
process.on('uncaughtException', (err) => {
    log.error(`uncaughtException (process survived): ${err?.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
    log.error(`unhandledRejection (process survived): ${msg}`);
});

async function main() {
    const config = loadConfig();

    log.box(`smartchats-local-server  http://${config.host}:${config.port}`);

    if (config.apiKey) {
        log.info('auth: SMARTCHATS_API_KEY set — bearer token required on every request');
    } else {
        log.info('auth: none (trusted local mode — set SMARTCHATS_API_KEY to enable)');
    }

    log.info(`surreal: ${config.surreal.url} ns=${config.surreal.namespace} db=${config.surreal.database}`);

    const providers = (Object.entries(config.providerEnvKeys) as Array<[string, string | null]>)
        .filter(([, v]) => v)
        .map(([k]) => k);
    if (providers.length > 0) {
        log.success(`providers from env: ${providers.join(', ')}`);
    } else {
        log.warn('no provider keys in env — LLM/TTS calls will require DB-stored keys');
    }

    // Connect to SurrealDB + apply schema
    try {
        const db = await connectSurreal(config.surreal);
        await initSchema(db);
    } catch (err) {
        log.error(`failed to connect or init schema: ${(err as Error).message}`);
        process.exit(1);
    }

    const app = createApp(config);
    app.listen(config.port, config.host, () => {
        log.success('ready');
    });
}

main().catch((err) => {
    log.error(err);
    process.exit(1);
});
