'use client';

import React, { useState, useCallback } from 'react';
import WidgetItem from '../WidgetItem';
import { SurfacePanel } from '../ui/recipes/SurfacePanel';
import { Chip } from '../ui/Chip';
import { Button } from '../ui/Button';
import { useSmartChatsStore } from '../store/useSmartChatsStore';

interface LLMInspectorWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
}

function AccordionSection({ title, badge, defaultOpen, children }: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-sc-text-muted hover:text-sc-text transition-colors py-1.5 select-none">
        <span className="transition-transform group-open:rotate-90">&#9654;</span>
        {title}
        {badge && <Chip label={badge} size="sm" variant="default" />}
      </summary>
      <div className="pl-4 pb-2">{children}</div>
    </details>
  );
}

function StatRow({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="flex items-center text-xs py-0.5 gap-2">
      <span className="text-sc-text-muted w-28 shrink-0">{label}</span>
      <span className={warn ? 'text-sc-warning font-medium' : 'text-sc-text font-mono'}>{value}</span>
    </div>
  );
}

function ModuleRow({ mod }: { mod: any }) {
  const features = [
    mod.system_msg && 'sys',
    mod.functions?.length && `${mod.functions.length} fn`,
    mod.state && 'state',
    mod.output_instructions && 'output',
  ].filter(Boolean);

  return (
    <div className="flex items-center justify-between text-xs py-0.5 gap-2">
      <span className="text-sc-text font-mono truncate">{mod.id}</span>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-sc-text-muted">{mod.position}</span>
        {features.map(f => (
          <Chip key={f} label={f as string} size="sm" variant="default" />
        ))}
      </div>
    </div>
  );
}

