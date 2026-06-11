'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { logger, debug, sounds } from 'smartchats-common';
import { useSmartChatsStore } from '../store/useSmartChatsStore';
import { usePipelineTelemetry } from './usePipelineTelemetry';
import { useStreamBuffers } from './useStreamBuffers';
import { getCombinedStreamAudioStats } from '@/lib/llm_caller';
import { getStartupLoaders } from '../lib/background_loaders';
import { getGreeting } from '../lib/greeting';

/** Read the user's name from the (possibly-undefined) prefetched KG.
 *  Looks for `current_user → name_is → X`. Returns undefined if KG is
 *  missing, empty, or contains no such relation. */
function extractNameFromKG(kg: any): string | undefined {
    if (!kg?.relations || !Array.isArray(kg.relations)) return undefined;
    const rel = kg.relations.find((r: any) => r?.source === 'current_user' && r?.relation === 'name_is');
    const target = rel?.target;
    return typeof target === 'string' && target.trim().length > 0 ? target.trim() : undefined;
}
import {
    isColdStart,
    getTimeSinceBootComplete,
    markVoiceSessionStart,
    clearVoiceSessionStart,
} from '../lib/boot_snapshot';

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
    /** Emit tts_playback_timing insights event — pass to useTivi's onTtsPlaybackTiming */
    onTtsPlaybackTiming: (event: any) => void;
    /** Emit speech_recognition_error insights event — pass to useTivi's onSpeechRecognitionError */
    onSpeechRecognitionError: (info: { code: string; message: string }) => void;
    /** Emit tts_server_timing insights event — register via setTtsServerTimingCallback in llm_caller */
    onTtsServerTiming: (event: any) => void;
    /** Emit llm_server_timing insights event — register via setLlmServerTimingCallback in llm_caller */
    onLlmServerTiming: (event: any) => void;
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

    // ── Start-flow telemetry refs ──
    // Capture click T0 + a fresh chain id for each session so every event
    // from voice_session_start → voice_session_first_turn_complete shares
    // one trace_id. Single-shot flags ensure first-audio + first-chunk +
    // first-turn-complete each fire at most once per session.
    const voiceSessionT0Ref = useRef<number | null>(null);
    const voiceSessionColdRef = useRef<boolean>(false);
    const voiceSessionFirstAudioEmittedRef = useRef<boolean>(false);
    const voiceSessionFirstChunkEmittedRef = useRef<boolean>(false);
    const voiceSessionFirstTurnCompleteEmittedRef = useRef<boolean>(false);

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
                // One-shot: stamp the first LLM-text chunk against
                // voice_session_start T0 so dashboards see click→first-token.
                if (
                    voiceSessionT0Ref.current !== null &&
                    !voiceSessionFirstChunkEmittedRef.current
                ) {
                    voiceSessionFirstChunkEmittedRef.current = true;
                    const dur = Math.round(performance.now() - voiceSessionT0Ref.current);
                    insightsClient.current?.addEvent?.('voice_first_llm_call_first_chunk', {
                        app: 'smartchats',
                        cold_start: voiceSessionColdRef.current,
                        duration_ms: dur,
                    }, { duration_ms: dur, tags: ['latency', 'ttfa'] });
                }
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

            // Capture click T0 + cold-start signal before any awaited work,
            // so every Start-flow event measures from the actual click.
            // Mirror into boot_snapshot so emitters outside the hook (the
            // store's runLlm) can read T0 + cold without prop-drilling.
            const clickT0 = performance.now();
            const cold = isColdStart();
            voiceSessionT0Ref.current = clickT0;
            voiceSessionColdRef.current = cold;
            markVoiceSessionStart(cold);
            voiceSessionFirstAudioEmittedRef.current = false;
            voiceSessionFirstChunkEmittedRef.current = false;
            voiceSessionFirstTurnCompleteEmittedRef.current = false;

            // Open a fresh chain for the Start flow so every downstream
            // event (audio_ready, first_audio, first_turn_complete) inherits
            // one trace_id. Closed in onQueueDrain.
            const timeSinceBootCompleteMs = getTimeSinceBootComplete();
            insightsClient.current?.startChain?.('voice_session_start', {
                app: 'smartchats',
                cold_start: voiceSessionColdRef.current,
                time_since_boot_complete_ms: timeSinceBootCompleteMs,
                timestamp: Date.now(),
            });

            // Templated greeting bypass — replaces the LLM-generated opening
            // line with a string-interpolated template + direct TTS. The
            // first runLlm call now fires when the user speaks (via
            // sendMessageSync), NOT on Start click. Click → first audio
            // drops from ~5 s (LLM round-trip) to ~500-800 ms (TTS only).
            //
            // The name comes from the prefetched user KG via the loader's
            // synchronous peek(). If the KG hasn't resolved yet, we fall
            // through cleanly to the no-name template variant — never to
            // the old LLM-on-Start path.
            //
            // The greeting is also pushed into agent.messages as an
            // 'assistant' turn so the LLM sees "I already greeted" on the
            // first real run_llm call (when the user speaks) and doesn't
            // re-greet.
            const greetingStore = useSmartChatsStore.getState();
            const greetingAgent = greetingStore.agent;
            const kg = getStartupLoaders()?.user_kg_shallow.peek();
            const name = extractNameFromKG(kg);
            const greeting = getGreeting({ name });
            try {
                tivi.ttsQueue?.speakText?.(greeting.text);
            } catch (err) {
                log(`Greeting TTS failed: ${err}`);
            }
            if (greetingAgent?.messages) {
                greetingAgent.messages.push({ role: 'assistant', content: greeting.text });
            }
            greetingStore.addAiMessage(greeting.text);
            const greetingDur = Math.round(performance.now() - clickT0);
            insightsClient.current?.addEvent?.('voice_session_templated_greeting', {
                app: 'smartchats',
                template_id: greeting.template_id,
                time_bucket: greeting.time_bucket,
                has_name: greeting.has_name,
                duration_ms: greetingDur,
                cold_start: voiceSessionColdRef.current,
            }, { duration_ms: greetingDur, tags: ['latency', 'ttfa', 'templated'] });

            const audioInitStart = performance.now();
            audioCleanupRef.current = await onInitAudio(transcribeRef, transcriptionCb, tivi);
            const audioInitDuration = Math.round(performance.now() - audioInitStart);
            const clickToReady = Math.round(performance.now() - clickT0);
            insightsClient.current?.addEvent?.('voice_session_audio_ready', {
                app: 'smartchats',
                cold_start: voiceSessionColdRef.current,
                duration_ms: clickToReady,
                audio_init_ms: audioInitDuration,
            }, { duration_ms: clickToReady, tags: ['latency', 'ttfa'] });
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
            // Close the chain if it's still open (e.g. user stopped before
            // first turn completed). endChain is a no-op if the stack is
            // empty, so calling it unconditionally is safe.
            if (!voiceSessionFirstTurnCompleteEmittedRef.current) {
                insightsClient.current?.endChain?.();
            }
            clearVoiceSessionStart();
        }
    }, [tivi, transcriptionCb, setStarted]);

    // ── Interim result listener ──
    useEffect(() => {
        const handleInterim = (e: any) => {
            setInterimResult(e.detail);
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('tivi_speech_recognition_interim', handleInterim);
        }
        return () => {
            if (typeof window !== 'undefined') {
                window.removeEventListener('tivi_speech_recognition_interim', handleInterim);
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
        // One-shot: this is THE moment the user hears the agent for the first
        // time this session. Pair it with voice_session_start T0 so we have a
        // single time_to_first_audio_ms per session.
        if (
            voiceSessionT0Ref.current !== null &&
            !voiceSessionFirstAudioEmittedRef.current
        ) {
            voiceSessionFirstAudioEmittedRef.current = true;
            const dur = Math.round(performance.now() - voiceSessionT0Ref.current);
            insightsClient.current?.addEvent?.('voice_session_first_audio', {
                app: 'smartchats',
                cold_start: voiceSessionColdRef.current,
                duration_ms: dur,
            }, { duration_ms: dur, tags: ['latency', 'ttfa'] });
        }
    }, [telemetry, insightsClient]);

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
        // One-shot: end the Start-flow chain on the first complete drain
        // since voice_session_start. Lets dashboards filter "first turn"
        // (cold/warm distribution) vs all subsequent turns.
        if (
            voiceSessionT0Ref.current !== null &&
            !voiceSessionFirstTurnCompleteEmittedRef.current
        ) {
            voiceSessionFirstTurnCompleteEmittedRef.current = true;
            const dur = Math.round(performance.now() - voiceSessionT0Ref.current);
            insightsClient.current?.addEvent?.('voice_session_first_turn_complete', {
                app: 'smartchats',
                cold_start: voiceSessionColdRef.current,
                time_to_first_turn_complete_ms: dur,
            }, { duration_ms: dur, tags: ['latency', 'ttfa'] });
            insightsClient.current?.endChain?.();
            clearVoiceSessionStart();
        }
        insightsClient.current?.flushBatch();
    }, [telemetry, insightsClient]);

    // Emit tts_playback_timing insights event for chunk-level scheduling
    // diagnostics. Tagged 'latency' + 'tts' so triage can filter cleanly.
    // Phase A of the audio jitter investigation — see STATUS.txt P1.
    const onTtsPlaybackTiming = useCallback((event: any) => {
        insightsClient.current?.addEvent?.('tts_playback_timing', event, {
            tags: ['latency', 'tts'],
        }).catch(() => {});
    }, [insightsClient]);

    // Emit speech_recognition_error insights event for SR failures. Closes
    // the gap where browser SpeechRecognition errors (typically 'network')
    // were only visible in the dev console and never reached triage. Fires
    // per error, not throttled — frequency is signal.
    const onSpeechRecognitionError = useCallback((info: { code: string; message: string }) => {
        insightsClient.current?.addEvent?.('speech_recognition_error', {
            error_code: info.code,
            error_message: info.message,
        }, {
            tags: ['error', 'voice', 'speech_recognition'],
        }).catch(() => {});
    }, [insightsClient]);

    // Emit tts_server_timing insights event. Only fires when /sail
    // experiment mode is active (server gates emission on experiment_id).
    // Each event carries a 'phase' field (tts_request_start | tts_first_byte
    // | tts_batch_yield | tts_request_complete) so post-hoc analysis can
    // reconstruct the full server-side encoder timeline per sentence.
    const onTtsServerTiming = useCallback((event: any) => {
        insightsClient.current?.addEvent?.('tts_server_timing', event, {
            tags: ['latency', 'tts', 'experiment'],
        }).catch(() => {});
    }, [insightsClient]);

    // Emit llm_server_timing insights event. Always-on (3 stamps per call).
    // Phases: llm_function_received | llm_request_start | llm_first_byte.
    // Used to attribute the TTFA gap between voice_first_llm_call_start
    // (client-side, before the network round-trip) and
    // voice_first_llm_call_first_chunk (client-side, when the first token
    // arrives) to function-side vs provider-side latency.
    const onLlmServerTiming = useCallback((event: any) => {
        insightsClient.current?.addEvent?.('llm_server_timing', event, {
            tags: ['latency', 'llm', 'ttfa'],
        }).catch(() => {});
    }, [insightsClient]);

    return useMemo(() => ({
        handleStartStop,
        transcriptionCb,
        setTranscribe,
        handleEvent,
        onQueueFirstUtterance,
        onQueueDrain,
        onTtsPlaybackTiming,
        onSpeechRecognitionError,
        onTtsServerTiming,
        onLlmServerTiming,
        rawStreamRef: buffers.rawStreamRef,
    }), [handleStartStop, transcriptionCb, setTranscribe, handleEvent, onQueueFirstUtterance, onQueueDrain, onTtsPlaybackTiming, onSpeechRecognitionError, onTtsServerTiming, onLlmServerTiming, buffers.rawStreamRef]);
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

    (window as any).addEventListener('tivi_speech_recognition_result', handleTranscript);
    await tivi.startListening();

    return () => {
        (window as any).removeEventListener('tivi_speech_recognition_result', handleTranscript);
    };
}
