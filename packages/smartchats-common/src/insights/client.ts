/**
 * InsightsClient - Unified event tracking system
 *
 * OTel-compatible event tracking for LLM invocations, executions,
 * user interactions, and errors with event chain support.
 */

import * as logger from "../logger";
import { is_browser } from "../is_browser";
import {
  InsightsEvent,
  InsightsConfig,
  InsightsBatchResponse,
  AddEventOptions,
  LLMInvocationData,
  UserInputData,
  ExecutionData,
  CommonEventTypes,
} from "./types";

const log = logger.get_logger({ id: "insights" });

/**
 * Configuration for creating a scoped insights context
 */
export interface InsightsScopeConfig {
  name: string;
  metadata?: Record<string, any>;
  tags?: string[];
}

/**
 * Internal context passed from InsightsClient to InsightsScope
 */
interface EmitContext {
  eventBatch: InsightsEvent[];
  sessionEvents: InsightsEvent[];
  app_name: string;
  app_version: string;
  user_id: string;
  session_id: string;
  enabled: boolean;
}

/**
 * Generate a unique ID with prefix
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${timestamp}${random}`;
}

/**
 * Generate session ID
 */
export function generateSessionId(): string {
  return generateId("ses");
}

/**
 * Generate event ID
 */
export function generateEventId(): string {
  return generateId("evt");
}

/**
 * Generate trace ID
 */
export function generateTraceId(): string {
  return generateId("trc");
}

/**
 * Get client info (browser only)
 */
function getClientInfo(): { user_agent: string; viewport_size: string; [key: string]: any } | undefined {
  if (!is_browser()) return undefined;

  const baseInfo: any = {
    user_agent: navigator.userAgent,
    viewport_size: `${window.innerWidth}x${window.innerHeight}`,
  };

  // Add Firebase auth data if available
  try {
    if (typeof (window as any).getAuth === 'function') {
      const auth = (window as any).getAuth();
      if (auth?.currentUser) {
        baseInfo.firebase_uid = auth.currentUser.uid || null;
        baseInfo.firebase_email = auth.currentUser.email || null;
        baseInfo.firebase_display_name = auth.currentUser.displayName || null;
      }
    }
  } catch (error) {
    // Silent failure - don't break event creation if auth fails
    console.warn('[insights] Failed to capture Firebase auth data:', error);
  }

  return baseInfo;
}

/**
 * InsightsClient class - Main client for event tracking
 */
export class InsightsClient {
  private config: Required<Omit<InsightsConfig, 'emit' | 'terminalEmit'>>
    & Pick<InsightsConfig, 'emit' | 'terminalEmit'>;
  private eventBatch: InsightsEvent[] = [];
  private sessionEvents: InsightsEvent[] = [];
  private batchTimer: any = null;
  private chainStack: Array<{ event_id: string; trace_id: string }> = [];
  private enabled: boolean = true;
  private sessionTags: string[] = [];

  constructor(config: InsightsConfig) {
    // Set defaults
    this.config = {
      app_name: config.app_name,
      app_version: config.app_version,
      user_id: config.user_id,
      session_id: config.session_id || generateSessionId(),
      endpoint: config.endpoint || "/api/insights/batch",
      emit: config.emit,
      terminalEmit: config.terminalEmit,
      batch_size: config.batch_size || 50,
      batch_interval_ms: config.batch_interval_ms || 5000,
      enabled: config.enabled !== undefined ? config.enabled : true,
      manual_flush: config.manual_flush ?? false,
    };

    this.enabled = this.config.enabled;

    log(`InsightsClient initialized for ${this.config.app_name} v${this.config.app_version}`);
    log(`Session ID: ${this.config.session_id}`);
    log(`Batch size: ${this.config.batch_size}, Interval: ${this.config.batch_interval_ms}ms`);

    // Start batch timer (skip if manual_flush — consumer calls flushBatch() explicitly)
    if (this.enabled && is_browser() && !this.config.manual_flush) {
      this.startBatchTimer();
    }
  }

  /**
   * Start the batch timer
   */
  private startBatchTimer(): void {
    if (this.batchTimer) return;

    this.batchTimer = setInterval(() => {
      if (this.eventBatch.length > 0) {
        this.flushBatch();
      }
    }, this.config.batch_interval_ms);
  }

