'use client';

import React, { useMemo, useState } from 'react';
import type { ShellProps } from '../../core/types/shell';
import type { MobileVoiceState } from '../types/mobileVoice';
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
  SurfacePanel,
  TranscriptLine,
  VoiceStage,
  VoiceStatus,
} from '../ui/recipes';
import { Brain, CheckCircle2, Gauge, Terminal, Wrench, XCircle } from 'lucide-react';

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
  if (result == null) return 'Result ready.';
  if (typeof result === 'string') return result;
  if (typeof result === 'number' || typeof result === 'boolean') return String(result);
  if (Array.isArray(result)) return `${result.length} item${result.length === 1 ? '' : 's'} returned`;
  if (typeof result === 'object') return 'Structured result available';
  return 'Result available';
}

function buildActiveMoment(args: {
  state: MobileVoiceState;
  thoughtHistory: string[];
  executionStatus: string;
  executionResult: unknown;
  executionError?: string;
  executionDuration?: number | null;
  functionCalls: Array<{ name: string; status?: string; duration?: number | null }>;
  processes: Array<{ name: string; status?: string; exitCode?: number | null; elapsed?: number | null }>;
  contextUsage: { usagePercent?: number } | null | undefined;
}) {
  const latestProcess = args.processes.length > 0 ? args.processes[args.processes.length - 1] : null;
  const latestCall = args.functionCalls.length > 0 ? args.functionCalls[args.functionCalls.length - 1] : null;
  const latestThought = args.thoughtHistory.length > 0 ? args.thoughtHistory[args.thoughtHistory.length - 1] : '';
  const contextPercent = Math.round((args.contextUsage?.usagePercent ?? 0) * 100);


  if (args.executionStatus === 'running') {
    return {
      eyebrow: 'Execution',
      title: 'Running code',
      body: latestCall ? `Using ${latestCall.name} while preparing the next step.` : 'The assistant is executing a tool-assisted action.',
      tone: 'primary' as const,
      icon: Wrench,
      meta: latestCall?.duration ? `${latestCall.duration}ms` : 'Live',
    };
  }

  if (args.executionStatus === 'error') {
    return {
      eyebrow: 'Execution',
      title: 'Execution failed',
      body: args.executionError || 'The last tool step failed.',
      tone: 'danger' as const,
      icon: XCircle,
      meta: args.executionDuration ? `${args.executionDuration}ms` : undefined,
    };
  }

  if (args.executionStatus === 'success') {
    return {
      eyebrow: 'Execution',
      title: 'Execution complete',
      body: summarizeResult(args.executionResult),
      tone: 'success' as const,
      icon: CheckCircle2,
      meta: args.executionDuration ? `${args.executionDuration}ms` : undefined,
    };
  }

  if (latestProcess && latestProcess.status && latestProcess.status !== 'completed') {
    return {
      eyebrow: 'Process',
      title: latestProcess.name,
      body: 'A background process is still running.',
      tone: 'default' as const,
      icon: Terminal,
      meta: latestProcess.elapsed ? `${latestProcess.elapsed}ms` : 'Active',
    };
  }

  if (args.state === 'processing') {
    return {
      eyebrow: 'Reasoning',
      title: 'Working through your request',
      body: latestThought ? latestThought.slice(0, 120) : 'Comparing options, selecting tools, and shaping the response.',
      tone: 'warning' as const,
      icon: Brain,
      meta: contextPercent > 0 ? `Context ${contextPercent}%` : 'Live analysis',
    };
  }

  if (args.state === 'speaking') {
    return {
      eyebrow: 'Response',
      title: 'Delivering the answer',
      body: 'Voice playback is active while the visual response settles in.',
      tone: 'primary' as const,
      icon: CheckCircle2,
      meta: 'Speaking',
    };
  }

  if (contextPercent > 80) {
    return {
      eyebrow: 'Context',
      title: `Context at ${contextPercent}%`,
      body: 'The active context window is filling up.',
      tone: 'warning' as const,
      icon: Gauge,
      meta: 'Attention needed soon',
    };
  }

  return {
    eyebrow: 'Ready',
    title: 'Tap the orb to start',
    body: 'Ask naturally and SmartChats will listen, reason, act, and answer.',
    tone: 'default' as const,
    icon: Brain,
    meta: 'Voice first',
  };
}

