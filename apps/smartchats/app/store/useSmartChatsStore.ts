/**
 * useSmartChatsStore — Zustand store for SmartChats via createInsightStore
 *
 * Centralizes key state that was previously scattered across ~25 useState
 * hooks in app3.tsx. UI-only state (mode, drawerOpen, chatInput, etc.)
 * stays as local useState in app3.tsx.
 */

import { logger, insights } from 'smartchats-common';
import { createInsightStore } from 'smartchats-common';
import { getCortexStore, CORTEX_DATA_KEYS, migrateLegacyLocalStorage, migrateLocalToCloud } from '../lib/storage';
import { checkCloudAuth, notifyCloudAuthRequired, waitForAuthReady, isAuthenticated } from '../lib/authCheck';
import { surreal_query_compat as surreal_query } from '@/lib/backend';
import { toast_toast } from '@/components/Toast';
import { cortexWorkflows } from '../simi';
import { recordTurnComplete } from '../modules/timing';
import { prefetchStartup } from '../modules/initialization';
import { seedBuiltinApps } from '../apps/builtin_apps';
import { listInstalls } from '../modules/app_registry';
import { getApp } from '../modules/app_registry';
import {
    getCurrentSessionId, setCurrentSessionId,
    saveSessionToSurreal, loadSessionFromSurreal, listSessionsFromSurreal,
    generateLabel
} from '../modules/sessions';
import type { ExecutionSnapshot } from '../types/execution';
import type { KGGraphData, GraphMode } from 'graph-viz/lib/types';
import { mergeGraphData as mergeGraphDataUtil, extractRelationKinds } from 'graph-viz/lib/graph-utils';
import { searchResultToGraphData, flatSearchResultToGraphData, triplesToGraphData } from 'graph-viz/lib/adapter';
import { search_knowledge_deep } from '../graph_utils';
import { embed_vector } from '@/lib/backend';

const log = logger.get_logger({ id: 'cortex_store' });

// ── Non-reactive bookkeeping (not Zustand state) ────────────────────
let _initInjected = false;

let _voiceActions: {
  handleStartStop: () => Promise<void>;
  setTranscribe: (v: boolean) => void;
  cancelSpeech: () => void;
  transcriptionCb: (text: string) => Promise<void>;
} | null = null;

let _parentRerunTimer: ReturnType<typeof setTimeout> | null = null;

// UI tour state
const _mobileTourSteps: Array<{ target: string; text: string }> = [
  { target: 'fab', text: 'Tap here to switch to chat mode, stop audio, or access settings' },
  { target: 'account', text: 'Tap here to access your account' },
];
const _desktopTourSteps: Array<{ target: string; text: string }> = [
  { target: 'start-stop', text: 'Click here to start or stop voice interaction' },
  { target: 'load-sessions', text: 'Load previous sessions' },
  { target: 'settings', text: 'Open settings to customize voice, themes, and more' },
  { target: 'account', text: 'Access your account' },
];
let _tourSteps: Array<{ target: string; text: string }> = _mobileTourSteps;
let _tourIndex = 0;
let _tourResolve: (() => void) | null = null;

// ─── Settings type ───────────────────────────────────────────────────

interface SmartChatsSettings {
  aiModel: string;
  speechCooldownMs: number;
  soundFeedback: boolean;
}

const DEFAULT_SETTINGS: SmartChatsSettings = {
  aiModel: 'gpt-5.2',
  speechCooldownMs: 2000,
  soundFeedback: true,
};

// ─── Agent Monitor types ─────────────────────────────────────────────

export interface AgentMonitorState {
  lastResponse: string;
  lastThought: string;
  lastFunctionCall: { name: string; args: any } | null;
  currentCode: string;
  codeResult: any;
  executionStatus: 'idle' | 'running' | 'success' | 'error';
  pendingInput: { data: any; ts: number } | null;
}

// ─── State interface ─────────────────────────────────────────────────

export interface SmartChatsState {
  // === Auth ===
  isAuthenticated: boolean;
  checkAuth(): void;

  // === Settings (persisted) ===
  settingsLoaded: boolean;
  aiModel: string;
  speechCooldownMs: number;
  soundFeedback: boolean;
  updateSettings(partial: Partial<SmartChatsSettings>): void;
  loadSettings(): Promise<void>;
  saveSettings(): Promise<void>;

  // === UI mode ===
  focusedWidget: string | null;
  setFocusedWidget(widgetId: string | null): void;
  /** Shell layout mode — controllable by functions and orchestrator */
  shellMode: 'full' | 'half' | 'icon' | 'guided';
  setShellMode(mode: 'full' | 'half' | 'icon' | 'guided'): void;

  // === Onboarding (test-only) ===
  /** Mark the onboarding flow as skipped programmatically (Simi setup).
   *  Idempotent — safe to call repeatedly across test runs. */
  completeOnboardingForTests(): Promise<void>;
  /** Becomes true after `completeOnboardingForTests` resolves; Simi workflows
   *  can `waitFor` this flag to confirm setup finished before proceeding. */
  onboardingTestComplete: boolean;
  /** UI tour highlight — null when inactive */
  uiTourHighlight: { target: string; text: string } | null;
  /** Run the mobile shell UI tour — sequences through highlights, resolves when done */
  mobileShellUiTour(): Promise<void>;
  /** Advance to next tour step (called by shell on tap) */
  advanceUiTour(): void;

  // === Voice state (not persisted, set by orchestrator) ===
  started: boolean;
  transcribe: boolean;
  interimResult: string;
  voiceStatus: 'idle' | 'listening' | 'processing' | 'speaking';
  lastSpeechTs: number;

  // === Voice action proxies (registered by orchestrator/app3) ===
  registerVoiceActions(actions: { handleStartStop: () => Promise<void>; setTranscribe: (v: boolean) => void; cancelSpeech: () => void; transcriptionCb: (text: string) => Promise<void> }): void;
  startStopVoice(): void;
  toggleTranscribe(): void;
  setTranscribeEnabled(v: boolean): void;
  cancelSpeech(): void;

  // === Chat input (text chat mode) ===
  chatInput: string;
  setChatInput(v: string): void;
  sendChatMessage(): void;

  // === Process input ===
  sendProcessInput(processId: string, data: any): void;

  // === Chat (persisted) ===
  chatHistory: Array<{ role: string; content: string }>;
  lastAiMessage: string;
  addUserMessage(content: string): void;
  addAiMessage(content: string): void;
  clearChat(): void;