  /**
   * Stop the batch timer
   */
  private stopBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Add a generic event
   */
  async addEvent(
    event_type: string,
    payload: Record<string, any>,
    options: AddEventOptions = {}
  ): Promise<string> {
    if (!this.enabled) {
      return generateEventId(); // Return dummy ID if disabled
    }

    try {
      const event_id = generateEventId();
      const timestamp = Date.now();

      // Determine parent_event_id and trace_id
      let parent_event_id = options.parent_event_id;
      let trace_id = options.trace_id;

      // If we're in a chain, use the top of the stack
      if (this.chainStack.length > 0) {
        const current_chain = this.chainStack[this.chainStack.length - 1];
        if (!parent_event_id) {
          parent_event_id = current_chain.event_id;
        }
        if (!trace_id) {
          trace_id = current_chain.trace_id;
        }
      }

      const event: InsightsEvent = {
        event_id,
        event_type,
        app_name: this.config.app_name,
        app_version: this.config.app_version,
        user_id: this.config.user_id,
        session_id: this.config.session_id,
        timestamp,
        payload,
        parent_event_id,
        trace_id,
        tags: options.tags,
        duration_ms: options.duration_ms,
        client_info: getClientInfo(),
      };

      // Add to batch and cumulative session log
      this.eventBatch.push(event);
      this.sessionEvents.push(event);

      // Flush if batch size reached
      if (this.eventBatch.length >= this.config.batch_size) {
        await this.flushBatch();
      }

      return event_id;
    } catch (error) {
      // Silent failure - never break the app
      log(`Error adding event: ${error}`);
      return generateEventId();
    }
  }

  /**
   * Start an event chain
   * Returns the event_id which becomes the parent for subsequent events.
   *
   * Trace propagation: if there is already an open chain (this is a nested
   * call), inherit the parent's trace_id so the whole interaction stays in
   * one trace — OTel convention. Only generate a fresh trace_id when this
   * is the outermost chain. Without this, nested cortex `agent_turn` calls
   * inside a `voice_session_start` chain would split the trace, scattering
   * what is logically one interaction across multiple trace IDs in the
   * dashboard. parent_event_id continues to express the tree structure.
   */
  async startChain(event_type: string, payload: Record<string, any>): Promise<string> {
    if (!this.enabled) {
      return generateEventId();
    }

    try {
      const parentChain = this.chainStack[this.chainStack.length - 1];
      const trace_id = parentChain?.trace_id ?? generateTraceId();
      const event_id = await this.addEvent(event_type, payload, { trace_id });

      // Push to chain stack
      this.chainStack.push({ event_id, trace_id });

      return event_id;
    } catch (error) {
      log(`Error starting chain: ${error}`);
      return generateEventId();
    }
  }

  /**
   * End the current event chain
   */
  endChain(): void {
    if (this.chainStack.length > 0) {
      this.chainStack.pop();
    }
  }

  /**
   * Add an event in the current chain
   */
  async addInChain(
    event_type: string,
    payload: Record<string, any>,
    options: AddEventOptions = {}
  ): Promise<string> {
    // addEvent will automatically use the chain stack
    return this.addEvent(event_type, payload, options);
  }

  /**
   * Convenience method: Add LLM invocation event
   */
  async addLLMInvocation(data: LLMInvocationData): Promise<string> {
    const tags = data.status === "error" ? ["error"] : [];
    if (data.latency_ms > 5000) {
      tags.push("slow");
    }

    return this.addEvent(CommonEventTypes.LLM_INVOCATION, data, {
      tags,
      duration_ms: data.latency_ms,
    });
  }

  /**
   * Convenience method: Add execution event
   */
  async addExecution(data: ExecutionData): Promise<string> {
    const tags = data.status === "error" ? ["error"] : [];
    if (data.duration_ms > 10000) {
      tags.push("slow");
    }

    return this.addEvent(CommonEventTypes.EXECUTION, data, {
      tags,
      duration_ms: data.duration_ms,
    });
  }

  /**
   * Convenience method: Add user input event
   */
  async addUserInput(data: UserInputData): Promise<string> {
    return this.addEvent(CommonEventTypes.USER_INPUT, data);
  }

  /**
   * Flush the current batch to the API endpoint
   */
  async flushBatch(): Promise<void> {
    if (this.eventBatch.length === 0) {
      return;
    }

    // Take the current batch and clear it
    const eventsToSend = [...this.eventBatch];
    this.eventBatch = [];

    try {
      await this.flushViaAPI(eventsToSend);
    } catch (error) {
      // Silent failure - log but don't throw
      log(`Error flushing batch: ${error}`);

      // Put events back in the batch to try again later
      // But limit the size to prevent infinite growth
      if (this.eventBatch.length < this.config.batch_size * 2) {
        this.eventBatch.unshift(...eventsToSend);
      }
    }
  }

