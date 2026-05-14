import type {
    BillingAPI,
    BillingBalance,
    BYOKeyPreviews,
    CheckoutResponse,
    Tier,
    LLMProvider,
} from 'smartchats-backend';
import { BackendError } from 'smartchats-backend';
import { httpsCallable } from 'firebase/functions';
import type { FirebaseBackendOptions } from './backend.js';

function wrapCallableError(fn: string, err: unknown): never {
    const message = (err as { message?: string })?.message || 'unknown error';
    throw new BackendError('server_error', `${fn} failed: ${message}`, true, err);
}

export function createBillingAPI(opts: FirebaseBackendOptions): BillingAPI {
    const getBalance_fn = httpsCallable<Record<string, never>, Omit<BillingBalance, 'byoKeys'> & { byoKeys?: Partial<Record<LLMProvider, string | null>> }>(
        opts.functions,
        'getBalance',
    );

    // Note: cloud fn takes `{ tier }`, our interface takes `tierId` — translate at the boundary
    const createSubscription_fn = httpsCallable<{ tier: Tier }, { url: string }>(
        opts.functions,
        'createSubscription',
    );

    const manageSubscription_fn = httpsCallable<Record<string, never>, { url: string }>(
        opts.functions,
        'manageSubscription',
    );

    const purchaseCredits_fn = httpsCallable<{ packId: string }, { url: string }>(
        opts.functions,
        'purchaseCredits',
    );

    return {
        async getBalance(): Promise<BillingBalance> {
            try {
                const result = await getBalance_fn({});
                const raw = result.data;
                const byoKeys: BYOKeyPreviews = {
                    openai: raw.byoKeys?.openai ?? null,
                    anthropic: raw.byoKeys?.anthropic ?? null,
                    google: raw.byoKeys?.google ?? null,
                };
                return { ...raw, byoKeys };
            } catch (err) {
                wrapCallableError('billing.getBalance', err);
            }
        },

        async purchaseCredits(packId: string): Promise<CheckoutResponse> {
            try {
                const result = await purchaseCredits_fn({ packId });
                return { url: result.data.url };
            } catch (err) {
                wrapCallableError('billing.purchaseCredits', err);
            }
        },

        async createSubscription(tierId: Exclude<Tier, 'free'>): Promise<CheckoutResponse> {
            try {
                const result = await createSubscription_fn({ tier: tierId });
                return { url: result.data.url };
            } catch (err) {
                wrapCallableError('billing.createSubscription', err);
            }
        },

        async manageSubscription(): Promise<CheckoutResponse> {
            try {
                const result = await manageSubscription_fn({});
                return { url: result.data.url };
            } catch (err) {
                wrapCallableError('billing.manageSubscription', err);
            }
        },
    };
}
