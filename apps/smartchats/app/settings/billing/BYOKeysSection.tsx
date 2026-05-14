'use client';

import React, { useState } from 'react';
import { useBillingStore } from '@/stores/billing_store';
import { SurfacePanel } from '../../ui/recipes';

const PROVIDERS = [
  { key: 'openai' as const, label: 'OpenAI' },
  { key: 'anthropic' as const, label: 'Anthropic' },
  { key: 'google' as const, label: 'Google' },
];

export default function BYOKeysSection() {
  const { byoKeys, saveBYOKeys, deleteBYOKey } = useBillingStore();
  const [inputs, setInputs] = useState<Record<string, string>>({ openai: '', anthropic: '', google: '' });
  const [loading, setLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSave = async (provider: 'openai' | 'anthropic' | 'google') => {
    const value = inputs[provider]?.trim();
    if (!value) return;

    setLoading(provider);
    setFeedback(null);
    try {
      await saveBYOKeys({ [provider]: value });
      setInputs((prev) => ({ ...prev, [provider]: '' }));
      setFeedback({ type: 'success', message: `${provider} key saved successfully.` });
    } catch (err: any) {
      const msg = err?.message || 'Failed to save key';
      setFeedback({ type: 'error', message: msg });
    } finally {
      setLoading(null);
    }
  };

  const handleDelete = async (provider: 'openai' | 'anthropic' | 'google') => {
    setLoading(provider);
    setFeedback(null);
    try {
      await deleteBYOKey(provider);
      setFeedback({ type: 'success', message: `${provider} key removed.` });
    } catch (err: any) {
      const msg = err?.message || 'Failed to remove key';
      setFeedback({ type: 'error', message: msg });
    } finally {
      setLoading(null);
    }
  };

  return (
    <SurfacePanel variant="secondary" className="p-6">
      <h3 className="text-lg font-semibold text-sc-text mb-1">
        API Keys
      </h3>
      <p className="text-sm text-sc-text-muted mb-4">
        Add your own API keys to bypass credit billing.
      </p>

      {feedback && (
        <div className={`flex items-center justify-between rounded-sc p-3 mb-4 border ${
          feedback.type === 'success'
            ? 'bg-sc-success/20 text-sc-success border-sc-success/30'
            : 'bg-sc-danger/20 text-sc-danger border-sc-danger/30'
        }`}>
          <span>{feedback.message}</span>
          <button onClick={() => setFeedback(null)} className="hover:opacity-70 ml-2">&times;</button>
        </div>
      )}

      {PROVIDERS.map(({ key, label }, idx) => {
        const configured = !!byoKeys[key];
        const isLoading = loading === key;

        return (
          <div
            key={key}
            className={`flex items-center gap-4 py-3 ${
              idx < PROVIDERS.length - 1 ? 'border-b border-[var(--sc-separator)]' : ''
            }`}
          >
            <span className="text-base font-medium text-sc-text min-w-[100px]">
              {label}
            </span>

            {configured ? (
              <>
                <span className="text-sm font-mono text-sc-text-muted">
                  {byoKeys[key]}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-sc-success text-white font-medium">
                  Active
                </span>
                <button
                  className="status-focused status-disabled ml-auto rounded-[10px] border border-sc-danger/40 px-3 py-1 text-sm text-sc-danger transition-colors duration-sc-fast hover:bg-sc-danger/10"
                  disabled={isLoading}
                  onClick={() => handleDelete(key)}
                >
                  {isLoading ? (
                    <span className="inline-block w-4 h-4 border-2 border-sc-danger border-t-transparent rounded-full animate-spin" />
                  ) : 'Remove'}
                </button>
              </>
            ) : (
              <>
                <input
                  type="password"
                  placeholder={`${label} API key`}
                  value={inputs[key]}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="field-base status-focused-field status-disabled flex-1 rounded-[12px] px-3 py-1.5 text-sm text-sc-text outline-none"
                />
                <button
                  className="status-focused status-disabled rounded-[12px] bg-[var(--sc-accent)] px-4 py-1.5 text-sm font-medium text-white transition-opacity duration-sc-fast hover:opacity-90"
                  disabled={isLoading || !inputs[key]?.trim()}
                  onClick={() => handleSave(key)}
                >
                  {isLoading ? (
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : 'Save Key'}
                </button>
              </>
            )}
          </div>
        );
      })}
    </SurfacePanel>
  );
}
