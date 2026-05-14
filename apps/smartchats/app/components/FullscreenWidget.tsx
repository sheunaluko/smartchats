'use client';

import React from 'react';

// Import all widget components
import ChatWidget from '../widgets/ChatWidget';
import ChatInputWidget from '../widgets/ChatInputWidget';
import WorkspaceWidget from '../widgets/WorkspaceWidget';
import ThoughtsWidget from '../widgets/ThoughtsWidget';
import LogWidget from '../widgets/LogWidget';
import CodeWidget from '../widgets/CodeWidget';
import HTMLWidget from '../widgets/HTMLWidget';
import CodeExecutionWidget from '../widgets/CodeExecutionWidget';
import FunctionCallsWidget from '../widgets/FunctionCallsWidget';
import VariableInspectorWidget from '../widgets/VariableInspectorWidget';
import SandboxLogsWidget from '../widgets/SandboxLogsWidget';
import HistoryWidget from '../widgets/HistoryWidget';
import KnowledgeGraphWidget from '../widgets/KnowledgeGraphWidget';
import StreamViewerWidget from '../widgets/StreamViewerWidget';
import SpeechQueueWidget from '../widgets/SpeechQueueWidget';
import ProcessWidget from '../widgets/ProcessWidget';
import VisualizationWidget from '../widgets/VisualizationWidget';
import LLMInspectorWidget from '../widgets/LLMInspectorWidget';
import type { QueueEntryStatus } from '@lab-components/tivi/lib/tts_queue';
import type { ExecutionSnapshot } from '../types/execution';

/**
 * Props needed by renderWidget to instantiate any widget.
 */
export interface WidgetRenderProps {
    chatHistory: Array<{ role: string; content: string }>;
    workspace: Record<string, any>;
    thoughtHistory: string[];
    logHistory: string[];
    codeParams: { code: string; mode: string };
    htmlDisplay: string;
    // Execution state
    currentCode: string;
    executionId: string;
    executionStatus: 'idle' | 'running' | 'success' | 'error';
    executionError: string;
    executionDuration: number;
    executionResult: any;
    functionCalls: any[];
    variableAssignments: any[];
    sandboxLogs: any[];
    executionHistory: ExecutionSnapshot[];
    selectedIndex: number;
    isPinned: boolean;
    currentExecution: ExecutionSnapshot | null;
    // Knowledge Graph
    kgGraphData: any;
    kgMode: any;
    kgDepth: number;
    kgVisibleRelationKinds: Set<string>;
    kgAvailableRelationKinds: string[];
    kgIsSearching: boolean;
    kgAutoDisplay: boolean;
    // Visualizations
    activeVisualization: { type: string; props: any } | null;
    clearVisualization: () => void;
    // HTML
    activeHtml: string | null;
    clearHtml: () => void;
    // Stream & Speech
    streamChunks: string[];
    speechQueueState: QueueEntryStatus[];
    // Processes
    processes: any[];
    processOutputs: Record<string, any>;
    agentMonitorStates: Record<string, any>;
    // Callbacks
    transcriptionCb: (text: string) => Promise<void>;
    handleCodeChange: (params: any) => void;
    handleHistoryItemClick: (index: number) => void;
    setIsPinned: (v: boolean) => void;
    setFocusedWidget: (id: string | null) => void;
    setKgGraphData: (data: any) => void;
    updateKgSettings: (partial: any) => void;
    setKgVisibleRelationKinds: (kinds: Set<string>) => void;
    clearKgGraph: () => void;
    searchKnowledgeGraph: (query: string, depth: number) => Promise<any>;
    onSendProcessInput: (processId: string, data: any) => void;
    vizContext?: { tivi?: any; tiviSettings?: any; updateTiviSettings?: (partial: any) => void };
}

/**
 * Renders a widget by ID with the given props.
 * Used by both the grid layout and the fullscreen overlay to avoid duplication.
 */
