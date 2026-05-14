import type { LLMCallArgs } from '../types.js';

/**
 * Translate client-facing camelCase LLMCallArgs into the server wire payload.
 * Synthesizes `text_format` from `schema` + `schema_name`, drops undefined keys.
 * Forwards a `warmup: true` flag when present so runners that poke the stream
 * endpoint with a sentinel-warmup args object (rather than using the separate
 * `warmup()` method on LLMAPI) hit the fast path server-side instead of
 * tripping the "model and input are required" validator.
 * Any adapter hitting an HTTP LLM endpoint can reuse this.
 */
export function toServerArgs(args: LLMCallArgs & { warmup?: boolean }): Record<string, unknown> {
    const server: Record<string, unknown> = {
        model: args.model,
        input: args.input,
        max_tokens: args.max_tokens,
        temperature: args.temperature,
        session_id: args.session_id,
    };
    if (args.schema && args.schema_name) {
        server.text_format = {
            type: 'json_schema',
            name: args.schema_name,
            strict: true,
            schema: args.schema,
        };
    }
    if (args.warmup) server.warmup = true;
    for (const k of Object.keys(server)) if (server[k] === undefined) delete server[k];
    return server;
}
