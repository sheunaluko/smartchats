/**
 * SmartChatsBackend — typed interface contract for all backend operations.
 *
 * Three planned implementations:
 *   - FirebaseBackend: wraps existing cloud functions (closed, smartchats-cloud)
 *   - LocalBackend:    Express/Fastify + SurrealDB in docker, BYO keys, single user
 *   - CustomBackend:   user-provided endpoint implementing this interface
 *
 * Principles:
 *   - Streaming-only for LLM + TTS (no one-shot fallbacks)
 *   - Stateless contract: no event subscriptions; billing envelopes returned in method results
 *   - Auth is NOT part of this interface — handled client-side (Firebase Auth SDK or local flag).
 *     Backend implementations obtain bearer tokens internally at construction time.
 *   - Capabilities flag gates UI (billing panel, checkout, etc.)
 *   - Database schema init + health checks are first-class (required for CI and onboarding).
 *     Each backend ships its own schema definitions — cloud uses per-user scoped tables
 *     with SurrealDB record-auth permissions; local uses flat single-user tables.
 *   - Embeddings API only generates vectors. Storage/retrieval is done client-side
 *     via the data layer against tables with HNSW vector indexes.
 */

// ============================================================================
// Capabilities
// ============================================================================

export interface BackendCapabilities {
  /** Credit/tier billing active — show billing UI, checkout, subscriptions. */
  billing: boolean;
  /** Server-side BYO API key management. */
  byoKeys: boolean;
  embeddings: boolean;
  /** Web search tool (Serper or equivalent). */
  search: boolean;
  /** URL fetch + readability parsing. */
  urlFetch: boolean;
  /** Telemetry ingestion for bin/save_session. */
  insights: boolean;
}

// ============================================================================
// Root interface
// ============================================================================

export interface SmartChatsBackend {
  readonly capabilities: BackendCapabilities;
  /** Identifier for diagnostics: "firebase" | "local" | user-defined. */
  readonly id: string;

  readonly llm: LLMAPI;
  readonly tts: TTSAPI;
  readonly embeddings: EmbeddingsAPI;
  readonly data: DataAPI;
  readonly usage: UsageAPI;        // always available (local tracks too)
  readonly keys: KeysAPI;          // BYO keys — both modes
  readonly billing: BillingAPI;    // methods throw 'not_supported' if !capabilities.billing
  readonly tools: ToolsAPI;
  readonly insights: InsightsAPI;

  /** Aggregate health probe — feeds CI + onboarding diagnostics. */
  health(): Promise<HealthReport>;
}

export interface HealthReport {
  ok: boolean;
  id: string;
  checks: Record<string, { ok: boolean; latency_ms?: number; error?: string }>;
}

// ============================================================================
// LLM — streaming only
// ============================================================================

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCallArgs {
  model: string;
  input: LLMMessage[];
  max_tokens?: number;
  temperature?: number;
  /** JSON schema for structured output (OpenAI response_format / Anthropic tool_use). */
  schema?: object;
  schema_name?: string;
  session_id?: string;
  signal?: AbortSignal;
}

export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
}

export interface LLMCallResult {
  output_text: string;
  usage: LLMUsage;
  model: string;
  provider: string;
  finish_reason: string;
  latency_ms: number;
  billing?: BillingEnvelope;
}

export interface LLMStreamResult {
  stream: AsyncIterable<string>;    // text deltas
  done: Promise<LLMCallResult>;     // final result + billing
}

/** Combined LLM + TTS stream — interleaved typed events, matching wire format.
 *
 * Sentence boundaries are preserved: each utterance gets an `audio_start`,
 * one or more `audio` chunks (ordered by `chunk`), then an `audio_end`.
 * Stream-level completion is signaled by the `done` promise resolving —
 * no separate aggregate `audio_end` event. */
export type LLMTTSEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'text_end' }
  | { kind: 'audio_start'; sentence: number; text?: string }
  | { kind: 'audio'; pcm: ArrayBuffer; sentence: number; chunk: number }
  | { kind: 'audio_end'; sentence: number };

export interface LLMTTSExtras {
  voice: string;
  speed?: number;
  /** gpt-4o-mini-tts voice style directive. */
  instructions?: string;
}

export interface LLMTTSDoneInfo {
  llm: LLMCallResult;
  tts: { total_chunks: number; latency_ms: number };
  latency_ms: number;
  billing?: BillingEnvelope;
}

export interface LLMTTSStreamResult {
  stream: AsyncIterable<LLMTTSEvent>;
  done: Promise<LLMTTSDoneInfo>;
}

export interface LLMAPI {
  stream(args: LLMCallArgs): Promise<LLMStreamResult>;
  streamWithTTS(args: LLMCallArgs & LLMTTSExtras): Promise<LLMTTSStreamResult>;
  /** Best-effort cold-start mitigation — pings both LLM endpoints with `warmup:true`.
   *  Errors are swallowed. Safe to call on app idle / page load. */
  warmup?(): Promise<void>;
}

