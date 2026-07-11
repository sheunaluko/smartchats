/**
 * Record-id normalization at the LLM tool-call boundary.
 *
 * SurrealDB record ids arrive at the app in one of three shapes depending
 * on the code path:
 *
 *   • `RecordId` class instance — local WebSocket SDK path. `toString()`
 *     returns the canonical `"table:key"` form.
 *   • Plain `{ tb, id }` object — post-JSON round-trip via the cloud
 *     Firebase function path (the SDK's Jsonify layer flattens classes
 *     back to plain objects).
 *   • String — already canonical, e.g. from a previous roundtrip.
 *
 * `stringifyRecordId` collapses all three into a `"table:key"` string
 * before we hand the value to the LLM. `parseRecordIdArg` validates the
 * reverse direction: an id supplied by the LLM as a tool argument must
 * be a non-empty string, otherwise the downstream query builders
 * (`.includes(':')` on `args.recordId`) throw a TypeError.
 */

export function stringifyRecordId(id: unknown): string | null {
    if (id == null) return null;
    if (typeof id === 'string') return id;
    if (typeof id === 'object') {
        const str = String(id);
        if (str && str !== '[object Object]') return str;
        const o = id as { tb?: unknown; id?: unknown };
        if (typeof o.tb === 'string' && o.id != null) return `${o.tb}:${String(o.id)}`;
    }
    return null;
}

export function parseRecordIdArg(input: unknown): string | null {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    return trimmed.length > 0 ? trimmed : null;
}
