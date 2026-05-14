/**
 * smartchats-common — shared utility primitives for the SmartChats workspace.
 *
 * Everything here is:
 *   - pure / infrastructure (no business logic, no backend coupling)
 *   - usable from any other workspace package without creating cycles
 *   - the single canonical home (consolidation target for any duplicated util)
 */

// Logger — diagnostic surface exposed as a namespace so callers can do
// `logger.get_logger({ id: ... })`, `logger.simi_debug(...)`, etc.
export * as logger from './logger.js';

// Pure utilities
export * as fp from './fp.js';
export * as debug from './debug.js';
export * as sounds from './sounds.js';
export { m2f } from './midi2freq.js';
export { is_browser } from './is_browser.js';

// (Phase 9.1) SurrealDB connection helper removed — direct surrealdb access
// is consolidated in `smartchats-database` (only `client.ts` imports the SDK).
// Callers use `createClient` / `createLazyClient` / `createUserClient` from
// `smartchats-database` instead of the old `surreal.connect_to_surreal`.

// Insights (telemetry client + types).
export * as insights from './insights/index.js';

// AppData store — pluggable storage abstraction (LocalStorage / SurrealDB).
export * from './app_data_store.js';

// createInsightStore — Zustand factory with insight auto-instrumentation.
export { createInsightStore } from './insights/createInsightStore.js';
export type { InsightStoreConfig, InsightStoreApi } from './insights/createInsightStore.js';
