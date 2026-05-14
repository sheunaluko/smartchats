/**
 * Self-hosted server config. All values come from env vars with sensible
 * defaults; first-run experience is "docker compose up" or `npx smartchats`
 * with zero config if the user only wants to run against a local SurrealDB
 * and OpenAI with `OPENAI_API_KEY` already set.
 */

import { SMARTCHATS_DEFAULT_LOCAL_PORT } from 'smartchats-backend';

export interface ServerConfig {
    port: number;
    host: string;
    /** When set, server requires `Authorization: Bearer <apiKey>`. */
    apiKey: string | null;

    surreal: {
        url: string;
        namespace: string;
        database: string;
        user: string;
        password: string;
    };

    /** Resolution order per provider: SMARTCHATS_<PROV>_API_KEY → <PROV>_API_KEY → DB-stored → none. */
    providerEnvKeys: {
        openai: string | null;
        anthropic: string | null;
        google: string | null;
        serper: string | null;
    };
}

function envKey(smartchatsName: string, ...fallbackNames: string[]): string | null {
    if (process.env[smartchatsName]) return process.env[smartchatsName]!;
    for (const name of fallbackNames) {
        if (process.env[name]) return process.env[name]!;
    }
    return null;
}

export function loadConfig(): ServerConfig {
    return {
        port: parseInt(process.env.SMARTCHATS_PORT ?? String(SMARTCHATS_DEFAULT_LOCAL_PORT), 10),
        host: process.env.SMARTCHATS_HOST ?? '127.0.0.1',
        apiKey: process.env.SMARTCHATS_API_KEY ?? null,
        surreal: {
            url: process.env.SURREAL_URL ?? 'ws://127.0.0.1:8000/rpc',
            namespace: process.env.SURREAL_NS ?? 'smartchats',
            database: process.env.SURREAL_DB ?? 'main',
            user: process.env.SURREAL_USER ?? 'root',
            password: process.env.SURREAL_PASSWORD ?? 'root',
        },
        providerEnvKeys: {
            openai: envKey('SMARTCHATS_OPENAI_API_KEY', 'OPENAI_API_KEY'),
            anthropic: envKey('SMARTCHATS_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'),
            // Google's Gemini API is the provider here; accept either the
            // Google-namespaced env var or the GEMINI_API_KEY name the SDK +
            // Google's docs most commonly use.
            google: envKey('SMARTCHATS_GOOGLE_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'),
            serper: envKey('SMARTCHATS_SERPER_API_KEY', 'SERPER_API_KEY'),
        },
    };
}
