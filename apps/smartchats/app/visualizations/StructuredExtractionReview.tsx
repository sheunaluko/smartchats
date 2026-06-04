'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { z } from 'zod';
import { SurfacePanel } from '../ui/recipes/SurfacePanel';
import { Chip } from '../ui/Chip';
import { Button } from '../ui/Button';
import { useSmartChatsStore } from '../store/useSmartChatsStore';
import type { ExtractionReviewProps, ExtractionField } from './types';

const AutoReviewVerdictSchema = z.object({
  summary: z.string(),
  verdicts: z.array(z.object({
    index: z.number(),
    status: z.enum(['accepted', 'denied']),
    reason: z.string().optional(),
  })),
});

type MetricStatus = 'draft' | 'edited' | 'accepted' | 'denied';

const statusVariant: Record<MetricStatus, 'default' | 'primary' | 'success' | 'danger' | 'warning'> = {
  draft: 'default',
  edited: 'warning',
  accepted: 'success',
  denied: 'danger',
};

function validate(
  sources: Array<Record<string, any>>,
  extractions: Record<string, any>,
  sourceKey: string
): string[] {
  const errors: string[] = [];
  if (!Array.isArray(sources) || sources.length === 0)
    errors.push('sources must be a non-empty array');
  if (!extractions || typeof extractions !== 'object')
    errors.push('extractions must be an object');
  if (errors.length) return errors;

  const missing = sources.filter(s => s[sourceKey] === undefined || s[sourceKey] === null);
  if (missing.length) errors.push(`${missing.length} sources missing '${sourceKey}' field`);

  const ids = new Set(sources.map(s => String(s[sourceKey])));
  const orphaned = Object.keys(extractions).filter(k => !ids.has(k));
  if (orphaned.length) errors.push(`${orphaned.length} extractions reference non-existent sources`);

  return errors;
}

export function StructuredExtractionReview({
  sources,
  extractions,
  source_key = 'id',
  fields,
  title,
}: ExtractionReviewProps) {
  const wsKey = 'structured_extractions_review';

  // Validation
  const errors = validate(sources, extractions, source_key);
  if (errors.length > 0) {
    return (
      <SurfacePanel variant="secondary" className="p-4 space-y-2">
        <p className="text-sm font-semibold text-sc-danger">Validation Errors</p>
        <ul className="list-disc list-inside text-xs text-sc-text-muted space-y-1">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      </SurfacePanel>
    );
  }

  return (
    <ReviewContent
      sources={sources}
      extractions={extractions}
      sourceKey={source_key}
      fields={fields}
      title={title}
      wsKey={wsKey}
    />
  );
}