  /**
   * Synchronous terminal flush for unload/crash paths. Drains the in-memory
   * batch and hands it to the injected `terminalEmit` (typically a fetch
   * with `keepalive: true` or `navigator.sendBeacon` — survives the page
   * dying immediately afterward). If no `terminalEmit` is configured, falls
   * back to fire-and-forget `flushBatch()`, which uses the normal async
   * emit path and is best-effort — the browser may abort it on hard kill.
   *
   * Returns void. Callers MUST NOT await — the whole point is sync drain.
   */
  flushTerminal(): void {
    if (this.eventBatch.length === 0) return;
    if (!this.config.terminalEmit) {
      // Fall back to the regular async flush, fire-and-forget.
      this.flushBatch().catch(() => {});
      return;
    }
    const events = [...this.eventBatch];
    this.eventBatch = [];
    try {
      this.config.terminalEmit(events);
    } catch {
      // Last-ditch: put events back in batch so a later normal flush can retry.
      this.eventBatch.unshift(...events);
    }
  }

  /**
   * Flush via injected `emit` if provided, else fallback to fetch + endpoint.
   */
  private async flushViaAPI(events: InsightsEvent[]): Promise<void> {
    let result: InsightsBatchResponse;
    if (this.config.emit) {
      log(`Flushing ${events.length} events via injected emit`);
      result = await this.config.emit(events);
    } else {
      log(`Flushing ${events.length} events to ${this.config.endpoint}`);
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      result = await response.json();
    }
    log(`Batch sent: ${result.events_stored}/${result.events_received} stored`);
    if (result.errors && result.errors.length > 0) {
      log(`Batch had errors: ${result.errors.join(", ")}`);
    }
  }

  /**
   * Manually flush and cleanup
   */
  async shutdown(): Promise<void> {
    this.stopBatchTimer();
    await this.flushBatch();
    log("InsightsClient shutdown complete");
  }

  /**
   * Add tags to the current session
   */
  addSessionTags(tags: string[]): void {
    for (const tag of tags) {
      if (!this.sessionTags.includes(tag)) {
        this.sessionTags.push(tag);
      }
    }
    this.addEvent('session_tags', { tags: this.sessionTags }, { tags: this.sessionTags });
  }

  /**
   * Get current session tags
   */
  getSessionTags(): string[] {
    return [...this.sessionTags];
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.config.session_id;
  }

  /**
   * Get current chain depth
   */
  getChainDepth(): number {
    return this.chainStack.length;
  }

  /**
   * Export cumulative session data (never cleared by flushBatch)
   */
  exportSession() {
    return {
      session_id: this.config.session_id,
      app_name: this.config.app_name,
      tags: [...this.sessionTags],
      events: [...this.sessionEvents],
      exported_at: Date.now(),
    };
  }

  /**
   * Enable/disable event tracking
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled && is_browser() && !this.config.manual_flush) {
      this.startBatchTimer();
    } else {
      this.stopBatchTimer();
    }
  }

  /**
   * Internal: expose context for InsightsScope
   */
  _getEmitContext(): EmitContext {
    return {
      eventBatch: this.eventBatch,
      sessionEvents: this.sessionEvents,
      app_name: this.config.app_name,
      app_version: this.config.app_version,
      user_id: this.config.user_id,
      session_id: this.config.session_id,
      enabled: this.enabled,
    };
  }

  /**
   * Create a scoped insights context with its own trace and chain stack
   */
  createScope(config: InsightsScopeConfig): InsightsScope {
    const currentTrace = this.chainStack.length > 0
      ? this.chainStack[this.chainStack.length - 1].trace_id
      : undefined;
    return new InsightsScope(this._getEmitContext(), config, currentTrace);
  }
}

/**
 * InsightsScope — Parallel-safe scoped telemetry context
 *
 * Owns its own trace_id and chainStack but writes to the parent's
 * shared eventBatch for unified flushing.
 */
export class InsightsScope {
  private ctx: EmitContext;
  private scopeConfig: InsightsScopeConfig;
  private trace_id: string;
  private parentTraceId?: string;
  private chainStack: Array<{ event_id: string; trace_id: string }> = [];
  private startedAt: number;

  constructor(ctx: EmitContext, scopeConfig: InsightsScopeConfig, parentTraceId?: string) {
    this.ctx = ctx;
    this.scopeConfig = scopeConfig;
    this.trace_id = generateTraceId();
    this.parentTraceId = parentTraceId;
    this.startedAt = Date.now();

    // Emit scope_start event
    this.addEvent('scope_start', {
      scope_name: scopeConfig.name,
      metadata: scopeConfig.metadata,
      parent_trace_id: parentTraceId,
    });
  }

