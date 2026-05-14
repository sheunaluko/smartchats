/**
 * App Platform — Permission System
 *
 * Maps permissions to tiers, defines defaults by source,
 * and maps Util methods + cortex functions to required permissions.
 */

import type { AppPermission, AppSource } from '../../core/types/app'

// ── Permission Tiers (0 = safe, 3 = dangerous) ──

export const PERMISSION_TIERS: Record<AppPermission, number> = {
  'display': 0,
  'workspace:read': 0,
  'workspace:write': 0,
  'data:read': 1,
  'voice:tts': 1,
  'voice:mic': 1,
  'search:web': 1,
  'data:write': 2,
  'functions:dynamic': 2,
  'process:spawn': 2,
  'system:appearance': 2,
  'llm:call': 2,
  'data:raw_query': 3,
}

// ── Default Grants by Source ──

export const DEFAULT_GRANTS: Record<AppSource, AppPermission[]> = {
  builtin: Object.keys(PERMISSION_TIERS) as AppPermission[],
  agent: ['display', 'workspace:read', 'workspace:write'],
  community: ['display'],
}

// ── Util Method → Permission Mapping ──
// Methods not listed here are tier 0 (always available): log, feedback

export const UTIL_TO_PERMISSION: Record<string, AppPermission> = {
  'update_workspace': 'workspace:write',
  'get_workspace': 'workspace:read',
  'user_output': 'voice:tts',
  'get_user_input': 'voice:mic',
  'get_embedding': 'data:read',
  'call_llm': 'llm:call',
  'query': 'data:raw_query',
}

// ── Cortex Function → Permission Mapping ──

export const FUNCTION_TO_PERMISSION: Record<string, AppPermission> = {
  // data:read
  get_metrics: 'data:read',
  get_logs: 'data:read',
  get_recent_logs: 'data:read',
  search_logs: 'data:read',
  get_log_categories: 'data:read',
  retrieve_declarative_knowledge: 'data:read',
  get_knowledge_graph_entities: 'data:read',
  get_entity_detail: 'data:read',
  search_knowledge: 'data:read',
  list_todos: 'data:read',
  get_todos_context: 'data:read',

  // data:write
  save_metric: 'data:write',
  add_log: 'data:write',
  update_log: 'data:write',
  store_declarative_knowledge: 'data:write',
  delete_declarative_knowledge: 'data:write',
  create_todo: 'data:write',
  update_todo: 'data:write',
  save_todo: 'data:write',
  manage_todo: 'data:write',

  // data:raw_query
  query_db: 'data:raw_query',
  store_to_db: 'data:raw_query',

  // functions:dynamic
  create_dynamic_function: 'functions:dynamic',
  load_dynamic_function: 'functions:dynamic',
  list_dynamic_functions: 'functions:dynamic',

  // process:spawn
  fork_process: 'process:spawn',

  // search:web
  search_web: 'search:web',

  // system:appearance
  set_design_pack: 'system:appearance',
}

// ── Helpers ──

/** Returns permissions that need explicit user consent (beyond source defaults) */
export function getRequiredConsent(requested: AppPermission[], source: AppSource): AppPermission[] {
  const defaults = DEFAULT_GRANTS[source]
  return requested.filter(p => !defaults.includes(p))
}

export function isPermissionGranted(permission: AppPermission, granted: AppPermission[]): boolean {
  return granted.includes(permission)
}

/** Filter requested cortex function names to only those allowed by granted permissions */
export function filterGrantedFunctions(
  requested: string[],
  granted: AppPermission[]
): string[] {
  return requested.filter(fnName => {
    const required = FUNCTION_TO_PERMISSION[fnName]
    return !required || granted.includes(required)
  })
}

/** Build the list of Util method names granted to an app */
export function buildGrantedUtilMethods(granted: AppPermission[]): string[] {
  const methods: string[] = ['log', 'feedback'] // always available
  for (const [method, perm] of Object.entries(UTIL_TO_PERMISSION)) {
    if (granted.includes(perm)) {
      methods.push(method)
    }
  }
  return methods
}
