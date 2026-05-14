'use client';

/**
 * DesktopDefaultShell — the original SmartChats multi-widget workspace layout.
 *
 * This is an explicit variant (composition patterns: patterns-explicit-variants).
 * It composes TopBar + WidgetGrid + Drawers for desktop voice/chat workflows.
 * The host (app3) computes state; this shell only decides how to lay it out.
 */

import React, { useMemo, useState } from 'react';
import type { ShellProps } from '../../core/types/shell';

import { TopBar } from '../components/TopBar';
import { AccountPanel } from '../components/AccountPanel';
import { SettingsPanel } from '../components/SettingsPanel';
import { SessionBrowser } from '../components/SessionBrowser';
import { DraggableWidgetGrid } from '../components/DraggableWidgetGrid';
import { renderWidget, FullscreenWidget } from '../components/FullscreenWidget';
import { TourOverlay } from '../components/TourOverlay';

// Hoisted style constants (no new object refs per render)
const voiceModeContainerStyle: React.CSSProperties = {
  flexGrow: 1,
  flexDirection: 'column',
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: '5px',
};
const fullscreenContainerStyle: React.CSSProperties = { flexGrow: 1, width: '100%' };

export function DesktopDefaultShell({ voice, ui, auth, settings, widgetConfig, widgetProps, actions, meta }: ShellProps) {
  const [accountOpen, setAccountOpen] = useState(false);

  // Memoize widget grid to avoid re-renders when non-grid state changes
  const memoizedWidgetGrid = useMemo(() => (
    <DraggableWidgetGrid
      visibleWidgets={widgetConfig.visibleWidgets as any}
      initialLayout={widgetConfig.widgetLayout}
      onLayoutChange={actions.saveLayout}
      renderWidget={(widgetId: string) => renderWidget(widgetId, widgetProps)}
    />
  ), [widgetConfig.visibleWidgets, widgetConfig.widgetLayout, actions.saveLayout, widgetProps]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: '100vh' }}>
      {/* Top Bar */}
      <TopBar
        started={voice.started}
        onStartStop={actions.onStartStop}
        transcribe={voice.transcribe}
        onTranscribeToggle={actions.onTranscribeToggle}
        isSpeaking={voice.isSpeaking}
        onCancelSpeech={actions.onCancelSpeech}
        aiModel={settings.aiModel}
        onModelChange={actions.onModelChange}
        onOpenSettings={actions.onOpenSettings}
        onSaveSession={actions.onSaveSession}
        onOpenSessions={actions.onOpenSessions}
        audioLevelRef={voice.audioLevelRef}
        voiceStatus={voice.voiceStatus}
        interimResult={voice.interimResult}
        contextUsage={settings.contextUsage}
        conversationStarted={meta.conversationStarted}
        user={auth.user}
        totalAvailable={auth.totalAvailable}
        creditsLoading={auth.creditsLoading}
        onLogin={actions.onLogin}
        onAccount={() => setAccountOpen(true)}
        streamTextRef={meta.rawStreamRef}
      />

      {/* Settings Panel */}
      <SettingsPanel
        widgets={widgetConfig.widgets}
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

      {/* Session Browser */}
      <SessionBrowser
        open={ui.sessionsOpen}
        onClose={actions.onCloseSessions}
        listSessions={actions.listSessions}
        loadSession={actions.loadSession}
      />

      {/* Widget Grid */}
      <div style={voiceModeContainerStyle}>
        {ui.focusedWidget ? (
          <FullscreenWidget
            widgetId={ui.focusedWidget}
            widgetProps={widgetProps}
            onClose={actions.onCloseFocused}
          />
        ) : (
          <div className="flex flex-col items-start w-full pr-5">
            {memoizedWidgetGrid}
          </div>
        )}
      </div>

      <AccountPanel open={accountOpen} onClose={() => setAccountOpen(false)} />
      <TourOverlay />
    </div>
  );
}
