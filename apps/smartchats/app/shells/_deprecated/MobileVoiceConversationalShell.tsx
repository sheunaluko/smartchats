'use client';

import React, { useMemo, useState } from 'react';
import type { ShellProps } from '../../core/types/shell';
import type { MobileVoiceState, MobileVoiceViewModel } from '../types/mobileVoice';
import { SessionBrowser } from '../components/SessionBrowser';
import { SettingsPanel } from '../components/SettingsPanel';
import { Chip } from '../ui/Chip';
import {
  ActionRail,
  AssistantMoment,
  FallbackComposer,
  InterruptBar,
  SessionMiniHeader,
  TranscriptLine,
  VoiceStage,
  VoiceStatus,
} from '../ui/recipes';

function deriveState(args: {
  started: boolean;
  voiceStatus: 'idle' | 'listening' | 'processing' | 'speaking';
  executionError?: string;
}): MobileVoiceState {
  if (args.executionError) return 'error';
  if (!args.started && args.voiceStatus === 'idle') return 'idle';
  if (args.voiceStatus === 'listening') return 'listening';
  if (args.voiceStatus === 'processing') return 'processing';
  if (args.voiceStatus === 'speaking') return 'speaking';
  return 'ready';
}

export function MobileVoiceConversationalShell({ voice, ui, settings, widgetConfig, widgetProps, actions, meta }: ShellProps) {
  const [composerOpen, setComposerOpen] = useState(false);

  const lastUserMessage = useMemo(() => {
    return [...widgetProps.chatHistory].reverse().find((message) => message.role === 'user')?.content || '';
  }, [widgetProps.chatHistory]);

  const vm: MobileVoiceViewModel = useMemo(() => {
    const assistantMessage = widgetProps.chatHistory.length > 0
      ? widgetProps.chatHistory[widgetProps.chatHistory.length - 1]
      : null;
    const state = deriveState({
      started: voice.started,
      voiceStatus: voice.voiceStatus,
      executionError: widgetProps.executionError,
    });

    return {
      state,
      interimTranscript: state === 'listening' ? voice.interimResult : '',
      finalTranscript: state !== 'listening' ? lastUserMessage : '',
      assistantText: assistantMessage?.role === 'assistant' ? assistantMessage.content || '' : '',
      moments: [],
      canInterrupt: state === 'speaking' || state === 'listening' || state === 'processing',
      canType: true,
      isConnected: true,
      level: state === 'listening' ? 0.9 : state === 'speaking' ? 0.6 : state === 'processing' ? 0.45 : 0.18,
    };
  }, [
    lastUserMessage,
    voice.started,
    voice.voiceStatus,
    voice.interimResult,
    widgetProps.executionError,
    widgetProps.chatHistory,
  ]);

  const activityChips = [
    vm.state === 'processing' ? { label: 'Thinking', variant: 'warning' as const } : null,
    widgetProps.functionCalls.length > 0 ? { label: `Tool ${widgetProps.functionCalls[widgetProps.functionCalls.length - 1].name}`, variant: 'primary' as const } : null,
    widgetProps.currentExecution ? { label: 'Running code', variant: 'success' as const } : null,
  ].filter(Boolean) as Array<{ label: string; variant: 'warning' | 'primary' | 'success' }>;

  return (
    <div className="flex min-h-dvh flex-col overflow-hidden bg-[var(--sc-background)]">
      <SessionMiniHeader title="SmartChats.AI" onSettings={actions.onOpenSettings} />

      <main className="flex flex-1 flex-col px-4 pb-4">
        <div className="mx-auto flex w-full max-w-[28rem] flex-1 flex-col justify-center gap-5">
          <VoiceStage
            state={vm.state}
            level={vm.level}
            variant="orb"
            audioLevelRef={voice.audioLevelRef}
            onActivate={actions.onStartStop}
          />
          <VoiceStatus state={vm.state} />

          <div className="flex min-h-[9rem] flex-col gap-3">
            <TranscriptLine text={vm.interimTranscript} variant="interim" />
            <TranscriptLine text={vm.finalTranscript} variant="final" />
            {activityChips.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {activityChips.map((chip) => (
                  <Chip key={chip.label} label={chip.label} variant={chip.variant} className="animate-sc-slide-in-up" />
                ))}
              </div>
            )}
            <AssistantMoment text={vm.assistantText} />
          </div>
        </div>
      </main>

      <InterruptBar
        visible={vm.canInterrupt}
        onInterrupt={actions.onCancelSpeech}
        onStop={() => {
          actions.onCancelSpeech();
          actions.onStartStop();
        }}
      />
      <ActionRail onKeyboard={() => setComposerOpen((value) => !value)} />
      <FallbackComposer
        open={composerOpen}
        value={actions.chatInput}
        onChange={actions.setChatInput}
        onSend={actions.handleChatSend}
        onKeyDown={actions.handleChatKeyPress}
      />

      <SettingsPanel
        widgets={widgetConfig.widgets as any}
        toggleWidget={actions.toggleWidget}
        onApplyPreset={actions.applyPreset}
        onResetLayout={actions.resetLayout}
        open={ui.settingsOpen}
        onClose={actions.onCloseSettings}
        tiviParams={meta.tiviSettings}
        onTiviParamsChange={meta.updateTiviSettings}
        tivi={meta.tivi}
        speechProbRef={voice.speechProbRef}
        audioLevelRef={voice.audioLevelRef}
        speechCooldownMs={settings.speechCooldownMs}
        onSpeechCooldownChange={actions.onSpeechCooldownChange}
        playbackRate={settings.playbackRate}
        onPlaybackRateChange={actions.onPlaybackRateChange}
        isListening={voice.isListening}
        designPackId={settings.designPackId}
        onDesignPackChange={actions.onDesignPackChange}
        availableDesignPacks={meta.availableDesignPacks}
        colorMode={settings.colorMode}
        onColorModeToggle={actions.onColorModeToggle}
        activeShell={meta.activeShell}
        onShellChange={meta.onShellChange}
        availableShells={meta.availableShells}
      />

      <SessionBrowser
        open={ui.sessionsOpen}
        onClose={actions.onCloseSessions}
        listSessions={actions.listSessions}
        loadSession={actions.loadSession}
      />
    </div>
  );
}
