/**
 * Cross-environment user-data operations — backend-agnostic functions
 * that take a `SmartChatsBackend` instance and read/write the user's
 * SmartChats data via `backend.data.query`. Same code path works for
 * cloud (FirebaseBackend) and local (LocalBackend); ownership/auth is
 * resolved by the backend implementation.
 */

export { importBundle } from './import_bundle.js';
export type { ImportOptions, ImportProgress, ImportResult } from './import_bundle.js';

export { exportBundle } from './export_bundle.js';
export type { ExportOptions, ExportProgress, ExportResult } from './export_bundle.js';

export type { Bundle } from './types.js';
export {
    DEFAULT_EXPORT_TABLES,
    SENSITIVE_TABLES,
    NEVER_EXPORT_TABLES,
} from './types.js';
