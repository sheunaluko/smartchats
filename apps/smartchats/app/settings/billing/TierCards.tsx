'use client';

import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { useBillingStore } from '@/stores/billing_store';
import { getBackend } from '@/lib/backend';
import type { Tier } from 'smartchats-backend';
import { SurfacePanel } from '../../ui/recipes';

// Marketing copy per tier — stays client-side since it's not pricing data
// the server controls. Tier identity, price, and credits come from the server
// via useBillingStore().tiers (single source of truth, no drift).
const TIER_EXTRAS: Record<string, { extraFeatures: string[] }> = {
  free:  { extraFeatures: ['All AI models', 'Voice chat'] },
  intro: { extraFeatures: ['All AI models', 'Voice chat'] },
  basic: { extraFeatures: ['All AI models', 'Voice chat'] },
  pro:   { extraFeatures: ['All AI models', 'Voice chat'] },
  max:   { extraFeatures: ['All AI models', 'Voice chat'] },
};

function formatCredits(n: number): string {
  return n.toLocaleString();
}

export default function TierCards() {
  const { tier: currentTier, tiers } = useBillingStore();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpgrade = async (tier: string) => {
    setLoadingTier(tier);
    try {
      const { url } = await getBackend().billing.createSubscription(tier as Exclude<Tier, 'free'>);
      if (url) window.location.href = url;
    } catch (err: any) {
      console.error('Subscription error:', err);
      setError(err?.message || 'Failed to create subscription. Please try again.');
    } finally {
      setLoadingTier(null);
    }
  };

  const handleManage = async () => {
    try {
      const { url } = await getBackend().billing.manageSubscription();
      if (url) window.location.href = url;
    } catch (err: any) {
      console.error('Portal error:', err);
      setError(err?.message || 'Failed to open subscription portal. Please try again.');
    }
  };

  const tierOrder = ['free', 'intro', 'basic', 'pro', 'max'];
  const currentTierIndex = tierOrder.indexOf(currentTier);

  // Server is source of truth. While tiers haven't loaded (initial render
  // before getBalance returns), render nothing — billing page already shows
  // a loading state above.
  if (!tiers || tiers.length === 0) {
    return null;
  }

  // Build display rows from server tiers + local marketing extras.
  const displayTiers = tiers.map((t) => {
    const extras = TIER_EXTRAS[t.tier]?.extraFeatures ?? [];
    const features = [`${formatCredits(t.monthlyCredits)} credits/month`, ...extras];
    return { ...t, features };
  });

  return (
    <div>
      {error && (
        <div className="flex items-center justify-between bg-sc-danger/20 text-sc-danger border border-sc-danger/30 rounded-sc p-3 mb-4">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-sc-danger hover:opacity-70 ml-2">&times;</button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {displayTiers.map((t) => {
          const isCurrent = t.tier === currentTier;
          const tierIndex = tierOrder.indexOf(t.tier);
          const isDowngrade = tierIndex < currentTierIndex;

          return (
            <SurfacePanel
              key={t.tier}
              variant="secondary"
              className={`relative p-6 ${
                isCurrent ? 'border-2 border-[var(--sc-accent)]' : ''
              }`}
            >
              {isCurrent && (
                <span className="absolute top-3 right-3 bg-[var(--sc-accent)] text-white text-xs font-medium px-2 py-0.5 rounded-full">
                  Current
                </span>
              )}

              <h3 className="text-lg font-semibold text-sc-text">{t.name}</h3>
              <div className="mt-2">
                <span className="text-3xl font-bold text-sc-text">
                  {t.priceUsd === 0 ? 'Free' : `$${t.priceUsd}`}
                </span>
                {t.priceUsd > 0 && (
                  <span className="text-sm text-sc-text-muted">/mo</span>
                )}
              </div>

              <div className="mt-4 space-y-1">
                {t.features.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Check size={16} className="text-sc-success flex-shrink-0" />
                    <span className="text-sm text-sc-text">{f}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                {isCurrent ? (
                  currentTier !== 'free' ? (
                    <button
                      className="status-focused w-full rounded-[12px] border border-[var(--sc-accent)]/35 py-1.5 text-sm text-[var(--sc-accent)] transition-colors duration-sc-fast hover:bg-[var(--sc-accent)]/10"
                      onClick={handleManage}
                    >
                      Manage Subscription
                    </button>
                  ) : null
                ) : isDowngrade ? (
                  <button
                    className="status-disabled w-full rounded-[12px] border border-[var(--sc-separator)] py-1.5 text-sm text-sc-text-muted"
                    disabled
                    onClick={handleManage}
                  >
                    Manage via Portal
                  </button>
                ) : (
                  <button
                    className="status-focused status-disabled w-full rounded-[12px] bg-[var(--sc-accent)] py-1.5 text-sm font-medium text-white transition-opacity duration-sc-fast hover:opacity-90"
                    disabled={loadingTier === t.tier}
                    onClick={() => handleUpgrade(t.tier)}
                  >
                    {loadingTier === t.tier ? 'Redirecting...' : `Upgrade to ${t.name}`}
                  </button>
                )}
              </div>
            </SurfacePanel>
          );
        })}
      </div>
    </div>
  );
}
