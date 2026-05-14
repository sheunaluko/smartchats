'use client';

import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Input } from '../ui/Input';
import { InspectorSection, MetricRow, SurfacePanel } from '../ui/recipes';
import type { AgentMonitorState } from '../store/useSmartChatsStore';

interface AgentProcessMonitorProps {
    state: AgentMonitorState;
    processName: string;
    onSendInput?: (text: string) => void;
}

const AgentProcessMonitor: React.FC<AgentProcessMonitorProps> = ({ state, processName, onSendInput }) => {
    const [inputText, setInputText] = useState('');

    const handleSend = () => {
        if (!inputText.trim() || !onSendInput) return;
        onSendInput(inputText.trim());
        setInputText('');
    };

    const codeContent = state.executionStatus === 'running'
        ? state.currentCode || 'Running...'
        : state.codeResult !== undefined
            ? typeof state.codeResult === 'string' ? state.codeResult : JSON.stringify(state.codeResult, null, 2)
            : state.currentCode || 'No code executed';

    return (
        <SurfacePanel variant="secondary" className="flex flex-col gap-3 p-3">
            <MetricRow label="Monitor" value={processName} />

            {state.pendingInput && (
                <InspectorSection label="Awaiting Input" tone="warning">
                    <div className="rounded-[14px] border border-sc-warning/30 bg-sc-warning/10 p-3 text-xs text-sc-warning whitespace-pre-wrap break-words">
                            {typeof state.pendingInput.data === 'string'
                                ? state.pendingInput.data
                                : JSON.stringify(state.pendingInput.data, null, 2)}
                    </div>
                    <div className="flex items-center gap-2">
                            <Input
                                placeholder="Send input..."
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                                size="sm"
                                className="flex-1 font-mono text-xs"
                            />
                            <Button
                                onClick={handleSend}
                                size="sm"
                                variant="soft"
                                disabled={!onSendInput || !inputText.trim()}
                                className="shrink-0"
                                aria-label="Send process input"
                            >
                                <Send size={16} />
                            </Button>
                    </div>
                </InspectorSection>
            )}

            <InspectorSection label="Response" tone="primary">
                <div className="rounded-[14px] border border-sc-primary/20 bg-[var(--sc-accent-soft)] px-3 py-2 text-[0.8rem] text-sc-primary whitespace-pre-wrap break-words max-h-[100px] scrollbar-hide overflow-y-auto">
                    {state.lastResponse || 'Awaiting...'}
                </div>
            </InspectorSection>

            <InspectorSection label="Thought">
                <p className="text-xs italic text-sc-text-muted whitespace-pre-wrap break-words max-h-[60px] scrollbar-hide overflow-y-auto">
                    {state.lastThought || 'No thoughts yet'}
                </p>
            </InspectorSection>

            <InspectorSection label="Function">
                {state.lastFunctionCall ? (
                    <div className="flex items-center gap-2 rounded-[14px] border border-[var(--sc-separator)] bg-[var(--sc-surface-tertiary)] px-3 py-2">
                        {state.executionStatus === 'running' && (
                            <div className="w-1.5 h-1.5 rounded-full bg-sc-success animate-pulse" />
                        )}
                        <Chip
                            label={state.lastFunctionCall.name}
                            size="sm"
                            variant="primary"
                            className="text-[0.65rem]"
                        />
                        <span className="text-[0.65rem] opacity-50 overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]">
                            {state.lastFunctionCall.args ? JSON.stringify(state.lastFunctionCall.args) : ''}
                        </span>
                    </div>
                ) : (
                    <p className="text-[0.7rem] text-sc-text-muted">No function calls</p>
                )}
            </InspectorSection>

            <InspectorSection label="Code" tone={state.executionStatus === 'error' ? 'danger' : state.executionStatus === 'running' ? 'primary' : 'default'}>
                <pre
                    className={`m-0 rounded-[14px] border border-[var(--sc-separator)] bg-[var(--sc-surface)] p-3 text-[0.7rem] font-mono max-h-[160px] scrollbar-hide overflow-y-auto whitespace-pre-wrap break-all
                        ${state.executionStatus === 'error' ? 'text-sc-danger' : 'text-sc-text'}`}
                >
                    {codeContent}
                </pre>
            </InspectorSection>
        </SurfacePanel>
    );
};

export default React.memo(AgentProcessMonitor);