// ============================================================================
// TTS — gpt-4o-mini-tts only (supports all voices)
// ============================================================================

export interface TTSArgs {
  text: string;
  voice: string;
  speed?: number;
  instructions?: string;
  session_id?: string;
  signal?: AbortSignal;
}

export interface TTSAudioChunk {
  /** PCM 16-bit signed LE, 24kHz, mono. */
  pcm: ArrayBuffer;
  index: number;
}

export interface TTSDoneInfo {
  latency_ms: number;
  total_chunks: number;
  billing?: BillingEnvelope;
}

export interface TTSStreamResult {
  stream: AsyncIterable<TTSAudioChunk>;
  done: Promise<TTSDoneInfo>;
}

export interface TTSAPI {
  stream(args: TTSArgs): Promise<TTSStreamResult>;
  /** Keeps container warm without doing work. Optional, may no-op on Local. */
  warmup?(): Promise<void>;
}

// ============================================================================
// Embeddings — generate vectors only. Storage + retrieval is client-side via DataAPI.
// ============================================================================

export interface EmbedArgs {
  text: string;
  dimensions?: number;
  model?: string;
  session_id?: string;
}

export interface EmbedResult {
  embedding: number[];
  model: string;
  dimensions: number;
  billing?: BillingEnvelope;
}

export interface EmbeddingsAPI {
  embed(args: EmbedArgs): Promise<EmbedResult>;
}

// ============================================================================
// Data (SurrealDB-backed)
// ============================================================================
// Cloud: per-user scoped tables with SurrealDB record-auth permissions.
// Local: flat single-user tables, no owner scoping.
// The query() interface is identical in both — schema definitions differ.
// Each backend ships its own SurrealQL DDL internally, including HNSW vector
// indexes on embedding fields where the client code needs semantic search.
// ============================================================================

export interface DataQueryArgs {
  query: string;
  variables?: Record<string, unknown>;
}

export interface DataStatementResult {
  /** 'OK' on success; statement-level error strings live in `result`. */
  status: string;
  result: unknown;
  time?: string;
}

export interface DataQueryResult<T = unknown> {
  /** Rows from the first statement — common case. */
  rows: T[];
  /** All statements in order. Use for multi-statement queries (raw SurrealQL gateway). */
  statements: DataStatementResult[];
}

export interface DataHealthReport {
  /** Aggregate ok — true iff every required table is reachable. */
  ok: boolean;
  latency_ms: number;
  /** Per required table: reachable under the current auth, or an error message. */
  tables: Record<string, { ok: boolean; error?: string }>;
}

export interface DataAPI {
  query<T = unknown>(args: DataQueryArgs): Promise<DataQueryResult<T>>;

  /**
   * Probe DB connectivity + run a minimal query against each required table.
   * Schema provisioning is a devops concern (not part of the runtime interface) —
   * see the `smartchats-cloud` devops tool for cloud, and the local backend's
   * startup routine for local installs.
   */
  healthCheck(): Promise<DataHealthReport>;
}

/**
 * Tables SmartChats expects to exist in both cloud and local deployments.
 * Cloud schemas are closed-source (lives in smartchats-cloud); local
 * schemas ship with LocalBackend. This list is the shared contract —
 * backends assume every table here exists when the app runs.
 */
export const SMARTCHATS_REQUIRED_TABLES = [
  'logs',
  'user_entities',
  'user_relations',
  'app_data',
  'metrics',
  'smartchats_apps',
  'smartchats_app_installs',
  'insights_events',
] as const;

export type SmartChatsTable = typeof SMARTCHATS_REQUIRED_TABLES[number];

/**
 * Default port for the self-hosted SmartChats local server. Shared by the
 * server (default bind) and the client bootstrap (default target URL) so
 * the zero-config case "just works" without env vars.
 */
export const SMARTCHATS_DEFAULT_LOCAL_PORT = 4242;

/** Default fully-qualified URL for the local server (localhost + default port). */
export const SMARTCHATS_DEFAULT_LOCAL_URL = `http://localhost:${SMARTCHATS_DEFAULT_LOCAL_PORT}`;

// ============================================================================
// Usage — always available (local tracks tokens + cost with creditsCharged: 0)
// ============================================================================

export interface UsageRecord {
  /**
   * Logical timestamp of the call. ISO datetime string. App- or
   * server-stamped at write time. Carries through export/import — the field
   * Firebase used to call `timestamp` is exposed here as `lts` so cloud and
   * local backends produce structurally identical records. See the dual-field
   * invariant doc in `smartchats-local-server/src/schema.ts`.
   */
  lts: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  creditsCharged: number;                              // 0 in local mode
  chargedFrom: 'period' | 'purchased' | 'byo_key';
}

export interface PeriodSummary {
  totalCreditsUsed: number;
  totalCostUsd: number;
  requestCount: number;
  /** Up to 5 most-used models this period, sorted by credits. */
  topModels: Array<{ model: string; credits: number; count: number }>;
}