export function renderWidget(
    widgetId: string,
    props: WidgetRenderProps,
    options?: { fullscreen?: boolean; onClose?: () => void }
): React.ReactNode {
    const fullscreen = options?.fullscreen ?? false;
    const onClose = options?.onClose;
    const onFocus = fullscreen ? undefined : () => props.setFocusedWidget(widgetId);

    switch (widgetId) {
        case 'chat':
            return <ChatWidget chatHistory={props.chatHistory} onFocus={onFocus} fullscreen={fullscreen} onClose={onClose} />;
        case 'chatInput':
            return <ChatInputWidget onSubmit={(text) => props.transcriptionCb(text)} onFocus={onFocus} fullscreen={fullscreen} onClose={onClose} />;
        case 'workspace':
            return <WorkspaceWidget workspace={props.workspace} onFocus={onFocus} fullscreen={fullscreen} onClose={onClose} />;
        case 'thoughts':
            return <ThoughtsWidget thoughtHistory={props.thoughtHistory} onFocus={onFocus} fullscreen={fullscreen} onClose={onClose} />;
        case 'log':
            return <LogWidget logHistory={props.logHistory} onFocus={onFocus} fullscreen={fullscreen} onClose={onClose} />;
        case 'code':
            return <CodeWidget codeParams={props.codeParams} onChange={props.handleCodeChange} onFocus={onFocus} fullscreen={fullscreen} onClose={onClose} />;
        case 'html':
            return <HTMLWidget htmlDisplay={props.htmlDisplay} onFocus={onFocus} fullscreen={fullscreen} onClose={onClose} />;
        case 'codeExecution':
            return (
                <CodeExecutionWidget
                    currentCode={props.currentExecution?.code || props.currentCode}
                    executionId={props.currentExecution?.executionId || props.executionId}
                    status={props.currentExecution?.status || props.executionStatus}
                    error={props.currentExecution?.error || props.executionError}
                    duration={props.currentExecution?.duration || props.executionDuration}
                    result={props.currentExecution?.result !== undefined ? props.currentExecution.result : props.executionResult}
                    onFocus={onFocus}
                    fullscreen={fullscreen}
                    onClose={onClose}
                />
            );
        case 'functionCalls':
            return <FunctionCallsWidget calls={props.currentExecution?.functionCalls || props.functionCalls} onFocus={onFocus} fullscreen={fullscreen} onClose={onClose} />;
        case 'variableInspector':
            return <VariableInspectorWidget variables={props.currentExecution?.variableAssignments || props.variableAssignments} onFocus={onFocus} fullscreen={fullscreen} onClose={onClose} />;
        case 'sandboxLogs':
            return <SandboxLogsWidget logs={props.currentExecution?.sandboxLogs || props.sandboxLogs} onFocus={onFocus} fullscreen={fullscreen} onClose={onClose} />;
        case 'history':
            return (
                <HistoryWidget
                    executions={props.executionHistory}
                    selectedIndex={props.selectedIndex}
                    isPinned={props.isPinned}
                    onSelectExecution={props.handleHistoryItemClick}
                    onTogglePin={() => props.setIsPinned(!props.isPinned)}
                    onFocus={onFocus}
                    fullscreen={fullscreen}
                    onClose={onClose}
                />
            );
        case 'knowledgeGraph':
            return (
                <KnowledgeGraphWidget
                    kgGraphData={props.kgGraphData}
                    kgMode={props.kgMode}
                    kgDepth={props.kgDepth}
                    kgVisibleRelationKinds={props.kgVisibleRelationKinds}
                    kgAvailableRelationKinds={props.kgAvailableRelationKinds}
                    kgIsSearching={props.kgIsSearching}
                    kgAutoDisplay={props.kgAutoDisplay}
                    setKgGraphData={props.setKgGraphData}
                    updateKgSettings={props.updateKgSettings}
                    setKgVisibleRelationKinds={props.setKgVisibleRelationKinds}
                    clearKgGraph={props.clearKgGraph}
                    searchKnowledgeGraph={props.searchKnowledgeGraph}
                    onFocus={onFocus}
                    fullscreen={fullscreen}
                    onClose={onClose}
                />
            );
        case 'streamViewer':
            return <StreamViewerWidget chunks={props.streamChunks} onFocus={onFocus} fullscreen={fullscreen} onClose={onClose} />;
        case 'speechQueue':
            return <SpeechQueueWidget entries={props.speechQueueState} onFocus={onFocus} fullscreen={fullscreen} onClose={onClose} />;
        case 'processes':
            return (
                <ProcessWidget
                    processes={props.processes}
                    processOutputs={props.processOutputs}
                    agentMonitorStates={props.agentMonitorStates}
                    onFocus={onFocus}
                    fullscreen={fullscreen}
                    onClose={onClose}
                    onSendProcessInput={props.onSendProcessInput}
                />
            );
        case 'visualization':
            return (
                <VisualizationWidget
                    activeVisualization={props.activeVisualization}
                    clearVisualization={props.clearVisualization}
                    activeHtml={props.activeHtml}
                    clearHtml={props.clearHtml}
                    codeParams={props.codeParams}
                    handleCodeChange={props.handleCodeChange}
                    vizContext={props.vizContext}
                    onFocus={onFocus}
                    fullscreen={fullscreen}
                    onClose={onClose}
                />
            );
        case 'llmInspector':
            return (
                <LLMInspectorWidget
                    onFocus={onFocus}
                    fullscreen={fullscreen}
                    onClose={onClose}
                />
            );
        default:
            return null;
    }
}

const fullscreenWidgetStyle: React.CSSProperties = { flexGrow: 1, width: '100%', minHeight: '100%', display: 'flex', flexDirection: 'column' };

/**
 * FullscreenWidget — renders the focused widget in fullscreen overlay.
 */
export const FullscreenWidget = React.memo(function FullscreenWidget({
    widgetId,
    widgetProps,
    onClose,
}: {
    widgetId: string;
    widgetProps: WidgetRenderProps;
    onClose: () => void;
}) {
    return (
        <div style={fullscreenWidgetStyle}>
            {renderWidget(widgetId, widgetProps, { fullscreen: true, onClose })}
        </div>
    );
});
