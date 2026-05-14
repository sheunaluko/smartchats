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
  FallbackComposer,
  InterruptBar,
  MetricRow,
  ResultCard,
  SessionMiniHeader,
  SurfacePanel,
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

function summarizeResult(result: unknown): string {
  if (result == null) return 'No structured result available yet.';
  if (typeof result === 'string') return result;
  if (typeof result === 'number' || typeof result === 'boolean') return String(result);
  if (Array.isArray(result)) return `${result.length} item${result.length === 1 ? '' : 's'} returned`;
  if (typeof result === 'object') return 'Structured result returned';
  return 'Result available';
}

export function MobileVoiceRibbonShell({ voice, ui, settings, widgetConfig, widgetProps, actions, meta }: ShellProps) {
  const [composerOpen, setComposerOpen] = useState(false);

  const lastUserMessage = useMemo(() => {
    return [...widgetProps.chatHistory].reverse().find((message) => message.role === 'user')?.content || '';
  }, [widgetProps.chatHistory]);

  const vm: MobileVoiceViewModel = useMemo(() => {
    const currentExecution = widgetProps.currentExecution;
    const assistantMessage = widgetProps.chatHistory.length > 0
      ? widgetProps.chatHistory[widgetProps.chatHistory.length - 1]
      : null;
    const state = deriveState({
      started: voice.started,
      voiceStatus: voice.voiceStatus,
      executionError: widgetProps.executionError,
    });

    const moments: VoiceMoment[] = [];
    if (currentExecution?.result !== undefined) {
      moments.push({
        id: `${currentExecution.executionId}-result`,
        kind: 'result',
        title: 'Latest Result',
        body: summarizeResult(currentExecution.result),
        meta: currentExecution.duration ? `${currentExecution.duration}ms` : undefined,
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
    widgetProps.currentExecution,
    widgetProps.executionError,
    widgetProps.chatHistory,
  ]);

  const contextPercent = Math.round((settings.contextUsage?.usagePercent ?? 0) * 100);
  const toolCount = widgetProps.functionCalls.length;
  const loopLabel = vm.state === 'processing' ? 'Active loop' : 'Idle';

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

          <SurfacePanel variant="secondary" className="rounded-[18px] px-4 py-3">
            <div className="mb-3 flex items-center gap-2">
              <Chip label={`Context ${contextPercent}%`} variant={contextPercent > 80 ? 'warning' : 'default'} />
              <Chip label={`${toolCount} tools`} variant={toolCount > 0 ? 'primary' : 'default'} />
              <Chip label={loopLabel} variant={vm.state === 'processing' ? 'warning' : 'default'} />
            </div>
            <div className="space-y-2">
              <MetricRow label="Context window" value={`${contextPercent}%`} tone={contextPercent > 80 ? 'warning' : 'default'} />
              <MetricRow label="Function calls" value={toolCount} tone={toolCount > 0 ? 'primary' : 'default'} />
              <MetricRow label="Execution" value={widgetProps.currentExecution ? 'Active' : 'Idle'} tone={widgetProps.currentExecution ? 'success' : 'default'} />
            </div>
          </SurfacePanel>

          <div className="mx-auto flex min-h-[8rem] w-full max-w-[28rem] flex-col gap-3">
            <TranscriptLine text={vm.interimTranscript} variant="interim" />
            <TranscriptLine text={vm.finalTranscript} variant="final" />
            <AssistantMoment text={vm.assistantText} />
            {vm.moments[0] && <ResultCard moment={vm.moments[0]} />}
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
