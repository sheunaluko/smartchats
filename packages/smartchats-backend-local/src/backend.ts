/**
 * LocalBackend — SmartChatsBackend implementation that talks to a
 * self-hosted Express server (smartchats-local-server). Runs in the
 * browser. Billing methods throw `not_supported`.
 *
 * Phase 3 scaffold: stubbed with BackendError('not_supported'). Impls
 * fill in one concern at a time.
 */

import type {
    SmartChatsBackend,
    BackendCapabilities,
    HealthReport,
    LLMAPI,
    TTSAPI,
    EmbeddingsAPI,
    DataAPI,
    UsageAPI,
    KeysAPI,
    BillingAPI,
    ToolsAPI,
    InsightsAPI,
} from 'smartchats-backend';
import { BackendError } from 'smartchats-backend';
import { jsonRequest } from './http.js';

import { createLLMAPI } from './llm.js';
import { createTTSAPI } from './tts.js';
import { createEmbeddingsAPI } from './embeddings.js';
import { createDataAPI } from './data.js';
import { createUsageAPI } from './usage.js';
import { createKeysAPI } from './keys.js';
import { createBillingAPI } from './billing.js';
import { createToolsAPI } from './tools.js';
import { createInsightsAPI } from './insights.js';

export interface LocalBackendOptions {
    /** Base URL of the smartchats-local-server, e.g. `http://localhost:4000`. */
    baseUrl: string;
    /** Optional shared-secret bearer token. When present, sent as
     *  `Authorization: Bearer <apiKey>` on every request. */
    apiKey?: string;
}

/**
 * Self-hosted capabilities. No billing (no Stripe/credits).
 * byoKeys stays true — the server supports saving keys to local SurrealDB,
 * though env vars are the preferred configuration path.
 */
const CAPABILITIES: BackendCapabilities = {
    billing: false,
    byoKeys: true,
    embeddings: true,
    search: true,          // gated at runtime by server detecting SERPER key presence
    urlFetch: true,
    insights: true,
};

export class LocalBackend implements SmartChatsBackend {
    readonly id = 'local';
    readonly capabilities = CAPABILITIES;

    readonly llm: LLMAPI;
    readonly tts: TTSAPI;
    readonly embeddings: EmbeddingsAPI;
    readonly data: DataAPI;
    readonly usage: UsageAPI;
    readonly keys: KeysAPI;
    readonly billing: BillingAPI;
    readonly tools: ToolsAPI;
    readonly insights: InsightsAPI;

    constructor(private readonly opts: LocalBackendOptions) {
        this.llm = createLLMAPI(opts);
        this.tts = createTTSAPI(opts);
        this.embeddings = createEmbeddingsAPI(opts);
        this.data = createDataAPI(opts);
        this.usage = createUsageAPI(opts);
        this.keys = createKeysAPI(opts);
        this.billing = createBillingAPI(opts);
        this.tools = createToolsAPI(opts);
        this.insights = createInsightsAPI(opts);
    }

    async health(): Promise<HealthReport> {
        // Server aggregates its own probes (DB + provider keys + TTS key) and
        // returns a HealthReport directly. If the server itself is unreachable,
        // surface that as a structured failure rather than a thrown error —
        // callers (CI, onboarding diagnostics) rely on `health()` always returning.
        try {
            return await jsonRequest<HealthReport>(this.opts, '/health');
        } catch (err) {
            if (err instanceof BackendError && err.code === 'network_error') {
                return {
                    ok: false,
                    id: this.id,
                    checks: {
                        reachable: { ok: false, error: err.message },
                    },
                };
            }
            throw err;
        }
    }
}
