'use client';

import React, { useState, useEffect } from 'react';
import WidgetItem from '../WidgetItem';
import { Chip } from '../ui/Chip';
import { DataCard, EmptyState, InspectorSection, MetricRow, SurfacePanel } from '../ui/recipes';
import AgentProcessMonitor from './AgentProcessMonitor';
import type { AgentMonitorState } from '../store/useSmartChatsStore';

interface ProcessInfo {
    id: string;
    name: string;
    mode: string;
    status: string;
    completionMode: string;
    startedAt: number;
    finishedAt?: number;
    exitCode?: number;
    elapsed: number;
    stdoutLines: number;
    stderrLines: number;
}

interface OutputLine {
    ts: number;
    line: string;
}

interface ProcessWidgetProps {
    fullscreen?: boolean;
    onFocus?: () => void;
    onClose?: () => void;
    processes: ProcessInfo[];
    processOutputs: Record<string, { stdout: OutputLine[]; stderr: OutputLine[] }>;
    agentMonitorStates?: Record<string, AgentMonitorState>;
    onSendProcessInput?: (processId: string, data: any) => void;
}

const statusConfig: Record<string, { icon: string; colorClass: string }> = {
    running: { icon: '\u25CF', colorClass: 'text-sc-primary' },
    completed: { icon: '\u2713', colorClass: 'text-sc-success' },
    failed: { icon: '\u2717', colorClass: 'text-sc-danger' },
    killed: { icon: '\u25CC', colorClass: 'text-sc-text-muted' },
};

function formatElapsed(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
}

const ProcessWidget: React.FC<ProcessWidgetProps> = ({
    fullscreen = false,
    onFocus,
    onClose,
    processes,
    processOutputs,
    agentMonitorStates,
    onSendProcessInput,
}) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [rawView, setRawView] = useState<Record<string, boolean>>({});
    const [, setTick] = useState(0);

    // Auto-update elapsed time for running processes
    useEffect(() => {
        const hasRunning = processes.some(p => p.status === 'running');
        if (!hasRunning) return;
        const interval = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, [processes]);


    if (processes.length === 0) {
        return (
            <WidgetItem title="Processes" fullscreen={fullscreen} onFocus={onFocus} onClose={onClose}>
                <EmptyState title="No background processes" description="Long-running tasks, agents, and shell output will appear here while the assistant is working." className="m-3" />
            </WidgetItem>
        );
    }

    return (
        <WidgetItem title="Processes" fullscreen={fullscreen} onFocus={onFocus} onClose={onClose}>
            <div className="scrollbar-hide overflow-y-auto max-h-[95%]">
                {processes.map(proc => {
                    const config = statusConfig[proc.status] || statusConfig.running;
                    const elapsed = proc.status === 'running'
                        ? Date.now() - proc.startedAt
                        : proc.elapsed;
                    const isExpanded = expandedId === proc.id;
                    const output = processOutputs[proc.id];

                    return (
                        <DataCard
                            key={proc.id}
                            tone={proc.status === 'failed' ? 'danger' : proc.status === 'completed' ? 'success' : proc.status === 'running' ? 'primary' : 'default'}
                            interactive
                            className="mb-3"
                            onClick={() => setExpandedId(isExpanded ? null : proc.id)}
                            header={
                                <div
                                    className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer"
                                >
                                    <span
                                        className={`${config.colorClass} text-[0.9rem] ${proc.status === 'running' ? 'animate-pulse' : ''}`}
                                    >
                                        {config.icon}
                                    </span>
                                    <p className="flex-1 truncate text-sm font-medium text-sc-text">
                                        {proc.name}
                                    </p>
                                    <span className="text-xs text-sc-text-muted">
                                        {formatElapsed(elapsed)}
                                    </span>
                                    <Chip
                                        label={proc.mode}
                                        size="sm"
                                        className="text-[0.65rem]"
                                    />
                                </div>
                            }
                        >
                            <div className="space-y-2">
                                <MetricRow label="Status" value={proc.status} tone={proc.status === 'failed' ? 'danger' : proc.status === 'completed' ? 'success' : proc.status === 'running' ? 'primary' : 'default'} />
                                <MetricRow label="Stdout lines" value={proc.stdoutLines} />
                                <MetricRow label="Stderr lines" value={proc.stderrLines} tone={proc.stderrLines > 0 ? 'danger' : 'default'} />
                            </div>

                            {isExpanded && (() => {
                                const monitorState = agentMonitorStates?.[proc.id];
                                const showMonitor = proc.mode === 'agent' && monitorState && !rawView[proc.id];

                                return (
                                    <div className="pt-1">
                                        {proc.mode === 'agent' && monitorState && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setRawView(r => ({ ...r, [proc.id]: !r[proc.id] }));
                                                }}
                                                className="status-focused mb-2 ml-auto block rounded-full px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.14em] text-sc-text-muted hover:bg-[var(--sc-default-hover)]"
                                            >
                                                {showMonitor ? 'Raw Output' : 'Agent Monitor'}
                                            </button>
                                        )}

                                        {showMonitor ? (
                                            <AgentProcessMonitor
                                                state={monitorState}
                                                processName={proc.name}
                                                onSendInput={onSendProcessInput ? (text) => onSendProcessInput(proc.id, text) : undefined}
                                            />
                                        ) : output ? (
                                            <InspectorSection label="Output">
                                                <SurfacePanel variant="secondary" className="max-h-[200px] overflow-y-auto p-3 font-mono text-xs scrollbar-hide">
                                                    {output.stdout.length === 0 && output.stderr.length === 0 && (
                                                        <span className="text-xs text-sc-text-muted">
                                                            No output yet
                                                        </span>
                                                    )}
                                                    {output.stdout.map((l, i) => (
                                                        <div key={`o-${i}`} className="text-sc-text-muted whitespace-pre-wrap break-all">
                                                            {l.line}
                                                        </div>
                                                    ))}
                                                    {output.stderr.map((l, i) => (
                                                        <div key={`e-${i}`} className="text-sc-danger whitespace-pre-wrap break-all">
                                                            {l.line}
                                                        </div>
                                                    ))}
                                                </SurfacePanel>
                                            </InspectorSection>
                                        ) : null}
                                    </div>
                                );
                            })()}
                        </DataCard>
                    );
                })}
            </div>
        </WidgetItem>
    );
};

export default React.memo(ProcessWidget);
