'use client';

/**
 * EventTracePanel — live filtered view of insights events emitted during
 * the current session. Polls `insightsClient.exportSession()` at ~4Hz and
 * displays the most recent N audio-related events. Click an event to
 * expand its payload; click "copy" to copy as JSON.
 *
 * Filter is audio-pipeline-only by default: tts_playback_timing,
 * voice_session_start/stop, tts_stream_error, runtime_error, ui_click.
 * Toggle "all" to see every event in the session.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useInsights } from '@/context/InsightsContext';

type InsightsEvent = {
    event_id: string;
    event_type: string;
    timestamp: number;
    payload: Record<string, any>;
    tags?: string[];
};

const AUDIO_EVENT_TYPES = new Set([
    'tts_playback_timing',
    'tts_stream_error',
    'voice_session_start',
    'voice_session_stop',
    'voice_interaction_complete',
    'runtime_error',
    'ui_click',
    'llm_cancel',
]);

const POLL_MS = 250;
const MAX_ROWS = 50;

export function EventTracePanel() {
    const { client } = useInsights();
    const [events, setEvents] = useState<InsightsEvent[]>([]);
    const [showAll, setShowAll] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const intervalRef = useRef<number | null>(null);

    useEffect(() => {
        if (!client) return;
        const pull = () => {
            try {
                const session = client.exportSession?.();
                if (session?.events) {
                    setEvents(session.events.slice(-MAX_ROWS * 4) as InsightsEvent[]);
                }
            } catch { /* ignore polling errors */ }
        };
        pull();
        intervalRef.current = window.setInterval(pull, POLL_MS) as unknown as number;
        return () => {
            if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
            intervalRef.current = null;
        };
    }, [client]);

    const visible = useMemo(() => {
        const filtered = showAll
            ? events
            : events.filter(e => AUDIO_EVENT_TYPES.has(e.event_type));
        return filtered.slice(-MAX_ROWS).reverse();
    }, [events, showAll]);

    function toggle(id: string) {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    function copy(payload: any) {
        try {
            navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
        } catch { /* swallow */ }
    }

    return (
        <div
            style={{
                display: 'flex', flexDirection: 'column', height: '100%',
                color: '#dcdcdc', fontFamily: 'ui-monospace, monospace', fontSize: 11,
                background: '#11111a', borderRadius: 8, overflow: 'hidden',
                border: '1px solid #2a2a3a',
            }}
        >
            <div
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px', borderBottom: '1px solid #2a2a3a',
                    background: '#181826', color: '#a0a0c0',
                }}
            >
                <span>event trace · {visible.length}/{events.length}</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                        type="checkbox"
                        checked={showAll}
                        onChange={e => setShowAll(e.target.checked)}
                    />
                    all events
                </label>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {visible.length === 0 && (
                    <div style={{ padding: 12, color: '#666' }}>
                        no events yet — start voice and have a conversation
                    </div>
                )}
                {visible.map(ev => {
                    const isOpen = expanded.has(ev.event_id);
                    const t = new Date(ev.timestamp).toISOString().slice(11, 23);
                    const hint = summarizeEvent(ev);
                    return (
                        <div
                            key={ev.event_id}
                            style={{
                                padding: '4px 10px', borderBottom: '1px solid #1d1d2c',
                                cursor: 'pointer',
                            }}
                            onClick={() => toggle(ev.event_id)}
                        >
                            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                                <span style={{ color: '#666', minWidth: 80 }}>{t}</span>
                                <span style={{ color: colorForType(ev.event_type), minWidth: 180 }}>
                                    {ev.event_type}
                                </span>
                                <span style={{ color: '#888', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {hint}
                                </span>
                                <button
                                    onClick={e => { e.stopPropagation(); copy(ev); }}
                                    style={{
                                        background: 'transparent', color: '#666', border: 'none',
                                        cursor: 'pointer', fontSize: 10, padding: '2px 4px',
                                    }}
                                    title="copy event as JSON"
                                >
                                    copy
                                </button>
                            </div>
                            {isOpen && (
                                <pre style={{
                                    margin: '4px 0 0 88px', padding: '6px 8px',
                                    background: '#0a0a14', borderRadius: 4,
                                    color: '#c0c0e0', fontSize: 10,
                                    overflow: 'auto', maxHeight: 240,
                                }}>
                                    {JSON.stringify(ev.payload, null, 2)}
                                </pre>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function summarizeEvent(ev: InsightsEvent): string {
    const p = ev.payload || {};
    switch (ev.event_type) {
        case 'tts_playback_timing': {
            const fc = p.first_chunk;
            if (!fc) return `${p.total_chunks ?? 0} chunks · cancelled=${p.cancelled}`;
            return `chunk0 slack=${fc.schedule_slack_ms?.toFixed(0)}ms snapped=${fc.snapped_forward} · ${p.total_chunks} chunks · snap_count=${p.snap_forward_count}`;
        }
        case 'voice_session_start':
        case 'voice_session_stop':
            return '';
        case 'voice_interaction_complete':
            return `e2e=${p.durations?.end_to_end ?? '?'}ms · ttfs=${p.durations?.text_to_first_speech ?? '?'}ms`;
        case 'ui_click':
            return `${p.name ?? '?'} · ${p.surface ?? '?'}`;
        case 'tts_stream_error':
            return `${p.stage ?? '?'}: ${p.error_message ?? p.error_name ?? '?'}`;
        case 'runtime_error':
            return `${p.source}: ${p.error_message?.slice(0, 100) ?? '?'}`;
        case 'llm_cancel':
            return `${p.flow ?? '?'} · time_to_cancel=${p.time_to_cancel_ms ?? '?'}ms`;
        default:
            return Object.keys(p).slice(0, 3).map(k => `${k}=${truncate(String(p[k]), 18)}`).join(' ');
    }
}

function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function colorForType(t: string): string {
    if (t.includes('error') || t.includes('fail')) return '#ff7070';
    if (t === 'tts_playback_timing') return '#88ccff';
    if (t.startsWith('voice_')) return '#ffcc66';
    if (t === 'ui_click') return '#88dd88';
    if (t === 'llm_cancel') return '#cc99ff';
    return '#a0a0c0';
}