export interface UsageSummaryModelStats {
  model: string;
  credits: number;
  count: number;
  tokens: number;
}

export interface UsagePurchase {
  type: string;
  amount: number;
  note: string | null;
  /** Epoch ms. */
  timestamp: number;
}

export interface UsageSummary {
  totalCredits: number;
  requestCount: number;
  /** Per-model usage within the window, sorted by credits desc. */
  models: UsageSummaryModelStats[];
  /** Credit purchases / subscription grants within the window. */
  purchases: UsagePurchase[];
}

export interface UsageAPI {
  getRecords(args?: { limit?: number; startAfter?: string; periodOnly?: boolean }): Promise<{
    records: UsageRecord[];
    hasMore: boolean;
    periodSummary?: PeriodSummary;
  }>;
  /** `since` is an ISO timestamp. */
  getSummary(args: { since: string }): Promise<UsageSummary>;
}

// ============================================================================
// Keys — BYO API keys (local + cloud)
// ============================================================================

export type LLMProvider = 'openai' | 'anthropic' | 'google';

/** Canonical list of LLM providers, in the order used by UI + iteration. */
export const LLM_PROVIDERS: readonly LLMProvider[] = ['openai', 'anthropic', 'google'] as const;

export interface BYOKeys {
  openai?: string;
  anthropic?: string;
  google?: string;
}

/** For each provider: `null` if no key configured, otherwise a short masked preview
 *  (e.g. `sk-****1234`) safe for display. Full keys are never returned to the client. */
export type BYOKeyPreviews = Record<LLMProvider, string | null>;

export interface KeysAPI {
  save(keys: BYOKeys): Promise<{ configured: LLMProvider[] }>;
  delete(provider: LLMProvider): Promise<void>;
  /** Returns the masked previews so UI can render e.g. "sk-****1234 Active". */
  getConfigured(): Promise<BYOKeyPreviews>;
}

// ============================================================================
// Billing — cloud only (capabilities.billing === true)
// ============================================================================

export type Tier = 'free' | 'intro' | 'basic' | 'pro' | 'max';

export interface BillingBalance {
  tier: Tier;
  tierName: string;
  monthlyCredits: number;
  periodCredits: number;
  purchasedCredits: number;
  totalAvailable: number;
  periodStart: string;
  periodEnd: string;
  discountPercent: number;
  byoKeys: BYOKeyPreviews;
}

export interface BillingEnvelope {
  credits_used: number;
  period_credits_remaining: number;
  purchased_credits_remaining: number;
  total_credits_remaining: number;
  charged_from: 'credits' | 'byo_key' | 'local';
}

export interface CheckoutResponse {
  url: string;
}

export interface BillingAPI {
  getBalance(): Promise<BillingBalance>;
  purchaseCredits(packId: string): Promise<CheckoutResponse>;
  createSubscription(tierId: Exclude<Tier, 'free'>): Promise<CheckoutResponse>;
  manageSubscription(): Promise<CheckoutResponse>;
}

// ============================================================================
// Tools (agent helpers)
// ============================================================================

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Arbitrary provider-specific fields (e.g. position, date, thumbnail). */
  extra?: Record<string, unknown>;
}

export interface ToolsAPI {
  search(args: { query: string; numResults?: number; session_id?: string }): Promise<{
    results: SearchResult[];
    billing?: BillingEnvelope;
  }>;
  fetchUrl(args: { url: string; maxChars?: number; session_id?: string }): Promise<{
    text: string;
    title?: string;
    billing?: BillingEnvelope;
  }>;
}

// ============================================================================
// Insights — feeds bin/save_session
// ============================================================================
// Stored in the SAME SurrealDB namespace/database as all other app data
// (production/main on cloud). Consolidation from the historical
// production/insights_events db happens as part of Phase 8 (Surreal 2→3).
// Single-namespace policy: we never want to manage multiple dbs for migration.
// ============================================================================

/**
 * OpenTelemetry-compatible event shape. Mirrors the `/api/insights/batch`
 * server contract — all fields the server reads are present here.
 */
export interface InsightEvent {
  event_id: string;
  event_type: string;
  app_name: string;
  app_version?: string;
  user_id?: string;
  session_id?: string;
  /** Epoch milliseconds. */
  timestamp: number;
  parent_event_id?: string;
  trace_id?: string;
  payload: Record<string, unknown>;
  tags?: string[];
  duration_ms?: number;
  client_info?: Record<string, unknown>;
}

export interface InsightsAPI {
  emit(events: InsightEvent[]): Promise<{ stored: number; errors?: string[] }>;
}

// ============================================================================
// Errors
// ============================================================================

export type BackendErrorCode =
  | 'insufficient_credits'
  | 'provider_error'
  | 'not_supported'
  | 'network_error'
  | 'rate_limited'
  | 'invalid_request'
  | 'server_error'
  | 'aborted'
  | 'unknown';

export class BackendError extends Error {
  constructor(
    public readonly code: BackendErrorCode,
    message: string,
    public readonly retryable: boolean = false,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}
