'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { logger, debug, sounds } from 'smartchats-common';
import { useSmartChatsStore } from '../store/useSmartChatsStore';
import { usePipelineTelemetry } from './usePipelineTelemetry';
import { useStreamBuffers } from './useStreamBuffers';
import { getCombinedStreamAudioStats } from '@/lib/llm_caller';

const log = logger.get_logger({ id: 'orchestrator' });

// ── Types ──

export interface OrchestratorParams {
    tivi: any;
    tiviSettings: any;
    agent: any;
    insightsClient: React.MutableRefObject<any>;
    fpsMonitor: React.MutableRefObject<any>;
    sessionStartTime: React.MutableRefObject<number>;
}

export interface OrchestratorActions {
    handleStartStop: () => Promise<void>;
    transcriptionCb: (text: string) => Promise<void>;
    setTranscribe: (v: boolean) => void;
    handleEvent: (evt: any) => void;
    /** Stamp first_tts_utterance — pass to useTivi's onQueueFirstUtterance */
    onQueueFirstUtterance: () => void;
    /** Stamp tts_queue_drain + emit voice_interaction_complete — pass to useTivi's onQueueDrain */
    onQueueDrain: (info: { cancelled: boolean }) => void;
    /** Raw stream text ref from useStreamBuffers */
    rawStreamRef: React.MutableRefObject<string>;
}

// ── Hook ──