function ReviewContent({
  sources,
  extractions,
  sourceKey,
  fields,
  title,
  wsKey,
}: {
  sources: Array<Record<string, any>>;
  extractions: Record<string, any>;
  sourceKey: string;
  fields: ExtractionField[];
  title?: string;
  wsKey: string;
}) {
  const [statuses, setStatuses] = useState<Record<string, MetricStatus>>(() => {
    const existing = useSmartChatsStore.getState().workspace[wsKey];
    if (!existing) return {};
    const restored: Record<string, MetricStatus> = {};
    for (const source of sources) {
      const id = String(source[sourceKey]);
      const ext = existing[id];
      if (!ext?.metrics) continue;
      ext.metrics.forEach((m: any, idx: number) => {
        if (m._status && m._status !== 'draft') restored[`${id}_${idx}`] = m._status;
      });
    }
    return restored;
  });

  const [editedMetrics, setEditedMetrics] = useState<Record<string, any>>(() => {
    const existing = useSmartChatsStore.getState().workspace[wsKey];
    if (!existing) return {};
    const restored: Record<string, any> = {};
    for (const source of sources) {
      const id = String(source[sourceKey]);
      const ext = existing[id];
      if (!ext?.metrics) continue;
      ext.metrics.forEach((m: any, idx: number) => {
        if (m._status === 'edited') {
          const { _status, ...data } = m;
          restored[`${id}_${idx}`] = data;
        }
      });
    }
    return restored;
  });

  const persistToWorkspace = useCallback((
    nextStatuses: Record<string, MetricStatus>,
    nextEdited: Record<string, any>
  ) => {
    const result: Record<string, any> = {};
    for (const source of sources) {
      const id = String(source[sourceKey]);
      const extraction = extractions[id];
      if (!extraction?.metrics) continue;

      const metrics = extraction.metrics.map((m: any, idx: number) => {
        const key = `${id}_${idx}`;
        const status = nextStatuses[key] || 'draft';
        const data = nextEdited[key] || m;
        return { ...data, _status: status };
      });
      result[id] = { ...extraction, metrics };
    }

    const ws = useSmartChatsStore.getState().workspace;
    useSmartChatsStore.getState().updateWorkspace({ ...ws, [wsKey]: result });
  }, [sources, extractions, sourceKey, wsKey]);

  // Sync to workspace whenever statuses or editedMetrics change (after render, not during)
  const skipInitialSync = useRef(true);
  useEffect(() => {
    if (skipInitialSync.current) {
      skipInitialSync.current = false;
      return;
    }
    persistToWorkspace(statuses, editedMetrics);
  }, [statuses, editedMetrics, persistToWorkspace]);

  const setStatus = useCallback((key: string, status: MetricStatus) => {
    setStatuses(prev => ({ ...prev, [key]: status }));
  }, []);

  const acceptAllForSource = useCallback((sourceId: string) => {
    const extraction = extractions[sourceId];
    if (!extraction?.metrics) return;
    setStatuses(prev => {
      const next = { ...prev };
      extraction.metrics.forEach((_: any, idx: number) => {
        next[`${sourceId}_${idx}`] = 'accepted';
      });
      return next;
    });
  }, [extractions]);

  const [reviewing, setReviewing] = useState(false);
  const [reviewSummary, setReviewSummary] = useState<{ text: string; allAccepted: boolean } | null>(null);

  const handleAutoReview = useCallback(async () => {
    setReviewing(true);
    setReviewSummary(null);

    const processId = `auto-review-${Date.now()}`;
    const store = useSmartChatsStore.getState();
    store.handleProcessSpawned({
      id: processId,
      name: 'Auto Review',
      mode: 'execute',
      status: 'running',
      completionMode: 'standard',
      startedAt: Date.now(),
    });

    try {
      // Build flat list of all metrics with their source context
      const items: Array<{ index: number; source_content: string; source_created_at?: string; metric: any }> = [];
      const indexToKey: string[] = [];
      for (const source of sources) {
        const id = String(source[sourceKey]);
        const extraction = extractions[id];
        if (!extraction?.metrics) continue;
        extraction.metrics.forEach((metric: any, idx: number) => {
          items.push({
            index: indexToKey.length,
            source_content: source.content || '',
            source_created_at: source.created_at,
            metric,
          });
          indexToKey.push(`${id}_${idx}`);
        });
      }

      const agent = useSmartChatsStore.getState().agent;
      if (!agent) throw new Error('Agent not available');

      const fieldDesc = fields.map(f => `${f.key} (${f.label})`).join(', ');

      const messages = [
        {
          role: 'system' as const,
          content: `You are reviewing metric extractions from user log entries. For each item, evaluate whether the extracted metric accurately captures what the source log describes. The key fields to validate are: ${fieldDesc}. Accept if these fields correctly represent the log content. Deny if the extraction is incorrect, fabricated, or misinterprets the log.\n\nReturn a verdict for each item by its index, and a short summary sentence of your review.`,
        },
        {
          role: 'user' as const,
          content: JSON.stringify(items),
        },
      ];

      const result = await agent.run_structured_completion({
        schema: AutoReviewVerdictSchema,
        schema_name: 'auto_review_verdicts',
        messages,
      });

      // Apply verdicts
      const allKeys = new Set(indexToKey);
      const matchedKeys = new Set<string>();

      setStatuses(prev => {
        const next = { ...prev };
        for (const v of result.verdicts) {
          const key = indexToKey[v.index];
          if (key) {
            next[key] = v.status;
            matchedKeys.add(key);
          }
        }
        return next;
      });

      // Check coverage
      const missing = [...allKeys].filter(k => !matchedKeys.has(k));
      let summaryText = result.summary;
      if (missing.length) {
        console.warn('[AutoReview] Missing verdicts for:', missing);
        summaryText += ` (${missing.length} metrics not evaluated)`;
      }

      const allAccepted = result.verdicts.every((v: any) => v.status === 'accepted') && missing.length === 0;
      setReviewSummary({ text: summaryText, allAccepted });

      const now = Date.now();
      store.handleProcessComplete({
        id: processId,
        status: 'completed',
        exitCode: 0,
        finishedAt: now,
        elapsed: now - (store.processes.find(p => p.id === processId)?.startedAt || now),
      });
    } catch (err) {
      console.error('[AutoReview] failed:', err);
      setReviewSummary({ text: `Auto review failed: ${err instanceof Error ? err.message : String(err)}`, allAccepted: false });
      const now = Date.now();
      store.handleProcessComplete({
        id: processId,
        status: 'failed',
        exitCode: 1,
        finishedAt: now,
        elapsed: now - (store.processes.find(p => p.id === processId)?.startedAt || now),
      });
    } finally {
      setReviewing(false);
    }
  }, [sources, sourceKey, extractions, fields, editedMetrics, persistToWorkspace]);

  const [submitted, setSubmitted] = useState(() => {
    return !!useSmartChatsStore.getState().workspace[wsKey]?._submitted;
  });

  const handleSubmit = useCallback(() => {
    persistToWorkspace(statuses, editedMetrics);

    // Mark submitted in workspace so it survives remounts
    const ws = useSmartChatsStore.getState().workspace;
    useSmartChatsStore.getState().updateWorkspace({
      ...ws,
      [wsKey]: { ...ws[wsKey], _submitted: true },
    });

    setSubmitted(true);

    // Build summary and notify the agent
    const accepted: string[] = [];
    const denied: string[] = [];
    for (const [key, status] of Object.entries(statuses)) {
      if (status === 'accepted') accepted.push(key);
      else if (status === 'denied') denied.push(key);
    }

    useSmartChatsStore.getState().sendMessageSync(
      `[Extraction review submitted] ${accepted.length} accepted, ${denied.length} denied. Review data saved to workspace key "${wsKey}".`
    );
  }, [statuses, editedMetrics, persistToWorkspace, wsKey]);

  const saveEdits = useCallback((key: string, json: string) => {
    try {
      const parsed = JSON.parse(json);
      setEditedMetrics(prev => ({ ...prev, [key]: parsed }));
      setStatuses(prev => ({ ...prev, [key]: 'edited' as MetricStatus }));
    } catch { /* invalid JSON, ignore */ }
  }, []);

  return (
    <div className="space-y-3">
      {title && (
        <h3 className="text-sm font-semibold text-sc-text">{title}</h3>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={handleAutoReview}
          disabled={reviewing || submitted}
        >
          {reviewing ? 'Reviewing...' : 'Auto Review'}
        </Button>
        {reviewing && (
          <span className="text-xs text-sc-text-muted animate-pulse">LLM evaluating extractions...</span>
        )}
        {reviewSummary && (
          <span className={`text-xs ${reviewSummary.allAccepted ? 'text-sc-success' : 'text-sc-text-muted'}`}>
            {reviewSummary.allAccepted ? '\u2713 ' : ''}{reviewSummary.text}
          </span>
        )}
      </div>
      <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
        {sources.map(source => {
          const id = String(source[sourceKey]);
          const extraction = extractions[id];
          if (!extraction) return null;

          return (
            <SurfacePanel key={id} variant="secondary" className="p-3 space-y-2">
              {/* Source header */}
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-xs text-sc-text-muted shrink-0 space-x-2">
                  {source.ts && (
                    <span title="Event time (ts, real UTC)">
                      {new Date(source.ts).toLocaleString(undefined)}
                    </span>
                  )}
                  {source.created_at && (
                    <span className="opacity-50" title="UTC (created_at)">
                      (UTC: {new Date(source.created_at).toLocaleString(undefined, { timeZone: 'UTC' })})
                    </span>
                  )}
                </span>
                {source.content && (
                  <span className="text-xs text-sc-text flex-1">{source.content}</span>
                )}
                {source.category && <Chip label={source.category} size="sm" variant="primary" />}
                {Array.isArray(extraction.metrics) && extraction.metrics.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => acceptAllForSource(id)}>
                    Accept All
                  </Button>
                )}
              </div>

              {/* Metrics */}
              {Array.isArray(extraction.metrics) && extraction.metrics.map((metric: any, idx: number) => {
                const key = `${id}_${idx}`;
                const status = statuses[key] || 'draft';
                const currentMetric = editedMetrics[key] || metric;

                return (
                  <MetricCard
                    key={key}
                    metricKey={key}
                    metric={currentMetric}
                    status={status}
                    fields={fields}
                    onAccept={() => setStatus(key, 'accepted')}
                    onDeny={() => setStatus(key, 'denied')}
                    onSaveEdits={(json) => saveEdits(key, json)}
                  />
                );
              })}
            </SurfacePanel>
          );
        })}
      </div>
      <div className="flex items-center gap-3 pt-1">
        <Button variant="solid" size="sm" onClick={handleSubmit} disabled={submitted}>
          {submitted ? 'Submitted' : 'Submit'}
        </Button>
        {submitted && (
          <Chip label="saved to workspace" size="sm" variant="success" />
        )}
      </div>
    </div>
  );
}

