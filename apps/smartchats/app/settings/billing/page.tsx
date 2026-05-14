'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

import { useBillingStore } from '@/stores/billing_store';
import { getBackend } from '@/lib/backend';
import CreditBalance from './CreditBalance';
import BYOKeysSection from './BYOKeysSection';
import TierCards from './TierCards';
import CreditPacks from './CreditPacks';
import UsageTable from './UsageTable';

export default function BillingPage() {
  const { user, isReady } = useAuth();
  const loading = !isReady;
  const { fetchBalance, fetchUsage, isLoading, error } = useBillingStore();
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [stripeReturn, setStripeReturn] = useState(false);
  const caps = getBackend().capabilities;
  const router = useRouter();

  // Redirect to home when the deployment has no billing (e.g. self-hosted).
  // Nothing on this page applies in that mode — BYO key management lives under
  // /settings directly.
  useEffect(() => {
    if (!caps.billing) router.replace('/');
  }, [caps.billing, router]);

  // Handle return from Stripe
  useEffect(() => {
    if (!caps.billing) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('purchase') === 'success') {
      setSuccessMsg('Credits purchased successfully!');
      setStripeReturn(true);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('subscription') === 'success') {
      setSuccessMsg('Subscription activated! Your credits have been updated.');
      setStripeReturn(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [caps.billing]);

  // Fetch data when user is authenticated — only hit billing endpoints
  // if the backend actually has billing capability.
  useEffect(() => {
    if (!caps.billing) return;
    if (!user) return;
    fetchBalance();
    fetchUsage({ periodOnly: true, limit: 500 });
  }, [user, stripeReturn, caps.billing, fetchBalance, fetchUsage]);

  if (!caps.billing) return null;

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-[var(--sc-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-[600px] mx-auto mt-20 p-6 text-center">
        <h2 className="text-xl font-semibold text-sc-text mb-2">Please log in to manage billing</h2>
        <p className="text-sc-text-muted mb-6">
          You need to be signed in to view your credits, usage, and subscription.
        </p>
        <button
          className="px-6 py-2 bg-[var(--sc-accent)] text-white font-medium rounded-sc hover:opacity-90 transition-opacity duration-sc-fast"
          onClick={() => {
            if (typeof window !== 'undefined' && (window as any).openLoginModal) {
              (window as any).openLoginModal();
            }
          }}
        >
          Log In
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[1000px] mx-auto p-6 pb-16">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link href="/" className="no-underline">
          <button className="flex items-center gap-1 text-sm text-[var(--sc-accent)] hover:opacity-80 transition-opacity duration-sc-fast">
            <ArrowLeft size={16} />
            Back
          </button>
        </Link>
        <h1 className="text-3xl font-semibold text-sc-text">Billing & Credits</h1>
      </div>

      {/* Success message */}
      {successMsg && (
        <div className="flex items-center justify-between bg-sc-success/20 text-sc-success border border-sc-success/30 rounded-sc p-3 mb-6">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-sc-success hover:opacity-70 ml-2">&times;</button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-sc-danger/20 text-sc-danger border border-sc-danger/30 rounded-sc p-3 mb-6">
          {error}
        </div>
      )}

      {/* Credit Balance — cloud-only */}
      {caps.billing && <CreditBalance />}

      {/* BYO API Keys — supported in both modes */}
      {caps.byoKeys && (
        <>
          <h2 className="text-xl font-semibold text-sc-text mt-10 mb-4">API Keys</h2>
          <BYOKeysSection />
        </>
      )}

      {/* Plans + Credit Packs — cloud-only (no Stripe in local mode) */}
      {caps.billing && (
        <>
          <h2 className="text-xl font-semibold text-sc-text mt-10 mb-4">Plans</h2>
          <TierCards />

          <h2 className="text-xl font-semibold text-sc-text mt-10 mb-4">Buy Credits</h2>
          <CreditPacks />
        </>
      )}

      {/* Usage Table — always visible; local mode shows zero credits but real tokens/cost */}
      <h2 className="text-xl font-semibold text-sc-text mt-10 mb-4">Usage History</h2>
      <UsageTable />
    </div>
  );
}