export function useOrchestrator(params: OrchestratorParams): OrchestratorActions {
    const { tivi, tiviSettings, agent: COR, insightsClient, fpsMonitor, sessionStartTime } = params;

    // ── Internal state (written to store for UI reactivity) ──
    const [transcribe, _setTranscribe] = useState(true);
    const transcribeRef = useRef(transcribe);
    const startedRef = useRef(false);
    const audioCleanupRef = useRef<(() => void) | null>(null);
    const lastTranscriptionTimeRef = useRef<number>(0);
    const CORRef = useRef(COR);
    const tiviRef = useRef(tivi);

    // Keep refs fresh
    useEffect(() => { CORRef.current = COR; }, [COR]);
    useEffect(() => { tiviRef.current = tivi; }, [tivi]);
    useEffect(() => { transcribeRef.current = transcribe; }, [transcribe]);

    // ── Compose internal hooks ──
    const telemetry = usePipelineTelemetry();
    const buffers = useStreamBuffers();

    // ── Voice lifecycle state → store ──
    const setStarted = useCallback((v: boolean) => {
        startedRef.current = v;
        useSmartChatsStore.setState({ started: v });
    }, []);

    const setTranscribe = useCallback((v: boolean) => {
        _setTranscribe(v);
        transcribeRef.current = v;
        useSmartChatsStore.setState({ transcribe: v });
    }, []);

    const setInterimResult = useCallback((text: string) => {
        useSmartChatsStore.setState({ interimResult: text });
    }, []);

    // ── Voice status derivation ──
    // Subscribe to store values via Zustand selector (not getState() in deps, which re-evaluates every render)
    const storeLlmRunning = useSmartChatsStore((s) => s.llmRunning);
    const storeStarted = useSmartChatsStore((s) => s.started);
    useEffect(() => {
        let newStatus: 'idle' | 'listening' | 'processing' | 'speaking';
        if (tivi.isSpeaking) {
            newStatus = 'speaking';
        } else if (storeLlmRunning) {
            newStatus = 'processing';
        } else if (storeStarted) {
            newStatus = 'listening';
        } else {
            newStatus = 'idle';
        }
        // Only update if changed to avoid unnecessary re-renders
        if (useSmartChatsStore.getState().voiceStatus !== newStatus) {
            useSmartChatsStore.setState({ voiceStatus: newStatus });
        }
    }, [tivi.isSpeaking, storeLlmRunning, storeStarted]);

    // ── Tivi TTS callbacks (wired to telemetry) ──
    // These are set up via useTivi params in app3 — we just provide the stamp functions
    // The orchestrator stamps timestamps when tivi callbacks fire

    // ── Event Dispatch ──
    const handleEvent = useCallback((evt: any) => {
        if (evt.type !== 'stream_chunk' && evt.type !== 'thought_chunk' && evt.type !== 'response_chunk' && evt.type !== 'text_stream_done' && evt.type !== 'sandbox_event') {
            log(`Got event: ${JSON.stringify(evt)}`);
        }

        const store = useSmartChatsStore.getState();

        switch (evt.type) {
            // ── Store delegation events ──
            case 'thought': {
                // Clear thought chunk buffer before final thought replaces streaming entry
                buffers.finalizeThoughts();
                store.handleThought(evt);
                break;
            }
            case 'workspace_update': {
                log('Got workspace update event');
                store.updateWorkspace(evt.workspace);
                break;
            }
            case 'log':
                store.handleLog(evt);
                break;
            case 'code_update':
                store.handleCodeUpdate(evt);
                break;
            case 'html_update':
                store.handleHtmlUpdate(evt);
                break;
            case 'visualization_update':
                store.handleVisualizationUpdate(evt);
                break;
            case 'context_status':
                store.handleContextStatus(evt);
                break;
            case 'usage_update':
                store.handleUsageUpdate(evt);
                break;
            case 'knowledge_graph_update':
                store.handleKnowledgeGraphUpdate(evt);
                break;
            case 'metric_view_audit':
                insightsClient.current?.addEvent('metric_view_audit', {
                    spec: evt.spec,
                    query: evt.query,
                    row_count: evt.row_count,
                    raw_row_count: evt.raw_row_count,
                    resolved_at: evt.resolved_at,
                }, { tags: ['metrics', 'visualization'] });
                break;

            // ── Execution events ──
            case 'code_execution_start':
                store.handleCodeExecutionStart(evt);
                break;
            case 'code_execution_complete':
                store.handleCodeExecutionComplete(evt);
                // After LLM completes a code execution, flush any queued process idle notifications
                if (CORRef.current?.processManager) {
                    setTimeout(() => {
                        const queue = CORRef.current.processManager.flushIdleQueue();
                        if (queue.length > 0) {
                            log(`Flushed ${queue.length} idle process notifications on code_execution_complete`);
                        }
                    }, 0);
                }
                break;
            case 'sandbox_log':
                store.handleSandboxLog(evt);
                break;
            case 'sandbox_event':
                store.handleSandboxEvent(evt);
                break;

            // ── HTML interaction events ──
            case 'html_form_data': {
                log('Got HTML form data event');
                const { data } = evt;
                if (!data || typeof data !== 'object' || Array.isArray(data)) {
                    log('Invalid data type, skipping');
                    break;
                }
                const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
                const sanitizedData: Record<string, any> = {};
                for (const [key, value] of Object.entries(data)) {
                    if (dangerousKeys.includes(key)) { log(`Filtered dangerous key: ${key}`); continue; }
                    if (typeof value === 'function') { log(`Filtered function value for key: ${key}`); continue; }
                    sanitizedData[key] = value;
                }
                const cor = CORRef.current;
                if (cor?.workspace) {
                    Object.assign(cor.workspace, sanitizedData);
                    cor.emit('event', { type: 'workspace_update', workspace: cor.workspace });
                    log(`HTML form data stored: ${Object.keys(sanitizedData).length} keys`);
                }
                break;
            }
            case 'html_interaction_complete': {
                log('Got HTML interaction complete event');
                const message = evt.message || "I'm done interacting with the HTML form";
                useSmartChatsStore.getState().sendMessageSync(message);
                log(`Added user message: ${message}`);
                break;
            }

            // ── Process events ──
            case 'process_idle':
                if (CORRef.current?.processManager) {
                    CORRef.current.processManager.queueIdle(evt);
                }
                break;
            case 'process_state_change':
                break; // logged by store, no additional UI action
            case 'process_spawned':
                store.handleProcessSpawned(evt);
                break;
            case 'process_output':
                store.handleProcessOutput(evt);
                break;
            case 'process_agent_event':
                store.handleProcessAgentEvent(evt);
                break;
            case 'process_needs_input': {
                store.handleProcessNeedsInput(evt);
                const procs = useSmartChatsStore.getState().processes;
                const processName = procs.find((p: any) => p.id === evt.processId)?.name || evt.processId;
                useSmartChatsStore.getState().triggerParentRerun({
                    data: {
                        process_id: evt.processId,
                        process_name: processName,
                        data: evt.data,
                        message: `Process "${processName}" (${evt.processId}) is requesting input. ` +
                            `Review the request data and use send_process_input to respond, ` +
                            `or ask the user if you need their help.`,
                    },
                    type: 'process_input_request',
                });
                break;
            }
            case 'process_complete': {
                store.handleProcessComplete(evt);
                if (evt.completionMode === 'immediate') {
                    useSmartChatsStore.getState().triggerParentRerun();
                }
                break;
            }

            // ── External data injection ──
            case 'inject_user_data': {
                const { data, type, priority } = evt;
                CORRef.current?.add_user_data_input(data, type || 'external_result');
                if (priority === 'immediate') {
                    useSmartChatsStore.getState().triggerParentRerun();
                }
                break;
            }

            // ── Streaming events → TTS bridge + buffers ──
            case 'thought_chunk': {
                buffers.feedThoughtChunk(evt.chunk);
                break;
            }
            case 'response_chunk': {
                logger.simi_debug(`[orchestrator] response_chunk ${JSON.stringify(evt.chunk?.slice?.(0, 80) ?? evt.chunk)}`);
                telemetry.stampFirst('first_response_chunk');
                buffers.feedResponseChunk(evt.chunk);
                break;
            }
            case 'text_stream_done': {
                break;
            }
            case 'response_complete': {
                telemetry.stamp('response_complete');
                buffers.finalizeResponse(evt.response);
                useSmartChatsStore.setState({ lastSpeechTs: Date.now() });
                telemetry.stamp('llm_call_end');
                insightsClient.current?.flushBatch();
                break;
            }

            // ── Stream viewer events (debug) ──
            case 'stream_chunk':
                buffers.feedStreamChunk(evt.chunk);
                break;
            case 'stream_end': {
                buffers.finalizeStream();
                break;
            }

            // ── Lifecycle events (Phase 0) ──
            case 'turn_start':
                // Reset telemetry for new turn
                break;
            case 'response_ready':
                // Available for future use — response + thoughts parsed before code exec
                break;
            case 'turn_complete':
                // Flush process idle queue on turn complete
                if (CORRef.current?.processManager) {
                    const queue = CORRef.current.processManager.flushIdleQueue();
                    if (queue.length > 0) {
                        log(`Flushed ${queue.length} idle process notifications on turn_complete`);
                    }
                }
                // Auto-save session (fire-and-forget)
                useSmartChatsStore.getState().autoSaveSession();
                break;
            case 'process_idle_batch':
                // Batch idle notifications forwarded from ProcessManager
                break;

            // ── Display dismiss events (from dismiss_display function) ──
            case 'clear_visualizations': {
                useSmartChatsStore.getState().clearVisualization();
                if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('smartchats:dismiss'));
                break;
            }
            case 'clear_html': {
                useSmartChatsStore.getState().clearHtml();
                break;
            }
            case 'clear_code': {
                useSmartChatsStore.setState({ currentCode: undefined });
                break;
            }

            // ── App Platform Events ──
            case 'app_activated':
                store.handleAppActivated(evt);
                break;
            case 'app_deactivated':
                store.handleAppDeactivated(evt);
                break;
            case 'app_installed':
                store.handleAppInstalled(evt);
                break;
            case 'app_uninstalled':
                store.handleAppUninstalled(evt);
                break;
            case 'app_updated':
                store.handleAppUpdated(evt);
                break;

            default:
                log(`No handler for event type: ${evt.type}`);
                break;
        }
    }, [telemetry, buffers, insightsClient]);

    // ── Transcription Callback ──
    const transcriptionCb = useCallback(async (text: string) => {
        log(`tcb: ${text}`);
        const cor = CORRef.current;
        const state = useSmartChatsStore.getState();
        const { speechCooldownMs } = state;

        // App-driven input routing: if an app owns the input stream, deliver to it
        if (state.appOwnsInput) {
            const { getActiveSandbox, isAppInputRequested } = require('../modules/app_launcher');
            const sandbox = getActiveSandbox();
            if (sandbox && isAppInputRequested()) {
                log(`tcb: routing to active app`);
                sandbox.deliverUserInput(text);
                return;
            }
        }

        // Capture previous pipeline timestamps before resetting
        const prevLlmStartTs = telemetry.pipelineTs.current.llm_call_start;
        telemetry.resetTimestamps({ transcription_received: Date.now() });

        // Check speech cooldown
        const now = Date.now();
        const timeSinceLast = now - lastTranscriptionTimeRef.current;
        if (timeSinceLast < speechCooldownMs) {
            log(`tcb: Ignoring - within cooldown (${timeSinceLast}ms < ${speechCooldownMs}ms)`);
            return;
        }
        lastTranscriptionTimeRef.current = now;

        const isCancelIntent = /^cancel\.?$/i.test(text.trim());

        // Cancel in-flight LLM run
        const storeLlmRunning = useSmartChatsStore.getState().llmRunning;
        if (storeLlmRunning && cor && !cor.is_running_function) {
            const cancelTs = Date.now();
            tiviRef.current.cancelSpeech();
            cor.cancel();

            const cancelFlow = isCancelIntent ? 'explicit_cancel' : 'supersede_with_new_input';
            const systemMsg = isCancelIntent
                ? 'User cancelled the request.'
                : 'User cancelled the previous request to add additional information.';

            log(`tcb: ${cancelFlow} — aborting LLM run`);
            cor.add_user_data_input({
                name: 'system_notification',
                result: systemMsg,
            }, 'system_notification');

            if (!isCancelIntent) {
                useSmartChatsStore.getState().sendMessageSync(text);
            }

            insightsClient.current?.addEvent('llm_cancel', {
                flow: cancelFlow,
                transcript: text,
                was_running_function: cor.is_running_function,
                cancel_ts: cancelTs,
                llm_start_ts: prevLlmStartTs || null,
                time_to_cancel_ms: prevLlmStartTs ? cancelTs - prevLlmStartTs : null,
            }, { tags: ['cancel'] });

            insightsClient.current?.flushBatch();
            return;
        }

        if (startedRef.current && useSmartChatsStore.getState().soundFeedback) {
            sounds.proceed();
        }

        if (cor && cor.is_running_function) {
            log('tcb: Cortex running function, will forward');
            telemetry.stamp('llm_call_start');
            await cor.handle_function_input(text);
        } else {
            log('tcb: No active cortex function');
            telemetry.stamp('llm_call_start');
            useSmartChatsStore.getState().sendMessageSync(text);
            insightsClient.current?.flushBatch();
        }
    }, [telemetry, insightsClient]);

    // ── add_ai_message — output handler for agent function responses (e.g. accumulate_text) ──
    const addAiMessage = useCallback(async (content: string) => {
        telemetry.stamp('llm_call_end');
        const store = useSmartChatsStore.getState();
        store.addAiMessage(content);

        // TTS for function-generated output (accumulate_text, respond_to_user, etc.)
        if (startedRef.current && content) {
            tiviRef.current.pauseSpeechRecognition();
            await tiviRef.current.speak(content);
        }

        if (startedRef.current && store.soundFeedback) {
            sounds.proceed();
        }

        // Emit voice_interaction_complete trace
        const cor = CORRef.current;
        telemetry.emitVoiceComplete({
            insightsClient: insightsClient.current,
            runnerMode: cor?.runner?.id || 'unknown',
            responseLength: content.length,
            mode: startedRef.current ? 'voice' : 'text',
        });
        insightsClient.current?.flushBatch();

        // FPS measurement (non-blocking)
        if (insightsClient.current && fpsMonitor.current) {
            fpsMonitor.current.measure(1000)
                .then((snapshot: any) => {
                    const stats = fpsMonitor.current.get_current_stats();
                    const diagnostics = fpsMonitor.current.get_diagnostics();
                    return insightsClient.current.addEvent('performance_metrics', {
                        fps_current: stats.fps_current,
                        fps_avg_1min: stats.fps_avg_1min,
                        fps_min_1min: stats.fps_min_1min,
                        fps_max_1min: stats.fps_max_1min,
                        trigger: 'post_ai_response',
                        mode: startedRef.current ? 'voice' : 'text',
                        response_length: content.length,
                        session_uptime_ms: Date.now() - sessionStartTime.current,
                        memory_mb: diagnostics?.memory_mb ?? null,
                        memory_limit_mb: diagnostics?.memory_limit_mb ?? null,
                        dom_nodes: diagnostics?.dom_nodes ?? 0,
                        visible_nodes: diagnostics?.visible_nodes ?? 0,
                        audio_diagnostics: tiviRef.current?.ttsQueue?.getDiagnostics?.() ?? null,
                        combined_stream_stats: getCombinedStreamAudioStats(),
                    }, {
                        tags: ['performance', 'fps', 'ai_response'],
                        duration_ms: 1000,
                    });
                })
                .catch((err: any) => { log(`FPS measurement failed: ${err}`); });
        }
    }, [telemetry, insightsClient, fpsMonitor, sessionStartTime]);

    // ── Wire COR output + events ──
    useEffect(() => {
        if (COR) {
            COR.configure_user_output(addAiMessage);
            useSmartChatsStore.getState().setAgent(COR);

            // Sync existing chat history into agent context (handles session load, model change, reload)
            const { chatHistory } = useSmartChatsStore.getState();
            if (chatHistory.length > 0) {
                COR.messages = chatHistory.map((m: any) => ({ role: m.role, content: m.content }));
            }

            COR.on('event', handleEvent);
            return () => { COR.off('event', handleEvent); };
        }
    }, [COR, handleEvent, addAiMessage]);

    // ── Voice lifecycle ──
    const handleStartStop = useCallback(async () => {
        const state = useSmartChatsStore.getState();
        if (!startedRef.current) {
            if (!state.isAuthenticated) {
                if (typeof window !== 'undefined' && (window as any).openLoginModal) {
                    (window as any).openLoginModal();
                }
                return;
            }
            log('Starting audio');
            sounds.ensureResumed();
            setStarted(true);
            insightsClient.current?.addEvent('voice_session_start', {
                timestamp: Date.now(),
            });

            // Trigger first LLM turn — runLlm guard handles init data injection
            useSmartChatsStore.getState().runLlm();

            audioCleanupRef.current = await onInitAudio(transcribeRef, transcriptionCb, tivi);
        } else {
            log('Stopping audio');
            setStarted(false);
            insightsClient.current?.addEvent('voice_session_stop', {
                timestamp: Date.now(),
            });
            tivi.stopListening();
            if (audioCleanupRef.current) {
                audioCleanupRef.current();
                audioCleanupRef.current = null;
            }
        }
    }, [tivi, transcriptionCb, setStarted]);

    // ── Interim result listener ──
    useEffect(() => {
        const handleInterim = (e: any) => {
            setInterimResult(e.detail);
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('tidyscripts_web_speech_recognition_interim', handleInterim);
        }
        return () => {
            if (typeof window !== 'undefined') {
                window.removeEventListener('tidyscripts_web_speech_recognition_interim', handleInterim);
            }
        };
    }, [setInterimResult]);

    // ── postMessage listener for HTML widget ──
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== (window as any).location.origin && event.origin !== 'null') {
                log(`Rejected postMessage from unauthorized origin: ${event.origin}`);
                return;
            }
            if (event.data?.type === 'html_widget_data') {
                handleEvent({ type: 'html_form_data', data: event.data.payload, timestamp: event.data.timestamp });
            } else if (event.data?.type === 'html_interaction_complete') {
                handleEvent({ type: 'html_interaction_complete', message: event.data.message, timestamp: event.data.timestamp });
            }
        };
        window.addEventListener('message', handleMessage);
        return () => { window.removeEventListener('message', handleMessage); };
    }, [handleEvent]);

    // ── Tivi TTS telemetry callbacks ──
    const onQueueFirstUtterance = useCallback(() => {
        telemetry.stampFirst('first_tts_utterance');
    }, [telemetry]);

    const onQueueDrain = useCallback(({ cancelled }: { cancelled: boolean }) => {
        if (cancelled) return;
        telemetry.stamp('tts_queue_drain');
        useSmartChatsStore.setState({ lastSpeechTs: Date.now() });
        const cor = CORRef.current;
        const store = useSmartChatsStore.getState();
        telemetry.emitVoiceComplete({
            insightsClient: insightsClient.current,
            runnerMode: cor?.runner?.id || 'unknown',
            responseLength: store.lastAiMessage?.length || 0,
            mode: store.started ? 'voice' : 'chat',
            ttsPipeline: 'combined',
        });
        insightsClient.current?.flushBatch();
    }, [telemetry, insightsClient]);

    return useMemo(() => ({
        handleStartStop,
        transcriptionCb,
        setTranscribe,
        handleEvent,
        onQueueFirstUtterance,
        onQueueDrain,
        rawStreamRef: buffers.rawStreamRef,
    }), [handleStartStop, transcriptionCb, setTranscribe, handleEvent, onQueueFirstUtterance, onQueueDrain, buffers.rawStreamRef]);
}

// ── Helper: Initialize audio ──

async function onInitAudio(transcribeRef: any, transcriptionCb: any, tivi: any): Promise<() => void> {
    const handleTranscript = async (e: any) => {
        const transcript = e.detail;
        log(`Transcribe Ref: ${transcribeRef.current}`);
        if (transcribeRef.current) {
            log('Transcribing audio');
            debug.add('transcript', transcript);
            log(`Sound event transcription: ${transcript}`);
            await transcriptionCb(transcript);
        } else {
            log('NOT Transcribing audio');
        }
    };

    (window as any).addEventListener('tidyscripts_web_speech_recognition_result', handleTranscript);
    await tivi.startListening();

    return () => {
        (window as any).removeEventListener('tidyscripts_web_speech_recognition_result', handleTranscript);
    };
}