function MetricCard({
  metricKey,
  metric,
  status,
  fields,
  onAccept,
  onDeny,
  onSaveEdits,
}: {
  metricKey: string;
  metric: any;
  status: MetricStatus;
  fields: ExtractionField[];
  onAccept: () => void;
  onDeny: () => void;
  onSaveEdits: (json: string) => void;
}) {
  const [editJson, setEditJson] = useState(JSON.stringify(metric, null, 2));

  // Sync textarea when metric changes externally (after save)
  const metricStr = JSON.stringify(metric, null, 2);
  if (editJson !== metricStr && status !== 'draft') {
    // only resync after a save
  }

  return (
    <SurfacePanel variant="tertiary" className="p-2.5 space-y-2">
      {/* Chips row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {fields.map(f => {
          const val = metric[f.key];
          if (val === undefined || val === null) return null;
          return (
            <span
              key={f.key}
              className="inline-flex items-center gap-1 rounded-full text-xs px-2 py-0.5 bg-[var(--sc-surface-secondary)]"
            >
              <span className="text-sc-text-muted">{f.label}:</span>
              <span className="text-sc-warning font-semibold">
                {f.key === 'ts' && typeof val === 'string'
                  // `ts` is a real-UTC ISO instant; default `toLocaleString()`
                  // renders it in the user's tz, which is what they want.
                  ? new Date(val).toLocaleString()
                  : f.key === 'local_date' && typeof val === 'string'
                  // `local_date` is a YYYY-MM-DD string already in the user's
                  // perceived day — render verbatim, no Date parsing.
                  ? val
                  : String(val)}
              </span>
            </span>
          );
        })}
      </div>

      {/* Collapsible JSON editor */}
      <details className="text-xs">
        <summary className="cursor-pointer text-sc-text-muted hover:text-sc-text transition-colors duration-150">
          Raw JSON
        </summary>
        <textarea
          className="mt-1 w-full font-mono text-xs bg-[var(--sc-surface-secondary)] text-sc-text border border-[var(--sc-separator)] rounded-lg p-2 resize-y min-h-[60px]"
          value={editJson}
          onChange={e => setEditJson(e.target.value)}
          rows={4}
        />
        <div className="mt-1">
          <Button variant="ghost" size="sm" onClick={() => onSaveEdits(editJson)}>
            Save edits
          </Button>
        </div>
      </details>

      {/* Action buttons + status */}
      <div className="flex items-center gap-2">
        <Button variant="solid" size="sm" onClick={onAccept}>Accept</Button>
        <Button variant="outline" size="sm" onClick={onDeny}>Deny</Button>
        <Chip
          label={status}
          size="sm"
          variant={statusVariant[status]}
        />
      </div>
    </SurfacePanel>
  );
}
