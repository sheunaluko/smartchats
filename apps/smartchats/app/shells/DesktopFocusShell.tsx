'use client';

/**
 * DesktopFocusShell — conversation-first layout with collapsible tool sidebar.
 *
 * Explicit variant (composition patterns: patterns-explicit-variants).
 * Main area: full-height conversation (voice status + chat + input).
 * Right sidebar: collapsible panel with widget list.
 * Good for: focused conversations, presentations, simple tasks.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { PanelRightOpen, PanelRightClose, ChevronDown, ChevronRight } from 'lucide-react';
import type { ShellProps } from '../../core/types/shell';

import { AccountPanel } from '../components/AccountPanel';
import { SettingsPanel } from '../components/SettingsPanel';
import { SessionBrowser } from '../components/SessionBrowser';
import { VoiceStatusIndicator } from '../components/VoiceStatusIndicator';
import { renderWidget } from '../components/FullscreenWidget';
import { Tooltip } from '../ui/Tooltip';
import { ToolbarButton } from '../ui/recipes/ToolbarButton';
import { TopBar } from '../components/TopBar';
import { SurfacePanel } from '../ui/recipes';

export function DesktopFocusShell({ voice, ui, auth, settings, widgetConfig, widgetProps, actions, meta }: ShellProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedWidget, setExpandedWidget] = useState<string | null>('chat');

  const toggleSidebar = useCallback(() => setSidebarOpen(p => !p), []);

  // Widgets available for the sidebar
  const sidebarWidgets = useMemo(() =>
    widgetConfig.visibleWidgets.filter((w: any) => w.id !== 'chatInput'),
    [widgetConfig.visibleWidgets]
  );

  return (
    <div className="h-screen flex flex-col bg-[var(--sc-background)] overflow-hidden">
      <TopBar
        compact
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
        extraActions={(
          <Tooltip content={sidebarOpen ? 'Hide tools' : 'Show tools'}>
            <ToolbarButton onClick={toggleSidebar} aria-label={sidebarOpen ? 'Hide tools' : 'Show tools'}>
              {sidebarOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            </ToolbarButton>
          </Tooltip>
        )}
      />

      {/* ── Main Content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Conversation Area (always visible, takes remaining space) */}
        <div className="flex-1 flex flex-col min-w-0">
          {voice.started && (
            <div className="border-b border-[var(--sc-separator)] bg-[var(--sc-surface-secondary)] px-4 py-2">
              <VoiceStatusIndicator
                status={voice.voiceStatus}
                interimResult={voice.interimResult}
                visible
                inline
              />
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <div className="h-full flex flex-col p-4 gap-3 overflow-y-auto scrollbar-thin">
              <div className="flex-1 overflow-y-auto scrollbar-hide">
                {renderWidget('chat', widgetProps)}
              </div>
              <div className="shrink-0">
                {renderWidget('chatInput', widgetProps)}
              </div>
            </div>
          </div>
        </div>

        {/* Tool Sidebar (collapsible) */}
        {sidebarOpen && (
          <div className="flex w-[380px] shrink-0 flex-col overflow-hidden border-l border-[var(--sc-separator)] bg-[var(--sc-surface-secondary)]">
            <div className="surface-header px-3 py-2">
              <h3 className="text-xs font-semibold text-sc-text-muted uppercase tracking-wider">Tools</h3>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
              {sidebarWidgets.map((widget: any) => (
                <SurfacePanel key={widget.id} variant="tertiary">
                  <button
                    onClick={() => setExpandedWidget(expandedWidget === widget.id ? null : widget.id)}
                    className="status-focused flex w-full items-center justify-between px-3 py-3 text-sm text-sc-text transition-colors hover:bg-[var(--sc-default-hover)]"
                  >
                    <span className="font-medium">{widget.name}</span>
                    {expandedWidget === widget.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {expandedWidget === widget.id && (
                    <div className="max-h-[400px] overflow-y-auto border-t border-[var(--sc-separator)] px-2 pb-2 pt-2 scrollbar-thin">
                      {renderWidget(widget.id, widgetProps)}
                    </div>
                  )}
                </SurfacePanel>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Drawers */}
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
      <AccountPanel open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}
