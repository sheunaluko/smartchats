/**
 * Workflow partitions for the parallel Simi runner.
 *
 * PARALLEL_SAFE workflows don't mutate user-scoped state — multiple
 * workers can run them concurrently against the same Firebase user
 * without interfering. RACE_PRONE workflows write settings, sessions,
 * KG data, or BYO keys; they must run serially within a single worker
 * until per-worker Firebase users are provisioned (phase 3).
 *
 * Categorization is conservative: when in doubt, list as RACE_PRONE.
 * Promote a workflow to PARALLEL_SAFE after confirming it doesn't
 * persist user-scoped state to a backend that other workflows read.
 */

export type WorkflowDef = {
  name: string;
  bridge: '__smartchats__' | '__smartchats_billing__';
  /** When true, the workflow is skipped against backends without billing (LocalBackend). */
  requiresBilling?: boolean;
};

export const PARALLEL_SAFE: WorkflowDef[] = [
  // ── LLM round-trips, no persisted user state ──
  { name: 'basic_chat_flow', bridge: '__smartchats__' },
  { name: 'model_switch_flow', bridge: '__smartchats__' },
  { name: 'multi_turn_context_flow', bridge: '__smartchats__' },
  { name: 'code_execution_flow', bridge: '__smartchats__' },
  { name: 'workspace_update_flow', bridge: '__smartchats__' },
  { name: 'html_display_flow', bridge: '__smartchats__' },
  { name: 'clear_and_resume_flow', bridge: '__smartchats__' },
  { name: 'rapid_message_flow', bridge: '__smartchats__' },
  { name: 'agent_delegation_flow', bridge: '__smartchats__' },
  { name: 'breathing_app_flow', bridge: '__smartchats__' },
  { name: 'auth_guard_flow', bridge: '__smartchats__' },
  { name: 'time_shift_metric_flow', bridge: '__smartchats__' },
  { name: 'boolean_metrics_flow', bridge: '__smartchats__' },
  { name: 'app_lifecycle_flow', bridge: '__smartchats__' },
  { name: 'canary_sweep_flow', bridge: '__smartchats__' },
  { name: 'log_explorer_flow', bridge: '__smartchats__' },
  { name: 'metrics_explorer_flow', bridge: '__smartchats__' },
  { name: 'auto_metrics_explorer_flow', bridge: '__smartchats__' },
  { name: 'auto_todo_flow', bridge: '__smartchats__' },
  { name: 'auto_kg_explorer_flow', bridge: '__smartchats__' },
  { name: 'complete_onboarding', bridge: '__smartchats__' },

  // ── Read-only billing fetches ──
  { name: 'usage_fetch_flow', bridge: '__smartchats_billing__' },
];

export const RACE_PRONE: WorkflowDef[] = [
  // ── Writes user-scoped settings/state ──
  { name: 'settings_persistence_flow', bridge: '__smartchats__' },
  { name: 'kg_settings_flow', bridge: '__smartchats__' },
  { name: 'storage_mode_switch_flow', bridge: '__smartchats__' },
  { name: 'session_save_load_flow', bridge: '__smartchats__' },
  { name: 'seed_test_data_flow', bridge: '__smartchats__' },
  { name: 'knowledge_graph_flow', bridge: '__smartchats__' },

  // ── Writes billing/credentials state ──
  { name: 'balance_fetch_flow', bridge: '__smartchats_billing__', requiresBilling: true },
  { name: 'byo_key_lifecycle_flow', bridge: '__smartchats_billing__' },
];
