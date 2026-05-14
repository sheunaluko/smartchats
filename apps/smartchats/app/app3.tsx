'use client';

/**
 * app3.tsx — SmartChats shell host.
 *
 * This is the composition root. It owns:
 *   - All initialization (auth, insights, agent, tivi, orchestrator)
 *   - All store selectors and state management
 *   - Settings persistence
 *
 * It does NOT own rendering layout — that's delegated to the active shell.
 * The shell receives typed ShellProps and decides how to organize the UI.
 *
 * Architecture (composition patterns: state-decouple-implementation):
 *   Host computes { state, actions, meta } → Shell renders
 */

// IMPORTANT: Import observer tracker FIRST before React
import { observerTracker } from "./utils/observerTracker";

import type { NextPage } from 'next'
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import React from 'react';
import styles from '../styles/Default.module.css'
import "./app.css"
import { logger, debug, sounds, insights } from 'smartchats-common';
import * as fps_monitor from "./src/fps_monitor";
import * as cortex_agent from "./cortex_agent_web"
import { prefetchStartup } from "./modules/initialization"

import { useDesignPack } from '../core/DesignPackContext';
import { useVizMotif } from '../core/VizMotifContext';
import { listDesignPacks } from '../core/theme-packs';

import { useTivi } from "@lab-components/tivi/lib/index"
import { backendTtsCallFn, backendTtsStreamFn, warmupBackendTts } from '@/lib/tts_caller';
import { setTtsQueueRef } from '@/lib/llm_caller';
import { getBackend } from '@/lib/backend';
import { useTiviSettings } from '@lab-components/tivi/lib/useTiviSettings';
import { getTiviSettings } from '@lab-components/tivi/lib/settings';
import * as classifier from '@/classifier';

import { useAuth } from '@/lib/auth';
import { useInsights } from '@/context/InsightsContext';
import { useSmartChatsStore } from './store/useSmartChatsStore';
import { useBillingStore } from '@/stores/billing_store';
import { toast_toast } from '@/components/Toast';

import * as sandbox from "./src/sandbox"
import type { QueueEntryStatus } from '@lab-components/tivi/lib/tts_queue';

// Import custom hooks
import { useWidgetConfig } from "./hooks/useWidgetConfig"
import { useCortexAgent } from "./hooks/useCortexAgent"
import { useOrchestrator } from "./hooks/useOrchestrator"
import { useChatMode } from "./hooks/useChatMode"

// Import shells
import { DesktopDefaultShell } from "./shells/DesktopDefaultShell"
import { DesktopFocusShell } from "./shells/DesktopFocusShell"
import { MobileShell } from "./shells/MobileShell"
import { MobileVoiceShell } from "./shells/MobileVoiceShell"
import { MobileVoiceQuietShell } from "./shells/MobileVoiceQuietShell"
import { MobileVoiceStreamShell } from "./shells/MobileVoiceStreamShell"
import { MobileVoiceRibbonShell } from "./shells/MobileVoiceRibbonShell"
import { MobileVoiceConversationalShell } from "./shells/MobileVoiceConversationalShell"
import { MobileVoiceCinematicShell } from "./shells/MobileVoiceCinematicShell"
import { ClaudeMobileShellV1 } from "./shells/ClaudeMobileShellV1"
import { ClaudeMobileShellV2 } from "./shells/ClaudeMobileShellV2"
import { ClaudeMobileShellV3 } from "./shells/ClaudeMobileShellV3"
import { ClaudeMobileShellV4 } from "./shells/ClaudeMobileShellV4"
import { ClaudeCodexShell } from "./shells/ClaudeCodexShell"
import type { ShellProps } from "../core/types/shell"
import type { WidgetRenderProps } from "./components/FullscreenWidget"