const LLMInspectorWidget: React.FC<LLMInspectorWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
}) => {
  const contextUsage = useSmartChatsStore(s => s.contextUsage);
  const usageStats = useSmartChatsStore(s => s.usageStats);

  // Snapshot data that requires reading from agent (refreshed on demand)
  const [snapshot, setSnapshot] = useState<{
    systemPrompt: string;
    messages: Array<{ role: string; content: string }>;
    modules: any[];
    trailingState: string;
    model: string;
    provider: string;
  } | null>(null);

  const refresh = useCallback(() => {
    const agent = useSmartChatsStore.getState().agent;
    if (!agent) return;

    const modules = agent.scm?.list_modules?.() || [];
    const built = agent.build_messages?.() || [];
    const systemPrompt = built[0]?.content || agent.system_msg?.content || '';

    // Extract trailing state message (last system message after conversation)
    const trailing = built.length > 1 && built[built.length - 1]?.role === 'system'
      ? built[built.length - 1].content
      : '';

    // All messages except the leading system prompt (keep trailing state visible)
    const messages = built.slice(1);

    setSnapshot({
      systemPrompt,
      messages,
      modules,
      trailingState: trailing,
      model: agent.model || '',
      provider: agent.provider || '',
    });
  }, []);

  const breakdown = contextUsage?.breakdown;

  return (
    <WidgetItem
      title="LLM Inspector"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
      controls={
        <Button variant="ghost" size="sm" onClick={refresh}>
          Refresh
        </Button>
      }
    >
      <div className="space-y-2">

        {/* Context Usage (live from store) */}
        <AccordionSection title="Context Window" badge={contextUsage ? `${contextUsage.usagePercent.toFixed(1)}%` : undefined} defaultOpen>
          {contextUsage ? (
            <div>
              <StatRow label="Model" value={contextUsage.model || '—'} />
              <StatRow label="Provider" value={contextUsage.provider || '—'} />
              <StatRow label="Used / Window" value={`${contextUsage.totalUsed.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()}`} />
              <StatRow label="Remaining" value={contextUsage.remaining?.toLocaleString() || '—'} />
              <StatRow label="Max Output" value={contextUsage.maxOutputTokens?.toLocaleString() || '—'} />
              <StatRow label="Messages" value={contextUsage.messageCount ?? '—'} />
              <StatRow label="Usage" value={`${contextUsage.usagePercent.toFixed(1)}%`} warn={contextUsage.isApproachingLimit} />
              {breakdown && (
                <>
                  <div className="mt-1.5 mb-0.5 text-xs text-sc-text-muted font-semibold">Breakdown</div>
                  <StatRow label="System" value={breakdown.systemMessage.toLocaleString()} />
                  <StatRow label="User" value={breakdown.userMessages.toLocaleString()} />
                  <StatRow label="Assistant" value={breakdown.assistantMessages.toLocaleString()} />
                </>
              )}
            </div>
          ) : (
            <p className="text-xs text-sc-text-muted">No context data yet</p>
          )}
        </AccordionSection>

        {/* Token Usage (live from store) */}
        <AccordionSection title="Token Usage" badge={usageStats ? `${usageStats.callCount} calls` : undefined} defaultOpen>
          {usageStats ? (
            <div>
              <StatRow label="Prompt tokens" value={usageStats.promptTokens.toLocaleString()} />
              <StatRow label="Completion tokens" value={usageStats.completionTokens.toLocaleString()} />
              <StatRow label="Cached input" value={usageStats.cachedInputTokens.toLocaleString()} />
              <StatRow label="Total tokens" value={usageStats.totalTokens.toLocaleString()} />
              <StatRow label="LLM calls" value={usageStats.callCount} />
              {usageStats.costUsd > 0 && (
                <StatRow label="Est. cost" value={`$${usageStats.costUsd.toFixed(4)}`} />
              )}
            </div>
          ) : (
            <p className="text-xs text-sc-text-muted">No usage data yet</p>
          )}
        </AccordionSection>

        {/* SCM Modules (from snapshot) */}
        <AccordionSection title="SCM Modules" badge={snapshot ? `${snapshot.modules.length}` : undefined}>
          {snapshot?.modules.length ? (
            <div className="space-y-0.5">
              {snapshot.modules.map(mod => <ModuleRow key={mod.id} mod={mod} />)}
            </div>
          ) : (
            <p className="text-xs text-sc-text-muted">{snapshot ? 'No modules' : 'Click Refresh'}</p>
          )}
        </AccordionSection>

        {/* Trailing State (from snapshot) */}
        <AccordionSection title="Trailing State">
          {snapshot?.trailingState ? (
            <pre className="text-xs font-mono text-sc-text whitespace-pre-wrap bg-[var(--sc-surface-secondary)] rounded-lg p-2 max-h-[200px] overflow-y-auto">
              {snapshot.trailingState}
            </pre>
          ) : (
            <p className="text-xs text-sc-text-muted">{snapshot ? 'No trailing state' : 'Click Refresh'}</p>
          )}
        </AccordionSection>

        {/* System Prompt (from snapshot) */}
        <AccordionSection title="System Prompt" badge={snapshot ? `${snapshot.systemPrompt.length} chars` : undefined}>
          {snapshot?.systemPrompt ? (
            <pre className="text-xs font-mono text-sc-text whitespace-pre-wrap bg-[var(--sc-surface-secondary)] rounded-lg p-2 max-h-[400px] overflow-y-auto">
              {snapshot.systemPrompt}
            </pre>
          ) : (
            <p className="text-xs text-sc-text-muted">Click Refresh to load</p>
          )}
        </AccordionSection>

        {/* Messages (from snapshot) */}
        <AccordionSection title="Messages" badge={snapshot ? `${snapshot.messages.length}` : undefined}>
          {snapshot?.messages.length ? (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {snapshot.messages.map((m, i) => (
                <SurfacePanel key={i} variant="tertiary" className="p-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Chip label={m.role} size="sm" variant={m.role === 'user' ? 'primary' : m.role === 'system' ? 'warning' : 'success'} />
                    <span className="text-xs text-sc-text-muted">{m.content.length} chars</span>
                  </div>
                  <pre className="text-xs font-mono text-sc-text whitespace-pre-wrap line-clamp-4">
                    {m.content}
                  </pre>
                </SurfacePanel>
              ))}
            </div>
          ) : (
            <p className="text-xs text-sc-text-muted">{snapshot ? 'No messages' : 'Click Refresh'}</p>
          )}
        </AccordionSection>

      </div>
    </WidgetItem>
  );
};

export default React.memo(LLMInspectorWidget);
