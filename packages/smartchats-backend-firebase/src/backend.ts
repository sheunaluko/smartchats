/**
 * FirebaseBackend — implements SmartChatsBackend against the closed-source
 * smartchats-cloud Firebase Cloud Functions + Firestore billing + SurrealDB.
 *
 * Phase 2 scaffold: all methods stubbed with BackendError('not_supported').
 * Implementations are filled in per concern in the adjacent files.
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

import type { Functions } from 'firebase/functions';

import { createLLMAPI } from './llm.js';
import { createTTSAPI } from './tts.js';
import { createEmbeddingsAPI } from './embeddings.js';
import { createDataAPI } from './data.js';
import { createUsageAPI } from './usage.js';
import { createKeysAPI } from './keys.js';
import { createBillingAPI } from './billing.js';
import { createToolsAPI } from './tools.js';
import { createInsightsAPI } from './insights.js';

/** Token provider — returns a Firebase ID token for authenticated requests. */
export type GetIdToken = () => Promise<string | null>;

export interface FirebaseBackendOptions {
    /** Returns current Firebase ID token (or null if user is signed out). */
    getIdToken: GetIdToken;
    /** Firebase `functions` instance for httpsCallable. */
    functions: Functions;
    /** Base URL for HTTP streaming functions (e.g. `https://us-central1-…cloudfunctions.net` or `/__fn` proxy). */
    httpStreamBaseUrl: string;
    /** Base URL for app-hosted endpoints (Vercel /api/*). Defaults to `window.location.origin` at runtime. */
    appBaseUrl?: string;
}

const CAPABILITIES: BackendCapabilities = {
    billing: true,
    byoKeys: true,
    embeddings: true,
    search: true,
    urlFetch: true,
    insights: true,
};

export class FirebaseBackend implements SmartChatsBackend {
    readonly id = 'firebase';
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

    constructor(private readonly opts: FirebaseBackendOptions) {
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
        type Probe = { name: string; run: () => Promise<unknown> };
        const probes: Probe[] = [
            { name: 'data', run: () => this.data.healthCheck() },
            { name: 'billing', run: () => this.billing.getBalance() },
        ];
        const checks: HealthReport['checks'] = {};
        let ok = true;

        for (const p of probes) {
            const start = Date.now();
            try {
                const result = await p.run();
                // For `data`, fold its per-table ok into the aggregate
                if (p.name === 'data' && result && typeof result === 'object' && 'ok' in result) {
                    const dataReport = result as { ok: boolean };
                    checks[p.name] = { ok: dataReport.ok, latency_ms: Date.now() - start };
                    if (!dataReport.ok) ok = false;
                } else {
                    checks[p.name] = { ok: true, latency_ms: Date.now() - start };
                }
            } catch (err) {
                ok = false;
                checks[p.name] = {
                    ok: false,
                    latency_ms: Date.now() - start,
                    error: (err as Error).message,
                };
            }
        }

        return { ok, id: this.id, checks };
    }
}