  async addEvent(
    event_type: string,
    payload: Record<string, any>,
    options: AddEventOptions = {}
  ): Promise<string> {
    if (!this.ctx.enabled) {
      return generateEventId();
    }

    try {
      const event_id = generateEventId();
      const timestamp = Date.now();

      let parent_event_id = options.parent_event_id;
      let trace_id = options.trace_id || this.trace_id;

      if (this.chainStack.length > 0) {
        const current_chain = this.chainStack[this.chainStack.length - 1];
        if (!parent_event_id) {
          parent_event_id = current_chain.event_id;
        }
        if (!options.trace_id) {
          trace_id = current_chain.trace_id;
        }
      }

      // Merge scope metadata into payload
      const scopedPayload = {
        ...payload,
        scope_name: this.scopeConfig.name,
        scope_metadata: this.scopeConfig.metadata,
      };

      // Merge scope tags with event tags
      const mergedTags = [
        ...(this.scopeConfig.tags || []),
        ...(options.tags || []),
      ];

      const event: InsightsEvent = {
        event_id,
        event_type,
        app_name: this.ctx.app_name,
        app_version: this.ctx.app_version,
        user_id: this.ctx.user_id,
        session_id: this.ctx.session_id,
        timestamp,
        payload: scopedPayload,
        parent_event_id,
        trace_id,
        tags: mergedTags.length > 0 ? mergedTags : undefined,
        duration_ms: options.duration_ms,
        client_info: getClientInfo(),
      };

      this.ctx.eventBatch.push(event);
      this.ctx.sessionEvents.push(event);
      return event_id;
    } catch (error) {
      log(`Error adding scoped event: ${error}`);
      return generateEventId();
    }
  }

  async startChain(event_type: string, payload: Record<string, any>): Promise<string> {
    if (!this.ctx.enabled) {
      return generateEventId();
    }

    try {
      // Within a scope, nested chains inherit the scope-level trace_id
      // (or any prior nested-chain trace_id). Same OTel-convention
      // propagation rule as InsightsClient.startChain — see comment there.
      const parentChain = this.chainStack[this.chainStack.length - 1];
      const chain_trace_id = parentChain?.trace_id ?? this.trace_id;
      const event_id = await this.addEvent(event_type, payload, {
        trace_id: chain_trace_id,
      });

      this.chainStack.push({ event_id, trace_id: chain_trace_id });
      return event_id;
    } catch (error) {
      log(`Error starting scoped chain: ${error}`);
      return generateEventId();
    }
  }

  endChain(): void {
    if (this.chainStack.length > 0) {
      this.chainStack.pop();
    }
  }

  async addLLMInvocation(data: LLMInvocationData): Promise<string> {
    const tags = data.status === "error" ? ["error"] : [];
    if (data.latency_ms > 5000) {
      tags.push("slow");
    }
    return this.addEvent(CommonEventTypes.LLM_INVOCATION, data, {
      tags,
      duration_ms: data.latency_ms,
    });
  }

  async addExecution(data: ExecutionData): Promise<string> {
    const tags = data.status === "error" ? ["error"] : [];
    if (data.duration_ms > 10000) {
      tags.push("slow");
    }
    return this.addEvent(CommonEventTypes.EXECUTION, data, {
      tags,
      duration_ms: data.duration_ms,
    });
  }

  async addUserInput(data: UserInputData): Promise<string> {
    return this.addEvent(CommonEventTypes.USER_INPUT, data);
  }

  createScope(config: InsightsScopeConfig): InsightsScope {
    return new InsightsScope(this.ctx, config, this.trace_id);
  }

  end(): void {
    this.addEvent('scope_end', {
      duration_ms: Date.now() - this.startedAt,
    });
  }
}

/**
 * Singleton instance for default client
 */
let defaultClient: InsightsClient | null = null;

/**
 * Create a new InsightsClient
 */
export function createClient(config: InsightsConfig): InsightsClient {
  return new InsightsClient(config);
}

/**
 * Get or create the default client
 */
export function getDefaultClient(): InsightsClient {
  if (!defaultClient) {
    throw new Error(
      "Default InsightsClient not initialized. Call createClient() first or set defaultClient."
    );
  }
  return defaultClient;
}

/**
 * Set the default client
 */
export function setDefaultClient(client: InsightsClient): void {
  defaultClient = client;
}

/**
 * Export all types for convenience
 */
export * from "./types";