export function ClaudeCodexShell({ voice, ui, settings, widgetConfig, widgetProps, actions, meta }: ShellProps) {
  const [composerOpen, setComposerOpen] = useState(false);

  const state = useMemo(() => deriveState({
    started: voice.started,
    voiceStatus: voice.voiceStatus,
    executionError: widgetProps.executionError,
  }), [voice.started, voice.voiceStatus, widgetProps.executionError]);

  const lastUserMessage = useMemo(() => {
    return [...widgetProps.chatHistory].reverse().find((message) => message.role === 'user')?.content || '';
  }, [widgetProps.chatHistory]);

  const assistantText = useMemo(() => {
    const latest = widgetProps.chatHistory.length > 0
      ? widgetProps.chatHistory[widgetProps.chatHistory.length - 1]
      : null;
    return latest?.role === 'assistant' ? latest.content || '' : '';
  }, [widgetProps.chatHistory]);

  const activeMoment = useMemo(() => buildActiveMoment({
    state,
    thoughtHistory: widgetProps.thoughtHistory,
    executionStatus: widgetProps.executionStatus,
    executionResult: widgetProps.executionResult,
    executionError: widgetProps.executionError,
    executionDuration: widgetProps.executionDuration,
    functionCalls: widgetProps.functionCalls,
    processes: widgetProps.processes,
    contextUsage: settings.contextUsage,
  }), [
    state,
    widgetProps.thoughtHistory,
    widgetProps.executionStatus,
    widgetProps.executionResult,
    widgetProps.executionError,
    widgetProps.executionDuration,
    widgetProps.functionCalls,
    widgetProps.processes,
    settings.contextUsage,
  ]);

  const chips = useMemo(() => {
    const contextPercent = Math.round((settings.contextUsage?.usagePercent ?? 0) * 100);
    const latestCall = widgetProps.functionCalls.length > 0 ? widgetProps.functionCalls[widgetProps.functionCalls.length - 1] : null;
    const activeProcessCount = widgetProps.processes.filter((proc) => proc.status && proc.status !== 'completed').length;

    return [
      contextPercent > 0 ? {
        label: `Ctx ${contextPercent}%`,
        variant: contextPercent > 80 ? 'warning' as const : 'default' as const,
      } : null,
      latestCall ? {
        label: latestCall.status === 'error' ? `${latestCall.name} failed` : `Tool ${latestCall.name}`,
        variant: latestCall.status === 'error' ? 'danger' as const : 'primary' as const,
      } : null,
      activeProcessCount > 0 ? {
        label: `${activeProcessCount} process${activeProcessCount === 1 ? '' : 'es'}`,
        variant: 'default' as const,
      } : null,
      widgetProps.executionStatus === 'running' ? {
        label: 'Executing',
        variant: 'success' as const,
      } : null,
    ].filter(Boolean) as Array<{ label: string; variant: 'default' | 'primary' | 'warning' | 'danger' | 'success' }>;
  }, [settings.contextUsage, widgetProps.functionCalls, widgetProps.processes, widgetProps.executionStatus]);

  const canInterrupt = state === 'speaking' || state === 'listening' || state === 'processing';
  const level = state === 'listening' ? 0.9 : state === 'speaking' ? 0.6 : state === 'processing' ? 0.45 : 0.18;
  const ActiveIcon = activeMoment.icon;

  return (
    <div className="flex min-h-dvh flex-col overflow-hidden bg-[var(--sc-background)]">
      <SessionMiniHeader title="SmartChats.AI" onSettings={actions.onOpenSettings} />

      <main className="flex flex-1 flex-col px-4 pb-4">
        <div className="mx-auto flex h-full w-full max-w-[28rem] flex-col">
          <section className="flex flex-none flex-col items-center pt-2">
            <div className="flex min-h-[24rem] w-full flex-col items-center justify-start">
              <VoiceStage
                state={state}
                level={level}
                variant="orb"
                audioLevelRef={voice.audioLevelRef}
                onActivate={actions.onStartStop}
              />
              <div className="mt-2">
                <VoiceStatus state={state} />
              </div>
              <div className="mt-4 w-full min-h-[7.5rem]">
                <DataCard
                  tone={activeMoment.tone}
                  className="min-h-[7.5rem]"
                  header={
                    <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-sc-text-muted">
                      <ActiveIcon size={12} />
                      {activeMoment.eyebrow}
                    </div>
                  }
                >
                  <div className="space-y-2">
                    <h2 className="text-sm font-semibold text-sc-text">{activeMoment.title}</h2>
                    <p className="text-sm leading-relaxed text-sc-text-muted">{activeMoment.body}</p>
                    {activeMoment.meta && (
                      <p className="text-xs text-sc-text-muted">{activeMoment.meta}</p>
                    )}
                  </div>
                </DataCard>
              </div>
            </div>
          </section>

          <section className="flex flex-1 flex-col justify-end pb-3">
            <div className="mx-auto flex min-h-[8.5rem] w-full max-w-[28rem] flex-col gap-3">
              <TranscriptLine text={state === 'listening' ? voice.interimResult : ''} variant="interim" />
              <TranscriptLine text={state !== 'listening' ? lastUserMessage : ''} variant="final" />
              <AssistantMoment text={assistantText} />
            </div>

            <SurfacePanel variant="secondary" className="mt-4 rounded-[18px] px-3 py-2">
              <div className="flex min-h-[2rem] flex-wrap items-center gap-2">
                {chips.length > 0 ? chips.map((chip) => (
                  <Chip key={chip.label} label={chip.label} variant={chip.variant} />
                )) : (
                  <span className="text-xs text-sc-text-muted">Live activity will settle here while the main stage stays clear.</span>
                )}
              </div>
            </SurfacePanel>
          </section>
        </div>
      </main>

      <InterruptBar
        visible={canInterrupt}
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
