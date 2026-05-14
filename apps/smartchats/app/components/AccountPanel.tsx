'use client';

import React, { useEffect } from 'react';
import { LogOut, CreditCard, ExternalLink, Zap } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { Drawer } from '../ui/Drawer';
import { PanelHeader } from '../ui/recipes/PanelHeader';
import { SurfacePanel } from '../ui/recipes/SurfacePanel';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { useBillingStore } from '@/stores/billing_store';

type AccountPanelProps = {
  open: boolean;
  onClose: () => void;
};

function CreditSummary() {
  const {
    tier, tierName, totalAvailable, monthlyCredits,
    periodCredits, purchasedCredits, periodEnd, isLoading,
  } = useBillingStore();

  const usedPercent = monthlyCredits > 0
    ? Math.min(100, Math.round(((monthlyCredits - periodCredits) / monthlyCredits) * 100))
    : 0;

  const barColor = usedPercent > 90
    ? 'var(--sc-danger)'
    : usedPercent > 70
      ? 'var(--sc-warning)'
      : 'var(--sc-success)';

  if (isLoading) {
    return (
      <SurfacePanel variant="secondary" className="flex items-center justify-center p-6">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-sc-primary border-t-transparent" />
      </SurfacePanel>
    );
  }

  return (
    <SurfacePanel variant="secondary" className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-sc-text-muted">Available credits</span>
        <Chip label={tierName || tier} size="sm" variant="primary" />
      </div>
      <div className="text-2xl font-bold text-sc-text">
        {totalAvailable.toLocaleString()}
      </div>

      {/* Usage bar */}
      {monthlyCredits > 0 && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--sc-surface-secondary)]">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${100 - usedPercent}%`, backgroundColor: barColor }}
            />
          </div>
          <div className="flex justify-between text-[0.625rem] text-sc-text-muted">
            <span>{periodCredits.toLocaleString()} remaining</span>
            {periodEnd && (
              <span>Resets {new Date(periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            )}
          </div>
        </div>
      )}

      {purchasedCredits > 0 && (
        <div className="text-[0.625rem] text-sc-text-muted">
          + {purchasedCredits.toLocaleString()} purchased credits
        </div>
      )}
    </SurfacePanel>
  );
}

function ActionRow({ icon: Icon, label, href, onClick }: {
  icon: React.ComponentType<any>;
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <SurfacePanel
      variant="secondary"
      interactive
      className="flex cursor-pointer items-center gap-3 px-4 py-3"
      onClick={onClick}
    >
      <Icon size={16} className="shrink-0 text-sc-text-muted" />
      <span className="flex-1 text-sm text-sc-text">{label}</span>
      <ExternalLink size={12} className="shrink-0 text-sc-text-muted opacity-50" />
    </SurfacePanel>
  );

  if (href) {
    return <Link href={href} className="no-underline">{content}</Link>;
  }
  return content;
}

export function AccountPanel({ open, onClose }: AccountPanelProps) {
  const { user, signOut } = useAuth();
  const { fetchBalance } = useBillingStore();

  // Fetch balance when panel opens
  useEffect(() => {
    if (open && user) fetchBalance();
  }, [open, user, fetchBalance]);

  const handleSignOut = async () => {
    try {
      await signOut();
      onClose();
      // Reload to reset all state
      window.location.reload();
    } catch (err) {
      console.error('Sign out failed:', err);
    }
  };

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'User';
  const email = user?.email || '';

  return (
    <Drawer open={open} onClose={onClose} title="Account" width={320} anchor="right">
      <div className="flex flex-col gap-4">
        <PanelHeader title="Account" />

        {/* User identity */}
        <div className="flex items-center gap-3 px-1">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--sc-primary)_16%,transparent)] text-sm font-semibold text-sc-primary">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-sc-text">{displayName}</div>
            {email && <div className="truncate text-[0.6875rem] text-sc-text-muted">{email}</div>}
          </div>
        </div>

        {/* Credit summary */}
        <CreditSummary />

        {/* Quick actions */}
        <div className="space-y-2">
          <ActionRow icon={CreditCard} label="Billing & Plans" href="/settings/billing" />
          <ActionRow icon={Zap} label="Buy Credits" href="/settings/billing" />
        </div>

        {/* Sign out */}
        <div className="pt-2">
          <Button
            variant="ghost"
            size="md"
            onClick={handleSignOut}
            className="w-full justify-center gap-2 text-sc-text-muted hover:text-[var(--sc-danger)]"
          >
            <LogOut size={15} />
            Sign Out
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
