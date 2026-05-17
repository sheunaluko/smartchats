'use client';

import { createInsightStore } from 'smartchats-common';
import { getBackend } from '@/lib/backend';
import { toast_toast } from '@/components/Toast';
import { billingWorkflows } from '../../app/simi/billing_workflows';

type Tier = 'free' | 'intro' | 'basic' | 'pro' | 'max';

interface BYOKeys {
  openai: string | null;
  anthropic: string | null;
  google: string | null;
}

interface TierSummary {
  tier: Tier;
  name: string;
  priceUsd: number;
  monthlyCredits: number;
}

interface CreditPackSummary {
  id: string;
  priceUsd: number;
  credits: number;
}

interface BillingState {
  // Balance
  tier: Tier;
  tierName: string;
  periodCredits: number;
  purchasedCredits: number;
  totalAvailable: number;
  monthlyCredits: number;
  periodStart: string | null;
  periodEnd: string | null;
  discountPercent: number;
  /** All available tiers (name/price/monthlyCredits). Source of truth — UI reads from here. */
  tiers: TierSummary[];
  /** All available credit packs. Source of truth — UI reads from here. */
  creditPacks: CreditPackSummary[];

  // BYO keys (masked previews)
  byoKeys: BYOKeys;

  // Usage
  usageRecords: any[];
  usageLoading: boolean;
  usageError: string | null;
  periodSummary: any | null;
  usageSummary: { totalCredits: number; requestCount: number; models: any[]; purchases: any[] } | null;
  usageSummaryLoading: boolean;

  // UI state
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchBalance: () => Promise<void>;
  fetchUsage: (opts?: { limit?: number; startAfter?: string; periodOnly?: boolean }) => Promise<void>;
  fetchUsageSummary: (since: number) => Promise<void>;
  updateFromLLMResponse: (billing: any) => void;
  saveBYOKeys: (keys: Partial<Record<'openai' | 'anthropic' | 'google', string>>) => Promise<void>;
  deleteBYOKey: (provider: 'openai' | 'anthropic' | 'google') => Promise<void>;
}

// --- Helpers ---

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 1_000;

/** Run a promise with a timeout. Rejects if the promise doesn't settle in time. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timed out')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Retry an async fn with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>, retries: number, baseDelay: number): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

/** Returns true if value is a finite number >= 0. */
function isValidCredit(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v) && v >= 0;
}

// Deduplication guards (module-scoped so they survive across renders)
let _fetchBalanceInFlight: Promise<void> | null = null;
let _fetchUsageInFlight: Promise<void> | null = null;