  // === Workspace (persisted) ===
  workspace: Record<string, any>;
  updateWorkspace(ws: Record<string, any>): void;

  // === Observable (not persisted) ===
  thoughtHistory: string[];
  logHistory: string[];
  htmlDisplay: string;
  activeHtml: string | null;
  activeVisualization: { type: string; props: any; _ts?: number } | null;
  vizStack: Array<{ type: string; props: any; _ts: number }>;
  codeParams: { code: string; mode: string };
  contextUsage: {
    usagePercent: number; totalUsed: number; contextWindow: number;
    remaining?: number; model?: string; provider?: string;
    messageCount?: number; maxOutputTokens?: number;
    isApproachingLimit?: boolean; isAtLimit?: boolean;
    breakdown?: { systemMessage: number; userMessages: number; assistantMessages: number; total: number };
  } | null;
  usageStats: {
    promptTokens: number; completionTokens: number; cachedInputTokens: number;
    totalTokens: number; costUsd: number; callCount: number;
  } | null;

  // === Event handlers ===
  handleThought(evt: any): void;
  handleLog(evt: any): void;
  handleCodeUpdate(evt: any): void;
  handleHtmlUpdate(evt: any): void;
  handleVisualizationUpdate(evt: any): void;
  clearVisualization(): void;
  dismissViz(ts: number): void;
  clearHtml(): void;
  handleContextStatus(evt: any): void;
  handleUsageUpdate(evt: any): void;
  handleCodeExecutionStart(evt: any): void;
  handleCodeExecutionComplete(evt: any): void;
  handleSandboxLog(evt: any): void;
  handleSandboxEvent(evt: any): void;

  // === Execution state ===
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
  handleHistoryItemClick(index: number): void;
  setIsPinned(pinned: boolean): void;
  captureExecutionSnapshot(): void;

  // === Knowledge Graph ===
  kgGraphData: KGGraphData;
  kgAutoDisplay: boolean;
  kgMode: GraphMode;
  kgDepth: number;
  kgVisibleRelationKinds: Set<string>;
  kgAvailableRelationKinds: string[];
  kgIsSearching: boolean;
  handleKnowledgeGraphUpdate(evt: any): void;
  updateKgSettings(partial: { kgAutoDisplay?: boolean; kgMode?: GraphMode; kgDepth?: number }): void;
  setKgGraphData(data: KGGraphData): void;
  mergeKgGraphData(data: KGGraphData): void;
  clearKgGraph(): void;
  setKgVisibleRelationKinds(kinds: Set<string>): void;
  searchKnowledgeGraph(query: string, depth: number): Promise<KGGraphData | null>;

  // === Background Processes ===
  processes: Array<{ id: string; name: string; mode: string; status: string; completionMode: string; startedAt: number; finishedAt?: number; exitCode?: number; elapsed: number; stdoutLines: number; stderrLines: number }>;
  processOutputs: Record<string, { stdout: Array<{ ts: number; line: string }>; stderr: Array<{ ts: number; line: string }> }>;
  agentMonitorStates: Record<string, AgentMonitorState>;
  handleProcessSpawned(evt: any): void;
  handleProcessOutput(evt: any): void;
  handleProcessComplete(evt: any): void;
  handleProcessAgentEvent(evt: any): void;
  handleProcessNeedsInput(evt: any): void;

  // === Stream Viewer ===
  streamChunks: string[];
  handleStreamChunk(evt: any): void;
  handleStreamEnd(evt: any): void;

  // === Session save/load ===
  saveSession(): Promise<void>;
  autoSaveSession(): Promise<void>;
  loadSession(sessionId: string): Promise<void>;
  listSessions(): Promise<any[]>;

  // === Storage mode ===
  switchStorageMode(mode: 'local' | 'cloud'): Promise<void>;

  // === Agent ref (for replay/dispatch) ===
  agent: any | null;
  setAgent(agent: any): void;
  /** True while the LLM is running (any path) */
  llmRunning: boolean;
  /** True while prefetch startup data is loading (before first LLM call) */
  initLoading: boolean;
  /**
   * Core LLM run. Calls agent.run_llm, manages llmRunning state.
   * Handles pendingRerun (subprocess injection while LLM was running).
   */
  runLlm(): Promise<any>;
  /**
   * Full user→AI message cycle (async, awaits LLM).
   * Adds user message to store + COR, runs LLM, returns result.
   */
  sendMessageAsync(content: string): Promise<any>;
  /**
   * Full user→AI message cycle (fire-and-forget).
   * Adds user message to store + COR, kicks off LLM in background.
   * Returns immediately (sync). Use from transcription_cb and simi workflows.
   */
  sendMessageSync(content: string): void;
  /** Call a cortex function directly by name, no LLM round-trip. */
  callFunction(name: string, params?: Record<string, any>): Promise<any>;
  /** Seed builtin apps and populate installedApps. No LLM needed. */
  seedAndLoadApps(): Promise<void>;
  /**
   * Debounced LLM rerun — optionally injects a result into COR first.
   * Used by subprocess events (process_needs_input, process_complete).
   */
  triggerParentRerun(injection?: { data: any; type?: string }): void;
  /** Pending rerun flag — set when injection arrives while LLM is running */
  _pendingRerun: boolean;

  // === App Platform ===
  activeApp: any | null;
  activeAppId: string | null;
  activeAppSandbox: any | null;
  installedApps: any[];
  appManifestCache: Record<string, any>;
  appOwnsInput: boolean;
  handleAppActivated(evt: any): void;
  handleAppDeactivated(evt: any): void;
  handleAppInstalled(evt: any): void;
  handleAppUninstalled(evt: any): void;
  handleAppUpdated(evt: any): void;

  // === Persistence helpers ===
  saveConversation(): Promise<void>;
  loadConversation(): Promise<void>;
}

// ─── Store ───────────────────────────────────────────────────────────

