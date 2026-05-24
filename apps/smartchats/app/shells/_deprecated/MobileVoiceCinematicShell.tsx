'use client';

import React, { useMemo, useState } from 'react';
import type { ShellProps } from '../../core/types/shell';
import type { MobileVoiceState, MobileVoiceViewModel, VoiceMoment } from '../types/mobileVoice';
import { SessionBrowser } from '../components/SessionBrowser';
import { SettingsPanel } from '../components/SettingsPanel';
import { Chip } from '../ui/Chip';
import {
  ActionRail,
  AssistantMoment,
  DataCard,
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

function getHeadline(state: MobileVoiceState) {
  switch (state) {
    case 'listening':
      return { title: 'Capturing your request', body: 'Live speech is being turned into intent.', tone: 'primary' as const };
    case 'processing':
      return { title: 'Working through the request', body: 'The assistant is reasoning, selecting tools, and preparing the next move.', tone: 'warning' as const };
    case 'speaking':
      return { title: 'Delivering the answer', body: 'Voice playback is active while the visual response settles in.', tone: 'primary' as const };
    case 'error':
      return { title: 'Something went wrong', body: 'The assistant hit an error and needs another attempt.', tone: 'danger' as const };
    default:
      return { title: 'Ready when you are', body: 'Tap the orb to begin a new voice interaction.', tone: 'default' as const };
  }
}

export function MobileVoiceCinematicShell({ voice, ui, settings, widgetConfig, widgetProps, actions, meta }: ShellProps) {
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

    const moments: VoiceMoment[] = [];
    if (widgetProps.functionCalls.length > 0) {
      moments.push({
        id: 'tool-step',
        kind: 'action',
        title: widgetProps.functionCalls[widgetProps.functionCalls.length - 1].name,
        body: 'Tool step active',
      });
    }
    if (widgetProps.currentExecution) {
      moments.push({
        id: 'exec-step',
        kind: 'result',
        title: 'Execution',
        body: widgetProps.currentExecution.error ? 'Error' : 'Complete',
      });
    }

    return {
      state,
      interimTranscript: state === 'listening' ? voice.interimResult : '',
      finalTranscript: state !== 'listening' ? lastUserMessage : '',
      assistantText: assistantMessage?.role === 'assistant' ? assistantMessage.content || '' : '',
      moments,
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
    widgetProps.currentExecution,
    widgetProps.functionCalls,
  ]);

  const headline = getHeadline(vm.state);

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

          <DataCard
            tone={headline.tone}
            className="animate-sc-slide-in-up"
            header={<div className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-sc-text-muted">Current phase</div>}
          >
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-sc-text">{headline.title}</h2>
              <p className="text-sm leading-relaxed text-sc-text-muted">{headline.body}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Chip label={vm.state === 'processing' ? 'Thinking' : 'Live'} variant={headline.tone === 'warning' ? 'warning' : headline.tone === 'danger' ? 'danger' : 'primary'} />
                {vm.moments.map((moment) => (
                  <Chip key={moment.id} label={moment.title || 'Step'} variant="default" />
                ))}
              </div>
            </div>
          </DataCard>

          <div className="mx-auto flex min-h-[7rem] w-full max-w-[28rem] flex-col gap-3">
            <TranscriptLine text={vm.interimTranscript} variant="interim" />
            <TranscriptLine text={vm.finalTranscript} variant="final" />
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
