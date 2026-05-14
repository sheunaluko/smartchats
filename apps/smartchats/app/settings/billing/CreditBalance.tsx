'use client';

import React from 'react';
import { useBillingStore } from '@/stores/billing_store';
import { SurfacePanel } from '../../ui/recipes';

export default function CreditBalance() {
  const {
    tier, tierName, periodCredits, purchasedCredits,
    totalAvailable, monthlyCredits, periodStart, periodEnd,
    isLoading, discountPercent,
  } = useBillingStore();

  if (isLoading) {
    return (
      <SurfacePanel variant="secondary" className="p-6">
        <div className="h-8 w-48 rounded-sc bg-[var(--sc-surface-tertiary)] animate-pulse" />
        <div className="mt-4 h-4 w-full rounded-sc bg-[var(--sc-surface-tertiary)] animate-pulse" />
        <div className="mt-2 h-4 w-72 rounded-sc bg-[var(--sc-surface-tertiary)] animate-pulse" />
      </SurfacePanel>
    );
  }

  const periodUsed = Math.max(0, monthlyCredits - periodCredits);
  const periodPercent = monthlyCredits > 0 ? Math.min((periodUsed / monthlyCredits) * 100, 100) : 0;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '\u2014';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const barColor = periodPercent > 90 ? 'bg-sc-danger' : periodPercent > 70 ? 'bg-sc-warning' : 'bg-[var(--sc-accent)]';

  return (
    <SurfacePanel variant="secondary" className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-lg font-semibold text-sc-text">Credit Balance</h3>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          tier === 'free' ? 'bg-[var(--sc-surface-tertiary)] text-sc-text-muted' : 'bg-[var(--sc-accent)] text-white'
        }`}>
          {tierName}
        </span>
        {discountPercent > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-sc-success text-sc-success">
            {Math.round(discountPercent)}% discount
          </span>
        )}
      </div>

      {/* Total available */}
      <p className="text-4xl font-bold text-[var(--sc-accent)]">
        {totalAvailable.toLocaleString()}
      </p>
      <p className="text-sm text-sc-text-muted mb-4">
        credits available
      </p>

      {/* Period credits bar */}
      <p className="text-sm text-sc-text-muted mb-1">
        Monthly credits: {periodUsed.toLocaleString()} / {monthlyCredits.toLocaleString()} used
      </p>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--sc-surface-tertiary)]">
        <div
          className={`h-full rounded-full transition-all duration-sc-base ${barColor}`}
          style={{ width: `${periodPercent}%` }}
        />
      </div>

      {/* Breakdown */}
      <div className="flex gap-8 mt-4">
        <div>
          <p className="text-sm text-sc-text-muted">Period credits</p>
          <p className="text-base font-medium text-sc-text">{periodCredits.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-sm text-sc-text-muted">Purchased credits</p>
          <p className="text-base font-medium text-sc-text">{purchasedCredits.toLocaleString()}</p>
        </div>
        {periodEnd && (
          <div>
            <p className="text-sm text-sc-text-muted">Resets</p>
            <p className="text-base font-medium text-sc-text">{formatDate(periodEnd)}</p>
          </div>
        )}
      </div>
    </SurfacePanel>
  );
}
