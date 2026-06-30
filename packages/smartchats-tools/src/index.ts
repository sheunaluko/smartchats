/**
 * smartchats-tools — shared agent-tool primitives.
 *
 * Each export is a pure-I/O helper consumed by both the open
 * self-hosted /tools/* routes (smartchats-local-server) and the cloud
 * Firebase Functions of the same name. Adding a new tool here is the
 * single place — both hosts pick it up via the normal sync path.
 *
 * No framework dependencies. Helpers take an explicit env-shaped config
 * (api keys, options) and return data; each host wraps the call with its
 * own auth + billing + protocol concerns.
 */

export {
    serperSearch,
    normalizeOrganic,
    SerperError,
} from './serper_search.js';
export type {
    SerperSearchOptions,
    SerperSearchResult,
    SerperOrganicResult,
} from './serper_search.js';

export {
    extractReadableText,
    ExtractError,
} from './extract_readable_text.js';
export type {
    ExtractOptions,
    ExtractedText,
} from './extract_readable_text.js';
