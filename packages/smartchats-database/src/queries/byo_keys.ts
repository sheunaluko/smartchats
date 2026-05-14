/**
 * BYO API key query builders.
 *
 * The `byo_api_keys` table stores user-configured provider API keys
 * (OpenAI, Anthropic, Google) for the local self-hosted deployment.
 * Records are keyed by provider name — one row per provider — so all
 * mutations target `byo_api_keys:<provider>` directly.
 *
 * Note: env-var keys (SMARTCHATS_<P>_API_KEY / <P>_API_KEY) take
 * precedence at call time and are NOT stored here. See keys.ts route
 * for the full resolution order.
 */

import type { QuerySpec } from '../types.js';

/**
 * SELECT the API key for a single provider. Returns at most one row
 * (`{ api_key }`). LIMIT 1 is belt-and-suspenders — provider is the
 * record key, so there is always exactly one row per provider at most.
 */
export function getByoKey(provider: string): QuerySpec {
    return {
        query: `SELECT api_key FROM byo_api_keys WHERE provider = $provider LIMIT 1`,
        variables: { provider },
    };
}

/**
 * UPSERT a provider's API key. The provider name is also used as the
 * record key (`byo_api_keys:<provider>`), so this creates or replaces
 * the single row for that provider in one statement. Bumps `updated_at`.
 */
export function upsertByoKey(args: { provider: string; key: string }): QuerySpec {
    return {
        query: `UPSERT type::record('byo_api_keys', $provider) SET provider = $provider, api_key = $key, updated_at = time::now()`,
        variables: { provider: args.provider, key: args.key },
    };
}

/**
 * DELETE the row for a single provider.
 */
export function deleteByoKey(provider: string): QuerySpec {
    return {
        query: `DELETE type::record('byo_api_keys', $provider)`,
        variables: { provider },
    };
}