const SHELLS = {
  'desktop-default': DesktopDefaultShell,
  'desktop-focus': DesktopFocusShell,
  'mobile': MobileShell,
  'mobile-voice': MobileVoiceShell,
  'mobile-voice-quiet': MobileVoiceQuietShell,
  'mobile-voice-stream': MobileVoiceStreamShell,
  'mobile-voice-ribbon': MobileVoiceRibbonShell,
  'mobile-voice-conversational': MobileVoiceConversationalShell,
  'mobile-voice-cinematic': MobileVoiceCinematicShell,
  'claude-mobile-v1': ClaudeMobileShellV1,
  'claude-mobile-v2': ClaudeMobileShellV2,
  'claude-mobile-v3': ClaudeMobileShellV3,
  'claude-mobile-v4': ClaudeMobileShellV4,
  'claude-codex': ClaudeCodexShell,
} as const;

type ShellId = keyof typeof SHELLS;

const SHELL_OPTIONS: Array<{ id: ShellId; name: string }> = [
  { id: 'desktop-default', name: 'Desktop Default' },
  // { id: 'desktop-focus', name: 'Desktop Focus' },  // detached — not ready for production
  { id: 'mobile', name: 'Mobile' },
  { id: 'mobile-voice', name: 'Mobile Voice' },
  { id: 'claude-mobile-v1', name: 'Claude Mobile V1' },
  { id: 'claude-mobile-v2', name: 'Claude Mobile V2 (Edge Rail)' },
  { id: 'claude-mobile-v3', name: 'Claude Mobile V3 (Bottom Tray)' },
  { id: 'claude-mobile-v4', name: 'Claude Mobile V4 (Orbital)' },
  { id: 'claude-codex', name: 'ClaudeCodexShell' },
  { id: 'mobile-voice-quiet', name: 'Mobile Voice Quiet' },
  { id: 'mobile-voice-stream', name: 'Mobile Voice Stream' },
  { id: 'mobile-voice-ribbon', name: 'Mobile Voice Ribbon' },
  { id: 'mobile-voice-conversational', name: 'Mobile Voice Conversational' },
  { id: 'mobile-voice-cinematic', name: 'Mobile Voice Cinematic' },
];

declare var window: any;

const log = logger.get_logger({ id: "cortex" });

// Suppress noisy loggers
for (var x of ["html", "toast", "cortex:ChatInputWidget", "cortex:WidgetGrid"]) {
    logger.suppress(x, "clean up");
}


/* ═══════════════════════════════════════════════════════════════
   S H E L L   H O S T
   Computes all state, delegates rendering to the active shell.
   ═══════════════════════════════════════════════════════════════ */
