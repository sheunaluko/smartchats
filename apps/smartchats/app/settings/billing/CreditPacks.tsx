'use client';

import React, { useState } from 'react';
import { useBillingStore } from '@/stores/billing_store';
import { getBackend } from '@/lib/backend';
import { SurfacePanel } from '../../ui/recipes';

export default function CreditPacks() {
  const { creditPacks } = useBillingStore();
  const [loadingPack, setLoadingPack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePurchase = async (packId: string) => {
    setLoadingPack(packId);
    try {
      const { url } = await getBackend().billing.purchaseCredits(packId);
      if (url) window.location.href = url;
    } catch (err: any) {
      console.error('Purchase error:', err);
      setError(err?.message || 'Failed to purchase credits. Please try again.');
    } finally {
      setLoadingPack(null);
    }
  };

  // Server is source of truth — render nothing while creditPacks haven't
  // loaded (initial render before getBalance returns). Billing page already
  // shows its own loading state.
  if (!creditPacks || creditPacks.length === 0) {
    return null;
  }

  return (
    <div>
      {error && (
        <div className="flex items-center justify-between bg-sc-danger/20 text-sc-danger border border-sc-danger/30 rounded-sc p-3 mb-4">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-sc-danger hover:opacity-70 ml-2">&times;</button>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {creditPacks.map((pack) => (
          <SurfacePanel key={pack.id} variant="secondary" className="p-6 text-center">
            <p className="text-2xl font-bold text-[var(--sc-accent)]">
              {pack.credits.toLocaleString()}
            </p>
            <p className="text-sm text-sc-text-muted mb-4">
              credits
            </p>
            <button
              className="status-focused status-disabled w-full rounded-[12px] border border-[var(--sc-accent)]/35 py-1.5 text-sm text-[var(--sc-accent)] transition-colors duration-sc-fast hover:bg-[var(--sc-accent)]/10"
              disabled={loadingPack === pack.id}
              onClick={() => handlePurchase(pack.id)}
            >
              {loadingPack === pack.id ? 'Redirecting...' : `$${pack.priceUsd}`}
            </button>
          </SurfacePanel>
        ))}
      </div>
    </div>
  );
}
