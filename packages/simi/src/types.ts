/**
 * Simi — Simulation Interface
 *
 * Type definitions for declarative test workflows.
 */

// ─── Resolvers ───────────────────────────────────────────────────────

/** Reads a dotted path from store state */
export interface StateResolver {
  $resolve: 'state';
  path: string;
}

/** Finds an item in an array at a state path */
export interface FindResolver {
  $resolve: 'find';
  path: string;
  match?: Record<string, any>;
  index?: number;
}

/** Evaluates a function against state (and optionally previous step results) */
export interface EvalResolver {
  $resolve: 'eval';
  fn: (state: any, results?: Record<string, any>) => any;
}

/** Reads the return value of a previous action step by its id/label */
export interface ResultResolver {
  $resolve: 'result';
  step: string;
  path?: string;
}

export type Resolver = StateResolver | FindResolver | EvalResolver | ResultResolver;

// ─── Steps ───────────────────────────────────────────────────────────

export interface ActionStep {
  id?: string;
  action: string;
  args?: any[];
  wait?: number;
  /** Timeout in ms for async actions. If the action's promise doesn't resolve within this window, the step fails and the workflow stops. */
  timeout?: number;
}

export interface AssertStep {
  assert: string;
  message?: string;
}

export interface WaitForStep {
  waitFor: string;
  timeout?: number;
}

export type WorkflowStep = ActionStep | AssertStep | WaitForStep;

// ─── Workflow ────────────────────────────────────────────────────────

export interface SimiWorkflow {
  id: string;
  app: string;
  tags?: string[];
  /**
   * Workflow IDs to run before this workflow's own `steps`. Setup workflows
   * must be in the same registry (same `app` / same createInsightStore).
   * Used for declarative preconditions like post-onboarding state that are
   * shared across many test workflows. Setup workflows should be idempotent
   * — running them twice in a session is a no-op on the second call.
   */
  setupWorkflows?: string[];
  steps: WorkflowStep[];
}

// ─── Execution ───────────────────────────────────────────────────────

export interface RunOpts {
  speed?: number;
  /**
   * Registry for looking up `setupWorkflows` by id. The compile-time bridge
   * in `createInsightStore` injects the full workflow registry here so the
   * runner can resolve named deps without reaching through window globals.
   */
  workflowRegistry?: Record<string, SimiWorkflow>;
}

export interface StepResult {
  step: string;
  result?: any;
  duration_ms: number;
  status: 'ok' | 'error';
  error?: string;
}

export interface RunResult {
  completed: boolean;
  workflow_id: string;
  total_ms: number;
  steps: StepResult[];
  error?: string;
}
