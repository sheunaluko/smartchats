'use client';

import React, { useEffect, useRef, useState } from 'react';
import WidgetItem from '../WidgetItem';
import {
    subscribeCliAgentMessage,
    subscribeCliUserSent,
    subscribeCliPatchMode,
    isCliPatched,
    unpatchCli,
    type AgentMessage,
} from '../modules/cli_agent';

type Bubble =
    | { from: 'agent'; text: string; timestamp: number }
    | { from: 'user';  text: string; timestamp: number };

interface AgentCallWidgetProps {
    fullscreen?: boolean;
    onFocus?: () => void;
    onClose?: () => void;
}

function fmtTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * AgentCallWidget — renders the patched-through conversation between the user
 * and an MCP-based coding agent (via smartchats-mcp-bridge).
 *
 * Reads:
 *   - subscribeCliAgentMessage → agent's send_message_to_user calls arrive here
 *   - subscribeCliUserSent → user's voice chunks (routed as agent_message)
 *   - subscribeCliPatchMode → widget toggles empty state ↔ conversation view
 *
 * Side effects:
 *   - Each new agent message is pushed into `window.tivi.ttsQueue.speakText`
 *     so the user hears it audibly. Rendering happens regardless of TTS availability.
 *
 * Actions:
 *   - Unpatch button calls `unpatchCli()` on the module.
 */
const AgentCallWidget: React.FC<AgentCallWidgetProps> = ({ fullscreen, onFocus, onClose }) => {
    const [patched, setPatched] = useState<boolean>(() => isCliPatched());
    const [bubbles, setBubbles] = useState<Bubble[]>([]);
    const scrollRef = useRef<HTMLDivElement | null>(null);

    // Subscribe once — subscriptions persist across renders.
    useEffect(() => subscribeCliPatchMode(setPatched), []);

    useEffect(() => {
        const offAgent = subscribeCliAgentMessage((msg: AgentMessage) => {
            setBubbles((prev) => [...prev, { from: 'agent', text: msg.text, timestamp: msg.timestamp }]);
            // Fire-and-forget TTS. If tivi hasn't initialized yet, this is a no-op.
            try {
                const tivi = (typeof window !== 'undefined' ? (window as any).tivi : undefined);
                tivi?.ttsQueue?.speakText?.(msg.text);
            } catch {
                // Swallow — bubble is still rendered.
            }
        });
        const offUser = subscribeCliUserSent((text, timestamp) => {
            setBubbles((prev) => [...prev, { from: 'user', text, timestamp }]);
        });
        return () => { offAgent(); offUser(); };
    }, []);

    // Auto-scroll to bottom on new bubble.
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [bubbles.length]);

    const handleUnpatch = () => {
        unpatchCli();
    };

    return (
        <WidgetItem title="Agent Call" fullscreen={fullscreen} onFocus={onFocus} onClose={onClose}>
            <div className="flex h-full w-full flex-col" style={{ minHeight: 0 }}>
                {/* Status bar */}
                <div
                    className="flex items-center justify-between border-b border-sc-border px-3 py-2 text-xs"
                    style={{ background: 'var(--sc-surface-secondary)' }}
                >
                    <div className="flex items-center gap-2">
                        <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ background: patched ? 'var(--sc-success, #22c55e)' : 'var(--sc-text-muted, #71717a)' }}
                        />
                        <span className="text-sc-text">{patched ? 'Patched through' : 'Not patched'}</span>
                    </div>
                    {patched && (
                        <button
                            type="button"
                            onClick={handleUnpatch}
                            className="rounded border border-sc-border px-2 py-0.5 text-xs text-sc-text hover:bg-sc-surface-hover"
                        >
                            Unpatch
                        </button>
                    )}
                </div>

                {/* Conversation */}
                <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto px-3 py-2"
                    style={{ minHeight: 0 }}
                >
                    {bubbles.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-center text-sm text-sc-text-muted">
                            {patched
                                ? 'Waiting for the agent to speak. Try saying something.'
                                : 'Not patched to an agent. Ask smartchats to "patch me through".'}
                        </div>
                    ) : (
                        <ul className="flex flex-col gap-2">
                            {bubbles.map((b, i) => (
                                <li
                                    key={`${b.timestamp}-${i}`}
                                    className={`flex ${b.from === 'agent' ? 'justify-start' : 'justify-end'}`}
                                >
                                    <div
                                        className="max-w-[80%] rounded-lg px-3 py-2 text-sm"
                                        style={{
                                            background: b.from === 'agent'
                                                ? 'var(--sc-surface-secondary, #202024)'
                                                : 'var(--sc-primary, #3b82f6)',
                                            color: b.from === 'agent'
                                                ? 'var(--sc-text, #fafafa)'
                                                : '#ffffff',
                                        }}
                                    >
                                        <div className="whitespace-pre-wrap break-words">{b.text}</div>
                                        <div
                                            className="mt-1 text-[10px] opacity-60"
                                            style={{ textAlign: b.from === 'agent' ? 'left' : 'right' }}
                                        >
                                            {fmtTime(b.timestamp)}
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </WidgetItem>
    );
};

export default AgentCallWidget;
