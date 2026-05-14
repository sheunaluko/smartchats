'use client';

/**
 * MobileShell — chat-first layout with bottom navigation and stacked panels.
 *
 * Explicit variant (composition patterns: patterns-explicit-variants).
 * Main area: full-screen conversation.
 * Bottom tabs: Chat, Tools, Settings.
 * Widgets shown as full-width stacked cards (no drag/drop grid).
 * Good for: mobile browsers, touch devices, narrow viewports.
 */

import React, { useState, useMemo } from 'react';
import { MessageSquare, Mic, Square, Wrench, Settings as SettingsIcon, ChevronLeft } from 'lucide-react';
import type { ShellProps } from '../../core/types/shell';

import { ChatModeView } from '../components/ChatModeView';
import { VoiceStatusIndicator } from '../components/VoiceStatusIndicator';
import { SettingsPanel } from '../components/SettingsPanel';
import { SessionBrowser } from '../components/SessionBrowser';
import { renderWidget } from '../components/FullscreenWidget';
import { Chip } from '../ui/Chip';
import { Select } from '../ui/Select';
import AudioVisualization from '../components/AudioVisualization';
import { SurfacePanel } from '../ui/recipes';
import { MODEL_REGISTRY } from 'cortex';


type MobileTab = 'chat' | 'tools' | 'settings';