export const useBillingStore = createInsightStore<BillingState>({
  appName: 'smartchats_billing',
  workflows: billingWorkflows,
  silent: ['updateFromLLMResponse'],
  creator: (set, get, _api, insights) => ({
    // Balance defaults
    tier: 'free' as Tier,
    tierName: 'Free',
    periodCredits: 0,
    purchasedCredits: 0,
    totalAvailable: 0,
    monthlyCredits: 1000,
    periodStart: null,
    periodEnd: null,
    discountPercent: 0,
    tiers: [],
    creditPacks: [],

    // BYO keys defaults
    byoKeys: { openai: null, anthropic: null, google: null },

    // Usage defaults
    usageRecords: [],
    usageLoading: false,
    usageError: null,
    periodSummary: null,
    usageSummary: null,
    usageSummaryLoading: false,

    // UI state
    isLoading: false,
    error: null,

    fetchBalance: async () => {
      // Short-circuit when the active backend doesn't expose billing (e.g. self-hosted).
      // Treats "no billing" as a steady no-op rather than an error condition.
      if (!getBackend().capabilities.billing) return;

      // Deduplication: if a fetch is already in flight, piggyback on it
      if (_fetchBalanceInFlight) {
        await _fetchBalanceInFlight;
        return;
      }

      const doFetch = async () => {
        set({ isLoading: true, error: null });
        try {
          const data = await withRetry(
            () => withTimeout(getBackend().billing.getBalance(), FETCH_TIMEOUT_MS),
            MAX_RETRIES,
            BASE_RETRY_DELAY_MS,
          );
          const balance = {
            tier: data.tier,
            tierName: data.tierName,
            periodCredits: data.periodCredits,
            purchasedCredits: data.purchasedCredits,
            totalAvailable: data.totalAvailable,
            monthlyCredits: data.monthlyCredits,
            periodStart: data.periodStart,
            periodEnd: data.periodEnd,
            discountPercent: data.discountPercent ?? 0,
            tiers: data.tiers ?? [],
            creditPacks: data.creditPacks ?? [],
            byoKeys: data.byoKeys,
          };
          set({ ...balance, isLoading: false });
          insights.emit('billing_balance', balance);
          if (data.totalAvailable <= 0) {
            toast_toast({
              title: 'No credits remaining',
              description: 'Purchase credits or add a BYO API key in Settings \u2192 Billing.',
              status: 'warning',
              duration: 10000,
            });
          }
        } catch (err: any) {
          set({ isLoading: false, error: err.message || 'Failed to fetch balance' });
        }
      };

      _fetchBalanceInFlight = doFetch();
      try {
        await _fetchBalanceInFlight;
      } finally {
        _fetchBalanceInFlight = null;
      }
    },

    fetchUsage: async (opts) => {
      // Deduplication: if a fetch is already in flight, piggyback on it
      if (_fetchUsageInFlight) {
        await _fetchUsageInFlight;
        return;
      }

      const doFetch = async () => {
        set({ usageLoading: true, usageError: null });
        try {
          const data = await withRetry(
            () => withTimeout(getBackend().usage.getRecords(opts), FETCH_TIMEOUT_MS),
            MAX_RETRIES,
            BASE_RETRY_DELAY_MS,
          );
          set({
            usageRecords: data.records || [],
            periodSummary: data.periodSummary || null,
            usageLoading: false,
          });
        } catch (err: any) {
          set({ usageLoading: false, usageError: err.message || 'Failed to load usage' });
        }
      };

      _fetchUsageInFlight = doFetch();
      try {
        await _fetchUsageInFlight;
      } finally {
        _fetchUsageInFlight = null;
      }
    },

    fetchUsageSummary: async (since: number) => {
      set({ usageSummaryLoading: true });
      try {
        const data = await withRetry(
          () => withTimeout(
            getBackend().usage.getSummary({ since: new Date(since).toISOString() }),
            FETCH_TIMEOUT_MS,
          ),
          MAX_RETRIES,
          BASE_RETRY_DELAY_MS,
        );
        set({
          usageSummary: {
            totalCredits: data.totalCredits || 0,
            requestCount: data.requestCount || 0,
            models: data.models || [],
            purchases: data.purchases || [],
          },
          usageSummaryLoading: false,
        });
      } catch (err: any) {
        set({ usageSummaryLoading: false });
      }
    },

    updateFromLLMResponse: (billing: any) => {
      if (!billing) return;
      const cur = get();
      const periodCredits = isValidCredit(billing.period_credits_remaining)
        ? billing.period_credits_remaining : cur.periodCredits;
      const purchasedCredits = isValidCredit(billing.purchased_credits_remaining)
        ? billing.purchased_credits_remaining : cur.purchasedCredits;
      const totalAvailable = isValidCredit(billing.total_credits_remaining)
        ? billing.total_credits_remaining : cur.totalAvailable;
      const updated = { periodCredits, purchasedCredits, totalAvailable };
      set(updated);
      insights.emit('billing_update', updated);
    },

    saveBYOKeys: async (keys) => {
      await getBackend().keys.save(keys);
      // In billing mode, refetching balance also refreshes byoKeys.
      // In no-billing mode (self-hosted), pull the configured-keys preview
      // directly so state.byoKeys reflects the save without a balance call.
      if (getBackend().capabilities.billing) {
        await get().fetchBalance();
      } else {
        const configured = await getBackend().keys.getConfigured();
        set({ byoKeys: configured as any });
      }
    },

    deleteBYOKey: async (provider) => {
      await getBackend().keys.delete(provider);
      if (getBackend().capabilities.billing) {
        await get().fetchBalance();
      } else {
        const configured = await getBackend().keys.getConfigured();
        set({ byoKeys: configured as any });
      }
    },
  }),
});

// Listen for billing update events from cloudLLMCall
if (typeof window !== 'undefined') {
  window.addEventListener('smartchats:billing_update', ((e: CustomEvent) => {
    useBillingStore.getState().updateFromLLMResponse(e.detail);
  }) as EventListener);
}