export const useSmartChatsStore = createInsightStore<SmartChatsState>({
  appName: 'smartchats',
  silent: ['checkAuth', 'captureExecutionSnapshot', 'setAgent', 'registerVoiceActions', 'handleStreamChunk', 'handleStreamEnd', 'handleProcessOutput', 'handleProcessAgentEvent', 'handleSandboxEvent'],
  workflows: cortexWorkflows,
  creator: (set, get, _api, insights) => ({

    // ── Auth ──────────────────────────────────────────────────────────

    isAuthenticated: false,

    checkAuth() {
      const result = checkCloudAuth();
      set({ isAuthenticated: result.isAuthenticated });
      // Don't show toast on initial load — shell handles unauthenticated UX inline
      if (result.needsAttention) {
        insights.emit('cloud_auth_required', { context: 'settings_load' });
      }
    },

    // ── Settings ─────────────────────────────────────────────────────

    settingsLoaded: false,
    aiModel: DEFAULT_SETTINGS.aiModel,
    speechCooldownMs: DEFAULT_SETTINGS.speechCooldownMs,
    soundFeedback: DEFAULT_SETTINGS.soundFeedback,

    updateSettings(partial: Partial<SmartChatsSettings>) {
      const before = { aiModel: get().aiModel, speechCooldownMs: get().speechCooldownMs, soundFeedback: get().soundFeedback };
      set(partial);
      insights.emit('cortex_settings_updated', {
        changed_keys: Object.keys(partial),
        before,
        after: { ...before, ...partial },
      });
    },

    async loadSettings() {
      // Run legacy migration (idempotent)
      const migration = migrateLegacyLocalStorage();
      if (migration.migrated > 0) {
        insights.emit('cortex_legacy_migration', migration);
      }

      // Create/upgrade AppDataStore singleton
      const store = getCortexStore(insights.getClient(), surreal_query);

      // Wait for the auth provider to resolve before cloud queries —
      // on page load, currentUser is null until the SDK loads the
      // persisted token (~300-800ms). Without this, cloud requests
      // go out unauthenticated and return empty.
      if (store.getMode() === 'cloud') {
        await waitForAuthReady(2000);
      }

      // Load settings from storage
      try {
        const stored = await store.get<SmartChatsSettings>(CORTEX_DATA_KEYS.settings);
        if (stored) {
          const merged = { ...DEFAULT_SETTINGS, ...stored };
          set({
            aiModel: merged.aiModel,
            speechCooldownMs: merged.speechCooldownMs,
            soundFeedback: merged.soundFeedback,
          });
          insights.emit('cortex_settings_loaded', {
            source: store.getMode(),
            had_migration: migration.migrated > 0,
            raw_stored: stored,
            merged,
          });
        }
      } catch (err: any) {
        log(`Failed to load settings: ${err}`);
      }

      // Run auth check after settings are loaded
      get().checkAuth();

      set({ settingsLoaded: true });

      insights.emit('cortex_settings_loaded_complete', {
        mode: store.getMode(),
        isAuthenticated: get().isAuthenticated,
      });
    },

    async saveSettings() {
      const { aiModel, speechCooldownMs, soundFeedback } = get();
      const settings: SmartChatsSettings = { aiModel, speechCooldownMs, soundFeedback };
      const store = getCortexStore();
      try {
        await store.set(CORTEX_DATA_KEYS.settings, settings);
        insights.emit('cortex_settings_saved', {
          ok: true,
          mode: store.getMode(),
          settings,
        });
      } catch (err: any) {
        log(`Failed to save settings: ${err}`);
      }
    },

    // ── UI mode ───────────────────────────────────────────────────────

    focusedWidget: null as string | null,
    setFocusedWidget(widgetId: string | null) { set({ focusedWidget: widgetId }); },
    shellMode: 'full' as 'full' | 'half' | 'icon' | 'guided',
    setShellMode(mode: 'full' | 'half' | 'icon' | 'guided') { set({ shellMode: mode }); },

    onboardingTestComplete: false,
    async completeOnboardingForTests() {
      // Lazy import — onboarding module is a runtime dep of the agent; if the
      // agent hasn't mounted yet the helper will no-op the KG persistence
      // (idempotent) but still flips the cache + our own flag so the workflow
      // can proceed.
      const { markOnboardingSkipped } = await import('../modules/onboarding');
      await markOnboardingSkipped();
      set({ onboardingTestComplete: true });
    },
    uiTourHighlight: null as { target: string; text: string } | null,
    mobileShellUiTour() {
      // Pick steps based on whether mobile or desktop elements exist
      const isMobile = !!document.querySelector('[data-tour="fab"]');
      _tourSteps = isMobile ? _mobileTourSteps : _desktopTourSteps;
      return new Promise<void>((resolve) => {
        _tourResolve = resolve;
        _tourIndex = 0;
        set({ uiTourHighlight: _tourSteps[0] || null });
      });
    },
    advanceUiTour() {
      _tourIndex++;
      if (_tourIndex < _tourSteps.length) {
        set({ uiTourHighlight: _tourSteps[_tourIndex] });
      } else {
        set({ uiTourHighlight: null });
        if (_tourResolve) { _tourResolve(); _tourResolve = null; }
      }
    },

    // ── Voice state (not persisted, set by orchestrator) ────────────

    started: false,
    transcribe: true,
    interimResult: '',
    voiceStatus: 'idle' as const,
    lastSpeechTs: 0,

    // ── Voice action proxies ────────────────────────────────────────
    registerVoiceActions(actions: { handleStartStop: () => Promise<void>; setTranscribe: (v: boolean) => void; cancelSpeech: () => void; transcriptionCb: (text: string) => Promise<void> }) {
      _voiceActions = actions;
    },
    startStopVoice() {
      const actions = _voiceActions;
      if (actions) { actions.handleStartStop(); }
      else { log('startStopVoice: no voice actions registered'); }
    },
    toggleTranscribe() {
      const actions = _voiceActions;
      if (actions) { actions.setTranscribe(!get().transcribe); }
      else { log('toggleTranscribe: no voice actions registered'); }
    },
    setTranscribeEnabled(v: boolean) {
      const actions = _voiceActions;
      if (actions) { actions.setTranscribe(v); }
      else { log('setTranscribeEnabled: no voice actions registered'); }
    },
    cancelSpeech() {
      const actions = _voiceActions;
      if (actions) { actions.cancelSpeech(); }
      else { log('cancelSpeech: no voice actions registered'); }
    },

    // ── Chat input ──────────────────────────────────────────────────
    chatInput: '',
    setChatInput(v: string) { set({ chatInput: v }); },
    sendChatMessage() {
      const { chatInput } = get();
      const text = chatInput.trim();
      if (!text) return;
      set({ chatInput: '' });
      const actions = _voiceActions;
      if (actions?.transcriptionCb) {
        actions.transcriptionCb(text);
      } else {
        log('sendChatMessage: no transcriptionCb registered, falling back to sendMessageSync');
        get().sendMessageSync(text);
      }
    },

    // ── Process input ───────────────────────────────────────────────
    sendProcessInput(processId: string, data: any) {
      get().agent?.processManager?.sendInput(processId, data);
    },

    // ── Chat ─────────────────────────────────────────────────────────

    chatHistory: [],
    lastAiMessage: '',

    addUserMessage(content: string) {
      set((s) => ({
        chatHistory: [...s.chatHistory, { role: 'user', content }],
      }));
    },

    addAiMessage(content: string) {
      set((s) => ({
        chatHistory: [...s.chatHistory, { role: 'assistant', content }],
        lastAiMessage: content,
        lastSpeechTs: Date.now(),
      }));
    },

    async clearChat() {
      // Save current session before clearing
      if (get().chatHistory.length > 0) {
        await get().saveSession();
      }
      // Reset session ID so next auto-save creates a new record
      setCurrentSessionId(null);
      set({
        chatHistory: [],
        lastAiMessage: '',
      });
    },

    // ── Workspace ────────────────────────────────────────────────────

    workspace: {},

    updateWorkspace(ws: Record<string, any>) {
      // Merge rather than replace — protects against stale empty workspace emissions
      // from sandbox execution contexts that have a separate workspace copy
      const merged = Object.keys(ws).length > 0 ? { ...get().workspace, ...ws } : get().workspace;
      set({ workspace: merged });
      // Sync back to cortex engine so the next sandbox execution sees the update
      const agent = get().agent;
      if (agent?.workspace) {
        Object.assign(agent.workspace, ws);
      }
    },

    // ── Observable (not persisted) ───────────────────────────────────

    thoughtHistory: [],
    logHistory: [],
    htmlDisplay: '<h1>Hello from Cortex</h1>',
    activeHtml: null,
    activeVisualization: null,
    vizStack: [] as Array<{ type: string; props: any; _ts: number }>,
    codeParams: { code: '', mode: 'javascript' },
    contextUsage: null,
    usageStats: null,

    // ── Event handlers ───────────────────────────────────────────────

    handleThought(evt: any) {
      const { thought } = evt;
      log(`Got thought event: ${thought}`);
      set((s) => {
        const history = [...s.thoughtHistory];
        // If the last entry is a streaming thought (⏳ prefix), replace it with the final clean version
        if (history.length > 0 && history[history.length - 1].startsWith('⏳')) {
          history[history.length - 1] = thought;
        } else {
          history.push(thought);
        }
        return { thoughtHistory: history };
      });
    },

    handleLog(evt: any) {
      log(`Got log event: ${evt.log}`);
      set((s) => ({ logHistory: [...s.logHistory, evt.log] }));
    },

    handleCodeUpdate(evt: any) {
      log(`Got code update event`);
      set({ codeParams: { code: evt.code_params.code, mode: evt.code_params.mode } });
    },

    handleHtmlUpdate(evt: any) {
      log(`Got html update event`);
      set({ htmlDisplay: evt.html, activeHtml: evt.html });
    },

    handleVisualizationUpdate(evt: any) {
      const vizType = evt.vizType || evt.type;
      log(`Got visualization update: ${vizType}${evt.vizId ? ` (vizId: ${evt.vizId})` : ''}`);
      const vizId = evt.vizId || undefined;
      set((s) => {
        const existingIdx = vizId ? s.vizStack.findIndex((v: any) => v.vizId === vizId) : -1;
        if (existingIdx >= 0) {
          // Update in place — keep _ts so React key stays stable
          const updated = [...s.vizStack];
          updated[existingIdx] = { ...updated[existingIdx], type: vizType, props: evt.props };
          // Also update matching viz entry in chatHistory
          const ts = updated[existingIdx]._ts;
          const chatHistory = s.chatHistory.map((m: any) =>
            m.role === 'viz' && m._ts === ts ? { ...m, vizProps: evt.props, vizType } : m
          );
          return { vizStack: updated, activeVisualization: updated[existingIdx], chatHistory };
        }
        const entry = { type: vizType, props: evt.props, _ts: Date.now() + Math.random(), vizId };
        return {
          activeVisualization: entry,
          vizStack: [...s.vizStack, entry].slice(-3), // FIFO, max 3
          // Also push viz as a chat item so it scrolls normally in chat mode
          chatHistory: [...s.chatHistory, { role: 'viz', content: '', vizType, vizProps: evt.props, _ts: entry._ts }],
        };
      });
    },

    clearVisualization() {
      set({ activeVisualization: null, vizStack: [] });
    },

    dismissViz(ts: number) {
      set((s) => {
        const vizStack = s.vizStack.filter(v => v._ts !== ts);
        return { vizStack, activeVisualization: vizStack.length > 0 ? vizStack[vizStack.length - 1] : null };
      });
    },

    clearHtml() {
      set({ activeHtml: null });
    },

    handleContextStatus(evt: any) {
      const s = evt.status;
      log(`Context: ${s.usagePercent.toFixed(1)}% (${s.totalUsed}/${s.contextWindow} tokens)`);
      set({
        contextUsage: {
          usagePercent: s.usagePercent,
          totalUsed: s.totalUsed,
          contextWindow: s.contextWindow,
          remaining: s.remaining,
          model: s.model,
          provider: s.provider,
          messageCount: s.messageCount,
          maxOutputTokens: s.maxOutputTokens,
          isApproachingLimit: s.isApproachingLimit,
          isAtLimit: s.isAtLimit,
          breakdown: s.breakdown,
        },
      });
    },

    handleUsageUpdate(evt: any) {
      log(`Usage update: call #${evt.cumulative?.callCount}, total=${evt.cumulative?.totalTokens}`);
      if (evt.cumulative) {
        set({
          usageStats: {
            promptTokens: evt.cumulative.promptTokens,
            completionTokens: evt.cumulative.completionTokens,
            cachedInputTokens: evt.cumulative.cachedInputTokens,
            totalTokens: evt.cumulative.totalTokens,
            costUsd: evt.cumulative.costUsd,
            callCount: evt.cumulative.callCount,
          },
        });
      }
    },

    handleCodeExecutionStart(evt: any) {
      log(`Got code execution start event`);
      const { isPinned } = get();
      set({
        currentCode: evt.code,
        executionId: evt.executionId,
        executionStatus: 'running',
        executionError: '',
        executionDuration: 0,
        functionCalls: [],
        variableAssignments: [],
        sandboxLogs: [],
        ...(isPinned ? {} : { selectedIndex: -1 }),
      });
      insights.emit('code_execution_start', {
        executionId: evt.executionId,
        code_length: evt.code?.length || 0,
      });
    },

    handleCodeExecutionComplete(evt: any) {
      log(`Got code execution complete event`);
      const { status, error, duration, result } = evt;
      set({
        executionStatus: status,
        executionError: error || '',
        executionDuration: duration,
        executionResult: result,
      });
      insights.emit('code_execution_complete', {
        status: evt.status,
        error: evt.error || null,
        duration_ms: evt.duration,
        has_result: evt.result !== undefined && evt.result !== null,
      });
      // Capture snapshot after state is set
      setTimeout(() => get().captureExecutionSnapshot(), 0);
    },

    handleSandboxLog(evt: any) {
      log(`Got sandbox log event: ${evt.level}`);
      set((s) => ({
        sandboxLogs: [...s.sandboxLogs, {
          level: evt.level,
          args: evt.args,
          timestamp: evt.timestamp,
        }],
      }));
    },

    handleSandboxEvent(evt: any) {
      const { eventType, data, timestamp } = evt;
      log(`Got sandbox event: ${eventType}`);

      switch (eventType) {
        case 'function_start':
          set((s) => ({
            functionCalls: [...s.functionCalls, {
              name: data.name,
              args: data.args,
              timestamp,
              callId: data.callId,
              status: 'running',
            }],
          }));
          break;

        case 'function_end':
          set((s) => ({
            functionCalls: s.functionCalls.map((call: any) =>
              call.callId === data.callId
                ? { ...call, duration: data.duration, status: 'success', result: data.result }
                : call
            ),
          }));
          break;

        case 'function_error':
          set((s) => ({
            functionCalls: s.functionCalls.map((call: any) =>
              call.callId === data.callId
                ? { ...call, error: data.error, status: 'error' }
                : call
            ),
          }));
          break;

        case 'variable_set':
          set((s) => ({
            variableAssignments: [...s.variableAssignments, {
              name: data.name,
              value: data.value,
              timestamp,
            }],
          }));
          break;
      }
    },

    // ── Execution state ──────────────────────────────────────────────

    currentCode: '',
    executionId: '',
    executionStatus: 'idle',
    executionError: '',
    executionDuration: 0,
    executionResult: undefined,
    functionCalls: [],
    variableAssignments: [],
    sandboxLogs: [],
    executionHistory: [],
    selectedIndex: -1,
    isPinned: false,

    handleHistoryItemClick(index: number) {
      set({ selectedIndex: index });
    },

    setIsPinned(pinned: boolean) {
      set({ isPinned: pinned });
    },

    captureExecutionSnapshot() {
      const { executionStatus, executionId, currentCode, executionError,
              executionDuration, executionResult, functionCalls,
              variableAssignments, sandboxLogs, isPinned } = get();

      if ((executionStatus === 'success' || executionStatus === 'error') && executionId) {
        const snapshot: ExecutionSnapshot = {
          executionId,
          timestamp: Date.now(),
          code: currentCode,
          status: executionStatus as 'success' | 'error',
          error: executionError || undefined,
          duration: executionDuration,
          result: executionResult,
          functionCalls: [...functionCalls],
          variableAssignments: [...variableAssignments],
          sandboxLogs: [...sandboxLogs],
        };

        set((s) => {
          const updated = [...s.executionHistory, snapshot].slice(-100);
          return {
            executionHistory: updated,
            ...(isPinned ? {} : { selectedIndex: -1 }),
          };
        });
      }
    },

    // ── Knowledge Graph ──────────────────────────────────────────────

    kgGraphData: { nodes: [], edges: [] } as KGGraphData,
    kgAutoDisplay: true,
    kgMode: 'accumulate' as GraphMode,
    kgDepth: 1,
    kgVisibleRelationKinds: new Set<string>(),
    kgAvailableRelationKinds: [] as string[],
    kgIsSearching: false,

    handleKnowledgeGraphUpdate(evt: any) {
      const { graphData } = evt;
      if (!graphData) return;

      // Emit DOM event for live KG visualizations (e.g. star graph in onboarding)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('smartchats:kg_update', { detail: graphData }));
      }

      const { kgAutoDisplay, kgMode } = get();
      if (!kgAutoDisplay) return;

      if (kgMode === 'replace') {
        set({
          kgGraphData: graphData,
          kgAvailableRelationKinds: extractRelationKinds(graphData),
        });
      } else {
        const merged = mergeGraphDataUtil(get().kgGraphData, graphData);
        set({
          kgGraphData: merged,
          kgAvailableRelationKinds: extractRelationKinds(merged),
        });
      }
    },

    updateKgSettings(partial: { kgAutoDisplay?: boolean; kgMode?: GraphMode; kgDepth?: number }) {
      set(partial as any);
    },

    setKgGraphData(data: KGGraphData) {
      set({
        kgGraphData: data,
        kgAvailableRelationKinds: extractRelationKinds(data),
      });
    },

    mergeKgGraphData(data: KGGraphData) {
      const merged = mergeGraphDataUtil(get().kgGraphData, data);
      set({
        kgGraphData: merged,
        kgAvailableRelationKinds: extractRelationKinds(merged),
      });
    },

    clearKgGraph() {
      set({
        kgGraphData: { nodes: [], edges: [] },
        kgVisibleRelationKinds: new Set<string>(),
        kgAvailableRelationKinds: [],
      });
    },

    setKgVisibleRelationKinds(kinds: Set<string>) {
      set({ kgVisibleRelationKinds: kinds });
    },

    async searchKnowledgeGraph(query: string, depth: number): Promise<KGGraphData | null> {
      set({ kgIsSearching: true });
      try {
        const result = await search_knowledge_deep(query, { depth });
        const graphData = searchResultToGraphData(result);
        const { kgMode } = get();

        if (kgMode === 'replace') {
          set({
            kgGraphData: graphData,
            kgAvailableRelationKinds: extractRelationKinds(graphData),
          });
        } else {
          const merged = mergeGraphDataUtil(get().kgGraphData, graphData);
          set({
            kgGraphData: merged,
            kgAvailableRelationKinds: extractRelationKinds(merged),
          });
        }

        insights.emit('kg_search_complete', {
          query,
          depth,
          mode: kgMode,
          result_nodes: graphData.nodes.length,
          result_edges: graphData.edges.length,
        });
        return graphData;
      } catch (err: any) {
        log(`searchKnowledgeGraph error: ${err}`);
        insights.emit('kg_search_error', {
          query,
          depth,
          error: err?.message || String(err),
        });
        return null;
      } finally {
        set({ kgIsSearching: false });
      }
    },

    // ── Background Processes ──────────────────────────────────────

    processes: [] as Array<{ id: string; name: string; mode: string; status: string; completionMode: string; startedAt: number; finishedAt?: number; exitCode?: number; elapsed: number; stdoutLines: number; stderrLines: number }>,
    processOutputs: {} as Record<string, { stdout: Array<{ ts: number; line: string }>; stderr: Array<{ ts: number; line: string }> }>,
    agentMonitorStates: {} as Record<string, AgentMonitorState>,

    handleProcessSpawned(evt: any) {
      set((s) => ({
        processes: [...s.processes, {
          id: evt.id,
          name: evt.name,
          mode: evt.mode,
          status: evt.status,
          completionMode: evt.completionMode,
          startedAt: evt.startedAt,
          elapsed: 0,
          stdoutLines: 0,
          stderrLines: 0,
        }],
        processOutputs: {
          ...s.processOutputs,
          [evt.id]: { stdout: [], stderr: [] },
        },
      }));
    },

    handleProcessOutput(evt: any) {
      set((s) => {
        const outputs = { ...s.processOutputs };
        const existing = outputs[evt.processId] || { stdout: [], stderr: [] };
        const entry = { ts: evt.ts, line: evt.line };
        if (evt.stream === 'stderr') {
          outputs[evt.processId] = { ...existing, stderr: [...existing.stderr, entry] };
        } else {
          outputs[evt.processId] = { ...existing, stdout: [...existing.stdout, entry] };
        }
        // Update line counts in process list
        const processes = s.processes.map(p =>
          p.id === evt.processId
            ? { ...p, stdoutLines: outputs[evt.processId].stdout.length, stderrLines: outputs[evt.processId].stderr.length }
            : p
        );
        return { processOutputs: outputs, processes };
      });
    },

    handleProcessComplete(evt: any) {
      set((s) => ({
        processes: s.processes.map(p =>
          p.id === evt.id
            ? { ...p, status: evt.status, exitCode: evt.exitCode, finishedAt: evt.finishedAt, elapsed: evt.elapsed }
            : p
        ),
      }));
    },

    handleProcessAgentEvent(evt: any) {
      const { processId, event } = evt;
      if (!event) return;

      set((s) => {
        const prev = s.agentMonitorStates[processId] || {
          lastResponse: '',
          lastThought: '',
          lastFunctionCall: null,
          currentCode: '',
          codeResult: undefined,
          executionStatus: 'idle' as const,
          pendingInput: null,
        };

        // Clear pendingInput on any new event (child has resumed)
        const base = prev.pendingInput ? { ...prev, pendingInput: null } : prev;

        let updated: AgentMonitorState;
        switch (event.type) {
          case 'thought':
            updated = { ...base, lastThought: event.thought || '' };
            break;
          case 'response_chunk':
            updated = { ...base, lastResponse: base.lastResponse + (event.chunk || '') };
            break;
          case 'response_complete':
            updated = { ...base, lastResponse: event.response || '' };
            break;
          case 'code_execution_start':
            updated = { ...base, currentCode: event.code || '', executionStatus: 'running', codeResult: undefined };
            break;
          case 'code_execution_complete':
            updated = {
              ...base,
              executionStatus: event.status === 'success' ? 'success' : event.status === 'error' ? 'error' : base.executionStatus,
              codeResult: event.result ?? event.error ?? undefined,
            };
            break;
          case 'sandbox_event':
            if (event.eventType === 'function_start') {
              updated = { ...base, lastFunctionCall: { name: event.data?.name || '', args: event.data?.args } };
            } else {
              return s; // no change
            }
            break;
          default:
            return s; // no change
        }

        return {
          agentMonitorStates: { ...s.agentMonitorStates, [processId]: updated },
        };
      });
    },

    handleProcessNeedsInput(evt: any) {
      const { processId, data, ts } = evt;
      set((s) => {
        const prev = s.agentMonitorStates[processId] || {
          lastResponse: '',
          lastThought: '',
          lastFunctionCall: null,
          currentCode: '',
          codeResult: undefined,
          executionStatus: 'idle' as const,
          pendingInput: null,
        };
        return {
          agentMonitorStates: {
            ...s.agentMonitorStates,
            [processId]: { ...prev, pendingInput: { data, ts } },
          },
        };
      });
    },

    // ── Stream Viewer ─────────────────────────────────────────────

    streamChunks: [] as string[],

    handleStreamChunk(evt: any) {
      set((s) => ({ streamChunks: [...s.streamChunks, evt.chunk] }));
    },

    handleStreamEnd(_evt: any) {
      set((s) => ({ streamChunks: [...s.streamChunks, '\n---\n'] }));
    },

    // ── App Platform ─────────────────────────────────────────────────

    activeApp: null as any | null,
    activeAppId: null as string | null,
    activeAppSandbox: null as any | null,
    installedApps: [] as any[],
    appManifestCache: {} as Record<string, any>,
    appOwnsInput: false,

    handleAppActivated(evt: any) {
      set({
        activeApp: evt.manifest,
        activeAppId: evt.manifest.id,
        activeAppSandbox: evt.sandbox || null,
        appOwnsInput: evt.manifest.interaction_mode === 'app_driven',
        // Set activeHtml so the shell renders the app container
        activeHtml: evt.sandbox ? '__app__' : (evt.manifest.html_templates?.main || null),
        shellMode: 'icon',
      });
      insights.emit('app_activated', {
        app_id: evt.manifest.id,
        app_name: evt.manifest.name,
        source: evt.manifest.source,
        version: evt.manifest.version,
        interaction_mode: evt.manifest.interaction_mode || 'agent_driven',
        permissions: evt.manifest.permissions,
        requested_functions: evt.manifest.requested_functions,
        granted_permissions: evt.install?.granted_permissions,
        has_html: !!evt.manifest.html_templates?.main,
        function_count: evt.manifest.modules?.reduce((n: number, m: any) => n + (m.functions?.length || 0), 0) || 0,
      });
    },

    handleAppDeactivated(evt: any) {
      const prev = get().activeApp;
      set({
        activeApp: null,
        activeAppId: null,
        activeAppSandbox: null,
        appOwnsInput: false,
        activeHtml: null,
        shellMode: 'full',
      });
      insights.emit('app_deactivated', {
        app_id: evt.app_id,
        app_name: prev?.name || evt.app_id,
      });
    },

    handleAppInstalled(evt: any) {
      set({
        installedApps: [...get().installedApps, evt.install],
        appManifestCache: { ...get().appManifestCache, [evt.manifest.id]: evt.manifest },
      });
      insights.emit('app_installed', {
        app_id: evt.manifest.id,
        app_name: evt.manifest.name,
        source: evt.manifest.source,
        version: evt.manifest.version,
      });
    },

    handleAppUninstalled(evt: any) {
      const cache = { ...get().appManifestCache };
      delete cache[evt.app_id];
      set({
        installedApps: get().installedApps.filter((i: any) => i.app_id !== evt.app_id),
        appManifestCache: cache,
      });
      insights.emit('app_uninstalled', { app_id: evt.app_id });
    },

    handleAppUpdated(evt: any) {
      const cache = { ...get().appManifestCache, [evt.manifest.id]: evt.manifest };
      set({ appManifestCache: cache });
      if (get().activeAppId === evt.manifest.id) {
        set({ activeApp: evt.manifest });
      }
      insights.emit('app_updated', {
        app_id: evt.manifest.id,
        app_name: evt.manifest.name,
        version: evt.manifest.version,
      });
    },

    // ── Session save/load ────────────────────────────────────────────

    async saveSession() {
      const state = get();
      // Skip if no conversation content (just the system message)
      if (state.chatHistory.length <= 1) return;

      const label = generateLabel(state.chatHistory);
      const sessionData = {
        label,
        message_count: state.chatHistory.filter((m: any) => m.role !== 'system').length,
        chat_history: state.chatHistory,
        workspace: state.workspace,
        thought_history: state.thoughtHistory,
        execution_history: state.executionHistory.slice(-50), // Cap to avoid huge records
        settings: {
          aiModel: state.aiModel,
          speechCooldownMs: state.speechCooldownMs,
          soundFeedback: state.soundFeedback,
        },
      };

      try {
        const savedId = await saveSessionToSurreal(sessionData);
        insights.emit('cortex_session_saved', { sessionId: savedId, label });
        log(`Session saved: ${savedId}`);
      } catch (err: any) {
        log(`Failed to save session: ${err}`);
      }
    },

    async autoSaveSession() {
      try {
        const state = get();
        if (state.chatHistory.length <= 1) return;
        await get().saveSession();
      } catch (err: any) {
        log(`Auto-save failed: ${err}`);
      }
    },

    async loadSession(sessionId: string) {
      try {
        // Auto-save current session before switching
        if (get().chatHistory.length > 1) {
          await get().saveSession();
        }

        const session = await loadSessionFromSurreal(sessionId);
        if (!session) {
          log(`Session not found: ${sessionId}`);
          return;
        }

        // Switch to the loaded session
        setCurrentSessionId(sessionId);

        set({
          chatHistory: session.chat_history || get().chatHistory,
          workspace: session.workspace || {},
          thoughtHistory: session.thought_history || [],
          logHistory: [],
          executionHistory: session.execution_history || [],
          aiModel: session.settings?.aiModel || get().aiModel,
          speechCooldownMs: session.settings?.speechCooldownMs || get().speechCooldownMs,
          soundFeedback: session.settings?.soundFeedback ?? get().soundFeedback,
        });

        // Sync agent messages so it has conversation context for the next user message
        const { agent } = get();
        if (agent && session.chat_history) {
          agent.messages = session.chat_history
            .filter((m: any) => m.role !== 'system' && m.role !== 'viz')
            .map((m: any) => ({ role: m.role, content: m.content }));
        }

        insights.emit('cortex_session_loaded', { sessionId });
        log(`Session loaded: ${sessionId}`);
      } catch (err: any) {
        log(`Failed to load session: ${err}`);
      }
    },

    async listSessions() {
      try {
        return await listSessionsFromSurreal(50);
      } catch (err: any) {
        log(`Failed to list sessions: ${err}`);
        return [];
      }
    },

    // ── Storage mode ─────────────────────────────────────────────────

    async switchStorageMode(mode: 'local' | 'cloud') {
      const store = getCortexStore();
      try {
        if (mode === 'cloud') {
          // Check auth first
          if (!isAuthenticated()) {
            notifyCloudAuthRequired('switch_to_cloud', (type, payload) =>
              insights.emit(type, payload)
            );
            return;
          }
          store.switchToCloud(surreal_query);
          // Migrate local data to cloud
          const migrationResult = await migrateLocalToCloud(surreal_query);
          insights.emit('storage_mode_changed', { mode, ...migrationResult });
          toast_toast({
            title: 'Switched to cloud storage',
            description: `${migrationResult.migrated} items migrated`,
            status: 'success',
            duration: 3000,
          });
        } else {
          store.switchToLocal();
          insights.emit('storage_mode_changed', { mode });
          toast_toast({
            title: 'Switched to local storage',
            description: 'Data stored in this browser only',
            status: 'info',
            duration: 3000,
          });
        }
        // Reload data from new backend
        await get().loadSettings();
        await get().loadConversation();
      } catch (err: any) {
        log(`Failed to switch storage mode: ${err}`);
        insights.emit('storage_mode_change_failed', { mode, error: err?.message });
      }
    },

    // ── Agent ref (for replay/dispatch) ─────────────────────────────

    agent: null as any,

    setAgent(agent: any) {
      set({ agent });
    },

    llmRunning: false,
    initLoading: false,
    _pendingRerun: false,

    async runLlm() {
      const { agent } = get();
      if (!agent) { log('runLlm: no agent available'); return; }

      // One-time: inject prefetched startup data before first LLM call
      if (!_initInjected) {
        _initInjected = true;
        set({ initLoading: true });
        try {
          const initData = await prefetchStartup();
          // Check onboarding status from KG data (structured: { relations: [{ source, relation, target }] })
          const kgRelations = initData.current_user_kg?.relations || [];
          const onboardingComplete = kgRelations.some((r: any) =>
            r.source === 'onboarding' && r.relation === 'complete' && (r.target === 'conclusion' || r.target === 'skipped')
          );
          // Inject only summaries into LLM context — not full app manifests with HTML/code
          const llmData: any = {
            ...initData,
            installed_apps: (initData.installed_apps || []).map((x: any) => x.summary || { id: x.install?.app_id }),
          };
          if (!onboardingComplete) {
            llmData._directive = 'ONBOARDING NOT COMPLETE. You MUST call voice_interaction_explainer immediately on your first turn. Do NOT greet the user or speak first — the explainer handles everything. Check the trailing [Onboarding] state for details.';
          }
          agent.add_user_data_input(llmData, 'initialization');
          log('runLlm: startup data injected');

          // Seed builtin apps if needed, then populate app platform state
          if (!initData.installed_apps || initData.installed_apps.length === 0) {
            log('runLlm: no installed apps found, seeding builtins');
            await get().seedAndLoadApps();
          } else {
            const installs = initData.installed_apps.map((x: any) => x.install);
            const cache: Record<string, any> = {};
            for (const x of initData.installed_apps) {
              if (x.manifest) cache[x.install.app_id] = x.manifest;
            }
            set({ installedApps: installs, appManifestCache: cache });
            log(`runLlm: loaded ${installs.length} installed app(s)`);
          }
        } catch (err) {
          log(`runLlm: startup prefetch failed: ${err}`);
        }
        set({ initLoading: false });
      }

      if (get().llmRunning) { log('runLlm: already running, setting pendingRerun'); set({ _pendingRerun: true }); return; }

      set({ llmRunning: true });
      try {
        log('runLlm: calling run_llm');
        const result = await agent.run_llm(4);
        log('runLlm: run_llm complete');

        // Record turn completion for timing
        recordTurnComplete();

        // Check if subprocess injected results while LLM was running
        if (get()._pendingRerun) {
          set({ _pendingRerun: false });
          log('runLlm: pendingRerun detected, re-running');
          set({ llmRunning: false });
          return get().runLlm();
        }

        return result;
      } catch (err: any) {
        if (err?.name === 'CortexCancelledError') {
          log('runLlm: cancelled');
          if (get()._pendingRerun) {
            set({ _pendingRerun: false });
            log('runLlm: pendingRerun detected after cancel, re-running');
            set({ llmRunning: false });
            return get().runLlm();
          }
          return undefined;
        }
        if (err?.message?.includes('insufficient_credits')) {
          toast_toast({
            title: 'Out of credits',
            description: 'Go to Settings \u2192 Billing to purchase more or add your own API key.',
            status: 'warning',
            duration: 8000,
          });
          return undefined; // swallow — don't rethrow to React
        }
        log(`runLlm error: ${err}`);
        throw err;
      } finally {
        set({ llmRunning: false });
      }
    },

    async sendMessageAsync(content: string) {
      const { agent } = get();
      if (!agent) { log('sendMessageAsync: no agent available'); return; }

      // 1. Add user message to store + COR
      get().addUserMessage(content);
      agent.add_user_text_input(content);

      // 2. Emit user input telemetry
      const client = insights.getClient();
      if (client) {
        (client as any).addUserInput?.({
          input_mode: 'dispatch',
          input_length: content.length,
          context: { content },
        })?.catch?.(() => {});
      }

      // 3. Run LLM (awaits)
      return get().runLlm();
    },

    sendMessageSync(content: string) {
      const { agent } = get();
      if (!agent) { log('sendMessageSync: no agent available'); return; }

      // 1. Add user message to store + COR
      get().addUserMessage(content);
      agent.add_user_text_input(content);

      // 2. Emit user input telemetry
      const client = insights.getClient();
      if (client) {
        (client as any).addUserInput?.({
          input_mode: 'dispatch',
          input_length: content.length,
          context: { content },
        })?.catch?.(() => {});
      }

      // 3. Fire-and-forget LLM
      get().runLlm().catch((err: any) => {
        log(`sendMessageSync: runLlm error: ${err}`);
        const msg = err?.message || String(err);
        if (msg.includes('Your input exceeds the context window')) {
          get().addAiMessage('The conversation is too long for this model. Try clearing the chat or switching to a model with a larger context window.');
        } else {
          // Feed error back to the model and retry
          const { agent } = get();
          if (agent) {
            agent.add_user_data_input({ error: msg }, 'system_error');
            get().runLlm().catch((retryErr: any) => {
              log(`sendMessageSync: retry also failed: ${retryErr}`);
              get().addAiMessage('Something went wrong. Please try again.');
            });
          }
        }
      });
    },

    async seedAndLoadApps() {
      log('seedAndLoadApps: starting');
      await seedBuiltinApps(embed_vector);
      const installs = await listInstalls();
      const cache: Record<string, any> = {};
      for (const inst of installs) {
        const manifest = await getApp(inst.app_id).catch(() => null);
        if (manifest) cache[inst.app_id] = manifest;
      }
      set({ installedApps: installs, appManifestCache: cache });
      log('seedAndLoadApps: done, ' + installs.length + ' apps');
    },

    async callFunction(name: string, params?: Record<string, any>) {
      const { agent } = get();
      if (!agent) throw new Error('callFunction: no agent available');
      const fn = agent.function_dictionary?.[name];
      if (!fn) throw new Error(`callFunction: function "${name}" not found`);
      return await fn.fn({ params: params || {}, util: agent.build_function_util() });
    },

    triggerParentRerun(injection?: { data: any; type?: string }) {
      const { agent } = get();
      if (!agent) return;
      if (injection) {
        agent.add_user_data_input(injection.data, injection.type);
      }
      // Debounce 500ms — multiple subprocess events may fire in quick succession
      if (_parentRerunTimer) clearTimeout(_parentRerunTimer);
      _parentRerunTimer = setTimeout(() => {
        _parentRerunTimer = null;
        get().runLlm().catch((err: any) => {
          log(`triggerParentRerun: runLlm error: ${err}`);
        });
      }, 500);
    },

    // ── Persistence helpers ──────────────────────────────────────────

    async saveConversation() {
      const { chatHistory, workspace } = get();
      const store = getCortexStore();
      try {
        await store.set(CORTEX_DATA_KEYS.conversations, { chat_history: chatHistory, workspace });
      } catch (err: any) {
        log(`Failed to save conversation: ${err}`);
      }
    },

    async loadConversation() {
      const store = getCortexStore();
      try {
        const data = await store.get<{ chat_history: any[]; workspace: Record<string, any> }>(CORTEX_DATA_KEYS.conversations);
        if (data) {
          if (data.chat_history && data.chat_history.length > 0) {
            set({ chatHistory: data.chat_history });
          }
          if (data.workspace) {
            set({ workspace: data.workspace });
          }
          insights.emit('cortex_conversation_loaded', {
            chat_length: data.chat_history?.length || 0,
            has_workspace: !!data.workspace && Object.keys(data.workspace).length > 0,
            workspace_keys: data.workspace ? Object.keys(data.workspace) : [],
            last_message_role: data.chat_history?.length ? data.chat_history[data.chat_history.length - 1].role : null,
            last_message_preview: data.chat_history?.length ? data.chat_history[data.chat_history.length - 1].content?.slice(0, 200) : null,
          });
        }
      } catch (err: any) {
        log(`Failed to load conversation: ${err}`);
      }
    },
  }),
});