export function MobileShell({ voice, ui, auth, settings, widgetConfig, widgetProps, actions, meta }: ShellProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>('chat');
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const modelOptions = useMemo(() =>
    Object.entries(MODEL_REGISTRY).map(([id, info]: [string, any]) => ({
      value: id,
      label: info.display_name || id,
    })), []);

  const toolWidgets = useMemo(() =>
    widgetConfig.visibleWidgets.filter((w: any) => w.id !== 'chatInput' && w.id !== 'chat'),
    [widgetConfig.visibleWidgets]
  );

  return (
    <div className="h-dvh flex flex-col bg-[var(--sc-background)] overflow-hidden">
      {/* ── Compact Header ── */}
      <div className="surface-header flex items-center gap-2 px-3 py-2 shrink-0">
        {expandedTool ? (
          <>
            <button
              onClick={() => setExpandedTool(null)}
              className="p-1 rounded-sc-sm text-sc-text-muted hover:text-sc-text transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-sm font-medium text-sc-text flex-1">{expandedTool}</span>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold text-sc-text">SmartChats</span>
            <div className="flex-1" />

            {/* Voice toggle (voice mode) */}
            {activeTab === 'chat' && (
              <button
                onClick={actions.onStartStop}
                className={`status-focused flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium transition-all duration-sc-fast
                  ${voice.started
                    ? 'bg-sc-danger/20 text-sc-danger active:scale-[0.95]'
                    : 'bg-[var(--sc-accent-soft)] text-[var(--sc-accent-soft-foreground)] active:scale-[0.95]'}`}
              >
                {voice.started ? <Square size={12} /> : <Mic size={12} />}
                {voice.started ? 'Stop' : 'Voice'}
              </button>
            )}

            {/* Credits — hidden when backend has no billing capability */}
            {auth.totalAvailable !== undefined && auth.totalAvailable > 0 && (
              <Chip label={`${auth.totalAvailable.toLocaleString()}`} size="sm" variant="primary" />
            )}
          </>
        )}
      </div>

      {/* ── Voice Status Bar ── */}
      {voice.started && activeTab === 'chat' && (
        <div className="flex items-center gap-2 border-b border-[var(--sc-separator)] bg-[var(--sc-surface-secondary)] px-3 py-1.5">
          <div className="w-16 h-5 shrink-0">
            <AudioVisualization audioLevelRef={voice.audioLevelRef} width={64} height={20} />
          </div>
          <VoiceStatusIndicator
            status={voice.voiceStatus}
            interimResult={voice.interimResult}
            visible
            inline
          />
        </div>
      )}

      {/* ── Main Content Area ── */}
      <div className="flex-1 overflow-hidden">
        {/* Chat Tab */}
        {activeTab === 'chat' && (
          <div className="h-full">
            <ChatModeView
              chatHistory={widgetProps.chatHistory}
              chatInput={actions.chatInput}
              setChatInput={actions.setChatInput}
              isAiTyping={actions.isAiTyping}
              handleChatSend={actions.handleChatSend}
              handleChatKeyPress={actions.handleChatKeyPress}
              chatContainerRef={actions.chatContainerRef}
            />
          </div>
        )}

        {/* Tools Tab */}
        {activeTab === 'tools' && !expandedTool && (
          <div className="h-full overflow-y-auto scrollbar-thin p-3 space-y-3">
            <SurfacePanel variant="secondary" className="p-3">
              <Select
                value={settings.aiModel}
                onChange={(v) => actions.onModelChange(v)}
                options={modelOptions}
                label="Model"
                size="sm"
              />
            </SurfacePanel>
            {toolWidgets.map((widget: any) => (
              <SurfacePanel key={widget.id} variant="secondary" interactive>
                <button
                  onClick={() => setExpandedTool(widget.id)}
                  className="status-focused flex w-full items-center justify-between p-3 text-left active:scale-[0.98]"
                >
                  <span className="text-sm font-medium text-sc-text">{widget.name}</span>
                  <Wrench size={14} className="text-sc-text-muted" />
                </button>
              </SurfacePanel>
            ))}
          </div>
        )}

        {/* Expanded Tool View */}
        {activeTab === 'tools' && expandedTool && (
          <div className="h-full overflow-y-auto scrollbar-thin p-3">
            {renderWidget(expandedTool, widgetProps)}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="h-full overflow-y-auto scrollbar-thin p-4 space-y-4">
            <h2 className="text-lg font-semibold text-sc-text">Settings</h2>

            {/* Model */}
            <SurfacePanel variant="secondary" className="p-3">
              <Select
                value={settings.aiModel}
                onChange={(v) => actions.onModelChange(v)}
                options={modelOptions}
                label="AI Model"
              />
            </SurfacePanel>

            {/* Shell Layout */}
            <SurfacePanel variant="secondary" className="p-3">
              <Select
                value={meta.activeShell}
                onChange={(v) => meta.onShellChange(v)}
                options={meta.availableShells.map(s => ({ value: s.id, label: s.name }))}
                label="Shell Layout"
              />
            </SurfacePanel>

            {/* Design Pack */}
            <SurfacePanel variant="secondary" className="p-3">
              <Select
                value={settings.designPackId}
                onChange={(v) => actions.onDesignPackChange(v)}
                options={meta.availableDesignPacks.map(p => ({ value: p.id, label: p.name }))}
                label="Design Pack"
              />
            </SurfacePanel>

            {/* Dark/Light mode */}
            <SurfacePanel variant="secondary" className="flex items-center justify-between p-3">
              <span className="text-sm text-sc-text">Dark Mode</span>
              <button
                onClick={actions.onColorModeToggle}
                className={`status-focused rounded-[10px] px-3 py-1.5 text-xs font-medium transition-colors duration-sc-fast
                  ${settings.colorMode === 'dark' ? 'bg-sc-primary text-white' : 'bg-[var(--sc-default)] text-sc-text'}`}
              >
                {settings.colorMode === 'dark' ? 'Dark' : 'Light'}
              </button>
            </SurfacePanel>

            {/* Session actions */}
            <SurfacePanel variant="secondary" className="space-y-2 p-3">
              <button
                onClick={actions.onSaveSession}
                className="status-focused w-full rounded-[12px] bg-[var(--sc-accent-soft)] py-2.5 text-sm font-medium text-[var(--sc-accent-soft-foreground)] transition-colors active:scale-[0.98]"
              >
                Save Session
              </button>
              <button
                onClick={actions.onOpenSessions}
                className="status-focused w-full rounded-[12px] bg-[var(--sc-default)] py-2.5 text-sm font-medium text-sc-text transition-colors hover:bg-[var(--sc-default-hover)] active:scale-[0.98]"
              >
                Load Session
              </button>
            </SurfacePanel>

            {/* Auth */}
            {!auth.user && (
              <button
                onClick={actions.onLogin}
                className="status-focused w-full rounded-[12px] bg-[color-mix(in_srgb,var(--sc-accent)_14%,transparent)] py-2.5 text-sm font-medium text-sc-accent transition-colors hover:brightness-[0.98] active:scale-[0.98]"
              >
                Sign In
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom Navigation ── */}
      <nav className="flex items-center border-t border-[var(--sc-separator)] bg-[var(--sc-surface-secondary)] shrink-0 safe-area-bottom">
        {([
          { id: 'chat' as const, icon: MessageSquare, label: 'Chat' },
          { id: 'tools' as const, icon: Wrench, label: 'Tools' },
          { id: 'settings' as const, icon: SettingsIcon, label: 'Settings' },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setExpandedTool(null); }}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 pt-2.5 transition-colors duration-sc-fast
              ${activeTab === tab.id ? 'text-sc-primary' : 'text-sc-text-muted'}`}
          >
            <tab.icon size={20} />
            <span className="text-[0.65rem] font-medium">{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Session Browser drawer (still needed for load) */}
      <SessionBrowser
        open={ui.sessionsOpen}
        onClose={actions.onCloseSessions}
        listSessions={actions.listSessions}
        loadSession={actions.loadSession}
      />
    </div>
  );
}
