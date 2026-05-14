/**
 * Shell — a swappable UI layout/organization strategy.
 *
 * A shell decides how the app is ORGANIZED (layout, navigation, widget density).
 * It does NOT decide how it looks — that's the DesignPack's job.
 *
 * Architecture (composition patterns):
 *   app3.tsx (host) computes all state → passes typed ShellProps to active shell
 *   Each shell variant composes the layout differently using the same props
 *   Shells and design packs are orthogonal — any shell × any pack works
 */

import type { ComponentType, KeyboardEvent, MutableRefObject } from 'react';
import type { WidgetRenderProps } from '../../app/components/FullscreenWidget';

export type ShellTarget = 'desktop' | 'mobile';

export type ShellMetadata = {
  id: string;
  name: string;
  description: string;
  target: ShellTarget;
  minWidth?: number;
  maxWidth?: number;
};

// ── Shell State: all reactive data the shell needs to render ──

export type ShellVoiceState = {
  started: boolean;
  transcribe: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  interimResult: string;
  voiceStatus: 'idle' | 'listening' | 'processing' | 'speaking';
  /** Audio level ref from tivi */
  audioLevelRef: any;
  /** Speech probability ref from tivi */
  speechProbRef: any;
};

export type ShellUIState = {
  focusedWidget: string | null;
  settingsOpen: boolean;
  sessionsOpen: boolean;
};

export type ShellAuthState = {
  isAuthenticated: boolean;
  /** Current auth user, or null if signed out / deployment doesn't require auth. */
  user: { uid: string; email: string | null; displayName: string | null } | null;
  /** Undefined when the backend has no billing capability (e.g. LocalBackend). */
  totalAvailable?: number;
  creditsLoading: boolean;
};

export type ShellSettingsState = {
  aiModel: string;
  speechCooldownMs: number;
  playbackRate: number;
  colorMode: 'dark' | 'light';
  designPackId: string;
  contextUsage: any;
};

export type ShellWidgetConfig = {
  /** Widget config array for settings panel (WidgetConfig[]) */
  widgets: Array<{ id: string; name: string; visible: boolean; order: number }>;
  /** Visible widgets filtered/sorted from widgets (for grid) */
  visibleWidgets: Array<{ id: string; name: string }>;
  widgetLayout: any;
};

// ── Shell Actions: all callbacks the shell can trigger ──

export type ShellActions = {
  // Navigation
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onOpenSessions: () => void;
  onCloseSessions: () => void;
  onCloseFocused: () => void;
  onLogin: () => void;

  // Voice
  onStartStop: () => void;
  onTranscribeToggle: () => void;
  onCancelSpeech: () => void;

  // Settings
  onModelChange: (model: string) => void;
  onSpeechCooldownChange: (ms: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  onDesignPackChange: (id: string) => void;
  onColorModeToggle: () => void;

  // Sessions
  onSaveSession: () => Promise<void>;
  listSessions: () => Promise<Array<{ id: string; label: string; timestamp: number }>>;
  loadSession: (sessionId: string) => Promise<void>;

  // Widgets
  toggleWidget: (id: string) => void;
  applyPreset: (preset: string) => void;
  resetLayout: () => void;
  saveLayout: (layout: any) => void;

  // Chat mode
  chatInput: string;
  setChatInput: (v: string) => void;
  isAiTyping: boolean;
  handleChatSend: () => void;
  handleChatKeyPress: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  chatContainerRef: any;
};

// ── Shell Meta: non-reactive refs and tivi instance ──

/**
 * ShellMeta — non-reactive resources shared across all shells.
 *
 * Unlike the other shell prop buckets (voice, ui, auth, settings) which are
 * Zustand state slices, meta holds things that aren't store state: object
 * instances, refs, derived values, and configuration option lists.
 * Think of it as the shell's shared resource bag.
 */
export type ShellMeta = {
  tivi: any;
  tiviSettings: any;
  /** Ref holding raw stream text for cybernetic UI effects */
  rawStreamRef?: MutableRefObject<string>;
  updateTiviSettings: (partial: any) => void;
  availableDesignPacks: Array<{ id: string; name: string }>;
  conversationStarted: boolean;
  activeShell: string;
  availableShells: Array<{ id: string; name: string }>;
  onShellChange: (id: string) => void;
};

// ── Composite ShellProps: everything the shell needs ──

export type ShellProps = {
  voice: ShellVoiceState;
  ui: ShellUIState;
  auth: ShellAuthState;
  settings: ShellSettingsState;
  widgetConfig: ShellWidgetConfig;
  widgetProps: WidgetRenderProps;
  actions: ShellActions;
  meta: ShellMeta;
};

export type ShellDefinition = {
  metadata: ShellMetadata;
  component: ComponentType<ShellProps>;
};
