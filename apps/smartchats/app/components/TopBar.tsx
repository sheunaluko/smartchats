'use client';

import React from 'react';
import type { AuthUser } from 'smartchats-backend';
import { AppHeader } from '../ui/recipes/AppHeader';

interface TopBarProps {
  // Voice controls
  started: boolean;
  onStartStop: () => void;

  // Transcription
  transcribe: boolean;
  onTranscribeToggle: () => void;

  // Speech
  isSpeaking: boolean;
  onCancelSpeech: () => void;

  // Model + voice — surfaced together via PresetMenu.
  aiModel: string;
  ttsProvider: string;
  ttsVoice: string;
  onSelectPreset: (presetId: string) => void;
  onSelectModel: (modelId: string) => void;
  onSelectVoice: (voiceId: string) => void;

  // Settings
  onOpenSettings: () => void;

  // Sessions
  onSaveSession: () => void;
  onOpenSessions: () => void;

  // Audio visualization
  audioLevelRef: React.MutableRefObject<number>;

  // Voice status
  voiceStatus: 'idle' | 'listening' | 'processing' | 'speaking';
  interimResult?: string;

  // Context usage (optional - only shown when available)
  contextUsage?: {
    usagePercent: number
    totalUsed: number
    contextWindow: number
  } | null;

  // Disable model changes
  conversationStarted?: boolean;

  // User / billing (from NavBar consolidation)
  user?: AuthUser | null;
  totalAvailable?: number;
  creditsLoading?: boolean;
  onLogin?: () => void;
  onAccount?: () => void;
  compact?: boolean;
  extraActions?: React.ReactNode;
  streamTextRef?: React.MutableRefObject<string>;
}

export const TopBar: React.FC<TopBarProps> = React.memo(({
  started,
  onStartStop,
  transcribe,
  onTranscribeToggle,
  isSpeaking,
  onCancelSpeech,
  aiModel,
  ttsProvider,
  ttsVoice,
  onSelectPreset,
  onSelectModel,
  onSelectVoice,
  onOpenSettings,
  onSaveSession,
  onOpenSessions,
  audioLevelRef,
  voiceStatus,
  interimResult,
  contextUsage,
  conversationStarted = false,
  user,
  totalAvailable,
  creditsLoading = false,
  onLogin,
  onAccount,
  compact = false,
  extraActions,
  streamTextRef,
}) => {
  return (
    <AppHeader
      started={started}
      onStartStop={onStartStop}
      transcribe={transcribe}
      onTranscribeToggle={onTranscribeToggle}
      isSpeaking={isSpeaking}
      onCancelSpeech={onCancelSpeech}
      aiModel={aiModel}
      ttsProvider={ttsProvider}
      ttsVoice={ttsVoice}
      onSelectPreset={onSelectPreset}
      onSelectModel={onSelectModel}
      onSelectVoice={onSelectVoice}
      onOpenSettings={onOpenSettings}
      onSaveSession={onSaveSession}
      onOpenSessions={onOpenSessions}
      audioLevelRef={audioLevelRef}
      voiceStatus={voiceStatus}
      interimResult={interimResult}
      contextUsage={contextUsage}
      conversationStarted={conversationStarted}
      user={user}
      totalAvailable={totalAvailable}
      creditsLoading={creditsLoading}
      onLogin={onLogin}
      onAccount={onAccount}
      compact={compact}
      extraActions={extraActions}
      streamTextRef={streamTextRef}
    />
  );
});