const Component: NextPage = (props: any) => {
    const { pairedPack, mode: colorMode, setDesignPack, toggleMode, setMode } = useDesignPack();
    const { motifId, setMotif: setVizMotif } = useVizMotif();

    // ── Auth + billing ──
    const { user: authUser } = useAuth();
    const backendCaps = useMemo(() => getBackend().capabilities, []);
    const totalAvailable = useBillingStore(s => s.totalAvailable);
    const billingLoading = useBillingStore(s => s.isLoading);

    useEffect(() => {
        if (authUser && backendCaps.billing) {
            useBillingStore.getState().fetchBalance();
        }
        useSmartChatsStore.getState().checkAuth();
    }, [authUser, backendCaps.billing]);

    // ── UI-only state ──
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [sessionsOpen, setSessionsOpen] = useState(false);
    const [speechQueueState, setSpeechQueueState] = useState<QueueEntryStatus[]>([]);
    const [activeShell, setActiveShell] = useState<ShellId>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('smartchats-shell');
            if (saved && saved in SHELLS) return saved as ShellId;
        }
        return 'desktop-default';
    });

    // ── Tivi settings ──
    const { settings: tiviSettings, updateSettings: updateTiviSettings } = useTiviSettings();

    // ── InsightsClient ──
    const { client: insightsClientFromContext, isReady: insightsReady } = useInsights();
    const insightsClient = useRef<any>(null);

    useEffect(() => {
        if (insightsClientFromContext) {
            insightsClient.current = insightsClientFromContext;
        }
    }, [insightsClientFromContext]);

    useEffect(() => {
        if (insightsClientFromContext) {
            useSmartChatsStore.setInsights(insightsClientFromContext);
            useBillingStore.setInsights(insightsClientFromContext);
            classifier.setInsights(insightsClientFromContext);
        }
    }, [insightsClientFromContext]);

    // ── Store selectors ──
    const isAuthenticated = useSmartChatsStore(s => s.isAuthenticated);
    const ai_model = useSmartChatsStore(s => s.aiModel);
    const speechCooldownMs = useSmartChatsStore(s => s.speechCooldownMs);
    const sound_feedback_from_store = useSmartChatsStore(s => s.soundFeedback);

    const focusedWidget = useSmartChatsStore(s => s.focusedWidget);

    const started = useSmartChatsStore(s => s.started);
    const transcribe = useSmartChatsStore(s => s.transcribe);
    const interimResult = useSmartChatsStore(s => s.interimResult);
    const voiceStatus = useSmartChatsStore(s => s.voiceStatus);

    const chat_history = useSmartChatsStore(s => s.chatHistory);
    const workspace = useSmartChatsStore(s => s.workspace);
    const thought_history = useSmartChatsStore(s => s.thoughtHistory);
    const log_history = useSmartChatsStore(s => s.logHistory);
    const html_display = useSmartChatsStore(s => s.htmlDisplay);
    const activeVisualization = useSmartChatsStore(s => s.activeVisualization);
    const clearVisualization = useSmartChatsStore(s => s.clearVisualization);
    const activeHtml = useSmartChatsStore(s => s.activeHtml);
    const clearHtml = useSmartChatsStore(s => s.clearHtml);
    const code_params = useSmartChatsStore(s => s.codeParams);
    const contextUsage = useSmartChatsStore(s => s.contextUsage);

    const currentCode = useSmartChatsStore(s => s.currentCode);
    const executionId = useSmartChatsStore(s => s.executionId);
    const executionStatus = useSmartChatsStore(s => s.executionStatus);
    const executionError = useSmartChatsStore(s => s.executionError);
    const executionDuration = useSmartChatsStore(s => s.executionDuration);
    const executionResult = useSmartChatsStore(s => s.executionResult);
    const functionCalls = useSmartChatsStore(s => s.functionCalls);
    const variableAssignments = useSmartChatsStore(s => s.variableAssignments);
    const sandboxLogs = useSmartChatsStore(s => s.sandboxLogs);
    const executionHistory = useSmartChatsStore(s => s.executionHistory);
    const selectedIndex = useSmartChatsStore(s => s.selectedIndex);
    const isPinned = useSmartChatsStore(s => s.isPinned);

    const kgGraphData = useSmartChatsStore(s => s.kgGraphData);
    const kgAutoDisplay = useSmartChatsStore(s => s.kgAutoDisplay);
    const kgMode = useSmartChatsStore(s => s.kgMode);
    const kgDepth = useSmartChatsStore(s => s.kgDepth);
    const kgVisibleRelationKinds = useSmartChatsStore(s => s.kgVisibleRelationKinds);
    const kgAvailableRelationKinds = useSmartChatsStore(s => s.kgAvailableRelationKinds);
    const kgIsSearching = useSmartChatsStore(s => s.kgIsSearching);

    const streamChunks = useSmartChatsStore(s => s.streamChunks);
    const processes = useSmartChatsStore(s => s.processes);
    const processOutputs = useSmartChatsStore(s => s.processOutputs);
    const agentMonitorStates = useSmartChatsStore(s => s.agentMonitorStates);

    const store_updateSettings = useSmartChatsStore(s => s.updateSettings);
    const handleCodeUpdate = useSmartChatsStore(s => s.handleCodeUpdate);
    const store_handleHistoryItemClick = useSmartChatsStore(s => s.handleHistoryItemClick);
    const store_setIsPinned = useSmartChatsStore(s => s.setIsPinned);
    const loadSettings = useSmartChatsStore(s => s.loadSettings);
    const saveSettings = useSmartChatsStore(s => s.saveSettings);
    const saveSession = useSmartChatsStore(s => s.saveSession);
    const loadSession = useSmartChatsStore(s => s.loadSession);
    const listSessions = useSmartChatsStore(s => s.listSessions);
    const setKgGraphData = useSmartChatsStore(s => s.setKgGraphData);
    const updateKgSettings = useSmartChatsStore(s => s.updateKgSettings);
    const setKgVisibleRelationKinds = useSmartChatsStore(s => s.setKgVisibleRelationKinds);
    const clearKgGraph = useSmartChatsStore(s => s.clearKgGraph);
    const searchKnowledgeGraph = useSmartChatsStore(s => s.searchKnowledgeGraph);
    const setFocusedWidget = useSmartChatsStore(s => s.setFocusedWidget);

    const lastSavedSettings = useRef<{ aiModel: string; speechCooldownMs: number; soundFeedback: boolean } | null>(null);

    // ── Init flow ──
    useEffect(() => {
        if (insightsReady) {
            loadSettings().then(() => {
                const { aiModel, speechCooldownMs, soundFeedback } = useSmartChatsStore.getState();
                lastSavedSettings.current = { aiModel, speechCooldownMs, soundFeedback };
            });
        }
    }, [insightsReady]);

    // ── FPS Monitor ──
    const fpsMonitor = useRef<any>(null);
    const sessionStartTime = useRef<number>(Date.now());

    useEffect(() => {
        if (insightsReady && typeof window !== 'undefined') {
            fpsMonitor.current = new fps_monitor.FPSMonitor({
                measurement_duration_ms: 1000,
                rolling_window_size: 60,
                include_diagnostics: true
            });
        }
    }, [insightsReady]);

    // ── Cortex agent ──
    const { agent: COR, isLoading: agentLoading, error: agentError } = useCortexAgent(
        ai_model,
        insightsReady ? insightsClient.current : undefined,
        { isAuthenticated },
        true
    );

    // ── Tivi TTS telemetry refs ──
    const onQueueFirstUtteranceRef = useRef<() => void>(() => {});
    const onQueueDrainRef = useRef<(info: { cancelled: boolean }) => void>(() => {});

    // ── Tivi ──
    const tivi = useTivi({
        verbose: tiviSettings.verbose,
        positiveSpeechThreshold: tiviSettings.positiveSpeechThreshold,
        negativeSpeechThreshold: tiviSettings.negativeSpeechThreshold,
        minSpeechStartMs: tiviSettings.minSpeechStartMs,
        language: tiviSettings.language,
        mode: tiviSettings.mode,
        powerThreshold: tiviSettings.powerThreshold,
        enableInterruption: tiviSettings.enableInterruption,
        ttsCallFn: backendTtsCallFn,
        ttsStreamCallFn: backendTtsStreamFn,
        onQueueStateChange: setSpeechQueueState,
        onQueueFirstUtterance: () => onQueueFirstUtteranceRef.current(),
        onQueueEntryComplete: (info) => {
            log(`TTS entry complete: id=${info.id} text="${(info.text || '').slice(0, 40)}" duration=${info.duration_ms}ms`);
        },
        onQueueDrain: (info) => onQueueDrainRef.current(info),
    });

    const tiviRef = useRef(tivi);
    tiviRef.current = tivi;

    // ── Orchestrator ──
    const orchestrator = useOrchestrator({
        tivi,
        tiviSettings,
        agent: COR,
        insightsClient,
        fpsMonitor,
        sessionStartTime,
    });

    useEffect(() => {
        onQueueFirstUtteranceRef.current = orchestrator.onQueueFirstUtterance;
        onQueueDrainRef.current = orchestrator.onQueueDrain;
    }, [orchestrator.onQueueFirstUtterance, orchestrator.onQueueDrain]);

    useEffect(() => {
        useSmartChatsStore.getState().registerVoiceActions({
            handleStartStop: orchestrator.handleStartStop,
            setTranscribe: orchestrator.setTranscribe,
            cancelSpeech: () => tiviRef.current.cancelSpeech(),
            transcriptionCb: orchestrator.transcriptionCb,
        });
    }, [orchestrator.handleStartStop, orchestrator.setTranscribe, orchestrator.transcriptionCb]);

    // ── Chat mode hook ──
    const chatMode = useChatMode();

    // ── Warmup streaming + TTS + prefetch startup data ──
    useEffect(() => {
        if (authUser && COR?.runner?.warmup) {
            COR.runner.warmup();       // warms llmTtsStreamHttp container
            warmupBackendTts();      // warms ttsStreamHttp container
            prefetchStartup();
        }
    }, [authUser, COR]);

    // ── Register tivi's TTS queue with the LLM caller ──
    // The backend llm caller reads this ref per-call; voice mode flips on
    // automatically once the queue is set, without any runtime swap.
    useEffect(() => {
        if (!tivi.ttsQueue) return;
        tivi.ttsQueue.setExternalAudioMode(true);
        setTtsQueueRef(tivi.ttsQueue);
        log('LLM caller: ttsQueue registered (voice mode available)');
        return () => setTtsQueueRef(null);
    }, [tivi.ttsQueue]);

    // ── Keep TTS queue voice/model in sync with tivi settings ──
    // Without this, the queue defaults to 'nova' and accumulate_text
    // (which speaks via tivi.speak → queue.speakText) uses a different
    // voice than the combined streaming path.
    useEffect(() => {
        if (!tivi.ttsQueue) return;
        tivi.ttsQueue.setVoice(tiviSettings.openaiVoice);
        tivi.ttsQueue.setModel(tiviSettings.openaiModel);
    }, [tivi.ttsQueue, tiviSettings.openaiVoice, tiviSettings.openaiModel]);

    // ── Settings auto-save ──
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!insightsReady) return;
        const current = { aiModel: ai_model, speechCooldownMs, soundFeedback: sound_feedback_from_store };
        const prev = lastSavedSettings.current;
        if (prev && prev.aiModel === current.aiModel && prev.speechCooldownMs === current.speechCooldownMs && prev.soundFeedback === current.soundFeedback) {
            return;
        }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            lastSavedSettings.current = current;
            saveSettings();
        }, 2000);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [ai_model, speechCooldownMs, sound_feedback_from_store, insightsReady]);

    // ── Auto-scroll ──
    const scrollTimerRef = useRef<any>(null);
    useEffect(() => {
        if (scrollTimerRef.current) return;
        scrollTimerRef.current = setTimeout(() => {
            scrollTimerRef.current = null;
            const ids = ['chat_display', 'log_display', 'thought_display'];
            ids.forEach((id) => {
                const el = document.getElementById(id);
                if (el) { el.scrollTop = el.scrollHeight; }
            });
        }, 150);
    }, [chat_history, thought_history, log_history]);

    // ── Window globals ──
    useEffect(() => {
        Object.assign(window, {
            debug,
            get_agent: () => COR,
            transcription_cb: orchestrator.transcriptionCb,
            workspace,
            COR, tivi, sandbox,
            cortexInsights: insightsClient.current,
            classifier,
        });
        return () => {
            // Clean up old workspace snapshots to prevent localStorage quota exhaustion
            Object.keys(localStorage).filter(k => k.startsWith('cortex_workspace_')).forEach(k => localStorage.removeItem(k));
            try {
                localStorage['cortex_workspace_latest'] = JSON.stringify(window.workspace);
            } catch { /* quota — non-critical snapshot */ }
            delete window.workspace;
        };
    }, [COR]);

    // ── Appearance bridge for agent functions ──
    useEffect(() => {
        window.__smartchats_appearance__ = {
            setDesignPack,
            setMode,
            toggleMode,
            getCurrentMode: () => colorMode,
            getCurrentPack: () => pairedPack.id,
            updateTiviSettings,
            setVizMotif,
            getCurrentMotif: () => motifId,
        };
    }, [setDesignPack, setMode, toggleMode, colorMode, pairedPack.id, updateTiviSettings, setVizMotif, motifId]);

    // ── Widget configuration ──
    const { widgets, visibleWidgets, toggleWidget, widgetLayout, saveLayout, resetLayout, applyPreset } = useWidgetConfig();

    // ── Memoized callbacks ──
    const handle_code_change = useCallback((new_params: any) => {
        handleCodeUpdate({ code_params: new_params });
    }, [handleCodeUpdate]);

    const handleTranscribeToggle = useCallback(() => orchestrator.setTranscribe(!useSmartChatsStore.getState().transcribe), [orchestrator.setTranscribe]);
    const handleCancelSpeech = useCallback(() => tiviRef.current.cancelSpeech(), []);
    const handleModelChange = useCallback((model: string) => store_updateSettings({ aiModel: model }), [store_updateSettings]);
    const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
    const handleSaveSession = useCallback(async () => {
        await saveSession();
        toast_toast({ title: 'Session saved', status: 'success', duration: 2000 });
    }, [saveSession]);
    const handleOpenSessions = useCallback(() => setSessionsOpen(true), []);
    const handleLogin = useCallback(() => {
        if (typeof window !== 'undefined' && window.openLoginModal) { window.openLoginModal(); }
    }, []);
    const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);
    const handleCloseSessions = useCallback(() => setSessionsOpen(false), []);
    const handleSpeechCooldownChange = useCallback((ms: number) => store_updateSettings({ speechCooldownMs: ms }), [store_updateSettings]);
    const handlePlaybackRateChange = useCallback((rate: number) => updateTiviSettings({ playbackRate: rate }), [updateTiviSettings]);
    const handleCloseFocused = useCallback(() => setFocusedWidget(null), [setFocusedWidget]);

    // ── Derive current execution ──
    const currentExecution = useMemo(() => {
        if (executionStatus === 'running') return null;
        if (executionHistory.length === 0) return null;
        if (selectedIndex === -1 || selectedIndex >= executionHistory.length) {
            return executionHistory[executionHistory.length - 1];
        }
        return executionHistory[selectedIndex];
    }, [executionHistory, selectedIndex, executionStatus]);

    // ── Widget render props ──
    const widgetProps: WidgetRenderProps = useMemo(() => ({
        chatHistory: chat_history,
        workspace,
        thoughtHistory: thought_history,
        logHistory: log_history,
        codeParams: code_params,
        htmlDisplay: html_display,
        activeVisualization, clearVisualization,
        activeHtml, clearHtml,
        currentCode, executionId, executionStatus, executionError,
        executionDuration, executionResult, functionCalls, variableAssignments,
        sandboxLogs, executionHistory, selectedIndex, isPinned, currentExecution,
        kgGraphData, kgMode, kgDepth, kgVisibleRelationKinds, kgAvailableRelationKinds,
        kgIsSearching, kgAutoDisplay, streamChunks, speechQueueState,
        processes, processOutputs, agentMonitorStates,
        transcriptionCb: orchestrator.transcriptionCb,
        handleCodeChange: handle_code_change,
        handleHistoryItemClick: store_handleHistoryItemClick,
        setIsPinned: store_setIsPinned,
        setFocusedWidget,
        setKgGraphData, updateKgSettings, setKgVisibleRelationKinds, clearKgGraph, searchKnowledgeGraph,
        onSendProcessInput: useSmartChatsStore.getState().sendProcessInput,
        vizContext: { tivi, tiviSettings, updateTiviSettings: updateTiviSettings },
    }), [
        chat_history, workspace, thought_history, log_history, code_params, html_display, activeVisualization, clearVisualization, activeHtml, clearHtml,
        currentExecution, currentCode, executionId, executionStatus, executionError,
        executionDuration, executionResult, functionCalls, variableAssignments,
        sandboxLogs, executionHistory, selectedIndex, isPinned,
        kgGraphData, kgMode, kgDepth, kgVisibleRelationKinds, kgAvailableRelationKinds,
        kgIsSearching, kgAutoDisplay, streamChunks, speechQueueState,
        processes, processOutputs, agentMonitorStates,
        orchestrator.transcriptionCb, handle_code_change, store_handleHistoryItemClick,
        store_setIsPinned, setKgGraphData, updateKgSettings, setKgVisibleRelationKinds,
        clearKgGraph, searchKnowledgeGraph,
        tivi, tiviSettings, updateTiviSettings,
    ]);

    // ═══ COMPOSE SHELL PROPS ═══
    const shellProps: ShellProps = useMemo(() => ({
        voice: {
            started,
            transcribe,
            isSpeaking: tivi.isSpeaking,
            isListening: tivi.isListening,
            interimResult,
            voiceStatus,
            audioLevelRef: tivi.audioLevelRef,
            speechProbRef: tivi.speechProbRef,
        },
        ui: {
            focusedWidget,
            settingsOpen,
            sessionsOpen,
        },
        auth: {
            isAuthenticated,
            user: authUser,
            // Only surface credits when the backend actually has billing.
            totalAvailable: backendCaps.billing ? totalAvailable : undefined,
            creditsLoading: backendCaps.billing ? billingLoading : false,
        },
        settings: {
            aiModel: ai_model,
            speechCooldownMs,
            playbackRate: tiviSettings.playbackRate,
            colorMode,
            designPackId: pairedPack.id,
            contextUsage,
        },
        widgetConfig: {
            widgets,
            visibleWidgets,
            widgetLayout,
        },
        widgetProps,
        actions: {
            onOpenSettings: handleOpenSettings,
            onCloseSettings: handleCloseSettings,
            onOpenSessions: handleOpenSessions,
            onCloseSessions: handleCloseSessions,
            onCloseFocused: handleCloseFocused,
            onLogin: handleLogin,
            onStartStop: orchestrator.handleStartStop,
            onTranscribeToggle: handleTranscribeToggle,
            onCancelSpeech: handleCancelSpeech,
            onModelChange: handleModelChange,
            onSpeechCooldownChange: handleSpeechCooldownChange,
            onPlaybackRateChange: handlePlaybackRateChange,
            onDesignPackChange: setDesignPack,
            onColorModeToggle: toggleMode,
            onSaveSession: handleSaveSession,
            listSessions,
            loadSession,
            toggleWidget,
            applyPreset,
            resetLayout,
            saveLayout,
            chatInput: chatMode.chatInput,
            setChatInput: chatMode.setChatInput,
            isAiTyping: chatMode.isAiTyping,
            handleChatSend: chatMode.handleChatSend,
            handleChatKeyPress: chatMode.handleChatKeyPress,
            chatContainerRef: chatMode.chatContainerRef,
        },
        meta: {
            tivi,
            tiviSettings,
            updateTiviSettings,
            rawStreamRef: orchestrator.rawStreamRef,
            availableDesignPacks: listDesignPacks().map(p => ({ id: p.id, name: p.name })),
            conversationStarted: executionHistory.length > 0,
            activeShell,
            availableShells: SHELL_OPTIONS,
            onShellChange: (id: string) => {
                if (id in SHELLS) {
                    setActiveShell(id as ShellId);
                    localStorage.setItem('smartchats-shell', id);
                }
            },
        },
    }), [
        // Voice
        started, transcribe, tivi.isSpeaking, tivi.isListening, interimResult, voiceStatus,
        // UI
        focusedWidget, settingsOpen, sessionsOpen,
        // Auth
        isAuthenticated, authUser, totalAvailable, billingLoading,
        // Settings
        ai_model, speechCooldownMs, tiviSettings.playbackRate, colorMode, pairedPack.id, contextUsage,
        // Widget config
        widgets, visibleWidgets, widgetLayout,
        // Widget props
        widgetProps,
        // Actions (stable refs from useCallback)
        handleOpenSettings, handleCloseSettings,
        handleOpenSessions, handleCloseSessions, handleCloseFocused, handleLogin,
        orchestrator.handleStartStop, handleTranscribeToggle, handleCancelSpeech,
        handleModelChange, handleSpeechCooldownChange, handlePlaybackRateChange,
        setDesignPack, toggleMode, handleSaveSession,
        listSessions, loadSession,
        toggleWidget, applyPreset, resetLayout, saveLayout,
        chatMode.chatInput, chatMode.setChatInput, chatMode.isAiTyping,
        chatMode.handleChatSend, chatMode.handleChatKeyPress,
        // Meta
        tivi, tiviSettings, updateTiviSettings, executionHistory.length, activeShell,
    ]);

    // ═══ RENDER ACTIVE SHELL ═══
    const ActiveShell = SHELLS[activeShell];

    // Expose shell switching on window for dev + settings integration
    useEffect(() => {
        window.__smartchats_shells__ = {
            active: activeShell,
            available: Object.keys(SHELLS),
            switch: (id: string) => {
                if (id in SHELLS) {
                    setActiveShell(id as ShellId);
                    localStorage.setItem('smartchats-shell', id);
                }
            },
        };
    }, [activeShell]);

    return <ActiveShell {...shellProps} />;
}

export default Component;
