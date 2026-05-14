'use client';

import React, { useState, useEffect } from 'react';
import { useBillingStore } from '@/stores/billing_store';
import { SurfacePanel } from '../../ui/recipes';

type TimeRange = 'day' | 'week' | 'month';

const RANGE_LABELS: Record<TimeRange, string> = { day: '24h', week: '7 days', month: '30 days' };

function getSince(range: TimeRange): number {
  const now = Date.now();
  switch (range) {
    case 'day': return now - 24 * 60 * 60 * 1000;
    case 'week': return now - 7 * 24 * 60 * 60 * 1000;
    case 'month': return now - 30 * 24 * 60 * 60 * 1000;
  }
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function purchaseLabel(type: string): string {
  return type === 'purchase' ? 'Credit Pack' : 'Subscription';
}

export default function UsageTable() {
  const { usageSummary, usageSummaryLoading, fetchUsageSummary } = useBillingStore();
  const [range, setRange] = useState<TimeRange>('week');

  useEffect(() => {
    fetchUsageSummary(getSince(range));
  }, [range, fetchUsageSummary]);

  const summary = usageSummary;
  const loading = usageSummaryLoading;
  const purchases = summary?.purchases ?? [];

  return (
    <div>
      {/* Range toggle */}
      <div className="flex gap-1 rounded-sc border border-[var(--sc-separator)] p-0.5 w-fit mb-4">
        {(Object.keys(RANGE_LABELS) as TimeRange[]).map((key) => (
          <button
            key={key}
            onClick={() => setRange(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-sc transition-colors duration-sc-fast ${
              range === key
                ? 'bg-[var(--sc-accent)] text-white'
                : 'text-sc-text-muted hover:text-sc-text hover:bg-[var(--sc-surface-tertiary)]'
            }`}
          >
            {RANGE_LABELS[key]}
          </button>
        ))}
      </div>

      {/* Purchase history */}
      {loading ? (
        <SurfacePanel variant="secondary" className="mb-4 p-4">
          <div className="mb-2 h-4 w-32 rounded bg-[var(--sc-surface-tertiary)] animate-pulse" />
          <div className="h-8 w-48 rounded bg-[var(--sc-surface-tertiary)] animate-pulse" />
        </SurfacePanel>
      ) : purchases.length > 0 ? (
        <SurfacePanel variant="secondary" className="mb-4 p-4">
          <h3 className="text-sm font-medium text-sc-text-muted mb-3">Purchase History</h3>
          <div className="space-y-2">
            {purchases.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-[var(--sc-separator)] last:border-b-0">
                <div>
                  <span className="text-sm text-sc-text">{purchaseLabel(p.type)}</span>
                  {p.note && (
                    <span className="ml-2 text-xs text-sc-text-muted">{p.note}</span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-sc-success">+{p.amount.toLocaleString()} credits</span>
                  <span className="text-xs text-sc-text-muted">{formatDate(p.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        </SurfacePanel>
      ) : (
        <SurfacePanel variant="secondary" className="mb-4 p-4">
          <h3 className="text-sm font-medium text-sc-text-muted mb-1">Purchase History</h3>
          <p className="text-sm text-sc-text-muted">No purchases in the last {RANGE_LABELS[range]}.</p>
        </SurfacePanel>
      )}

      {/* Credit usage summary */}
      <SurfacePanel variant="secondary" className="mb-4 p-4">
        {loading ? (
          <div className="flex gap-8">
            {[1, 2].map((i) => (
              <div key={i} className="w-24">
                <div className="mb-1 h-3 w-16 rounded bg-[var(--sc-surface-tertiary)] animate-pulse" />
                <div className="h-7 w-20 rounded bg-[var(--sc-surface-tertiary)] animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-8">
            <div>
              <p className="text-sm text-sc-text-muted">Credits used</p>
              <p className="text-2xl font-semibold text-sc-text">
                {(summary?.totalCredits ?? 0).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-sm text-sc-text-muted">Requests</p>
              <p className="text-2xl font-semibold text-sc-text">
                {(summary?.requestCount ?? 0).toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </SurfacePanel>

      {/* Per-model breakdown */}
      {loading ? (
        <SurfacePanel variant="secondary" className="p-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="mb-2 h-8 rounded-sc bg-[var(--sc-surface-tertiary)] animate-pulse" />
          ))}
        </SurfacePanel>
      ) : summary && summary.models.length > 0 ? (
        <SurfacePanel variant="secondary" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--sc-separator)]">
                <th className="text-left p-3 text-sc-text-muted font-medium">Model</th>
                <th className="text-right p-3 text-sc-text-muted font-medium">Requests</th>
                <th className="text-right p-3 text-sc-text-muted font-medium">Tokens</th>
                <th className="text-right p-3 text-sc-text-muted font-medium">Credits</th>
              </tr>
            </thead>
            <tbody>
              {summary.models.map((m: any) => (
                <tr key={m.model} className="border-b border-[var(--sc-separator)] last:border-b-0 transition-colors hover:bg-[var(--sc-surface-tertiary)]">
                  <td className="p-3 text-sc-text font-medium">{m.model}</td>
                  <td className="p-3 text-right text-sc-text">{m.count.toLocaleString()}</td>
                  <td className="p-3 text-right text-sc-text">{m.tokens.toLocaleString()}</td>
                  <td className="p-3 text-right font-medium text-sc-text">{m.credits.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SurfacePanel>
      ) : (
        <SurfacePanel variant="secondary" className="p-6 text-center">
          <p className="text-sc-text-muted">No usage in the last {RANGE_LABELS[range]}.</p>
        </SurfacePanel>
      )}
    </div>
  );
}
