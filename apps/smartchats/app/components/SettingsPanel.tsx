'use client';

import React, { useState, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Drawer } from '../ui/Drawer';
import { Switch } from '../ui/Switch';
import { Slider } from '../ui/Slider';
import { Select } from '../ui/Select';
import { VADMonitor } from '@lab-components/tivi/VADMonitor';
import { CalibrationPanel } from '@lab-components/tivi/CalibrationPanel';
import { VoiceSelector } from '@lab-components/tivi/VoiceSelector';
import type { UseTiviReturn } from '@lab-components/tivi/lib';
import type { TiviSettings } from '@lab-components/tivi/lib/settings';

import { MODEL_REGISTRY } from 'cortex';

function getModelRegistry(): Record<string, any> {
  return MODEL_REGISTRY ?? {};
}
import { FieldGroup } from '../ui/recipes/FieldGroup';
import { SettingsRow } from '../ui/recipes/SettingsRow';
import type { VoiceFeedbackVariant } from '../types/mobileVoice';
import { voiceFeedbackVariantOptions } from '../types/mobileVoice';

const VoiceSelectorToggle: React.FC = () => {
  const [showVoices, setShowVoices] = useState(false);
  return (
    <div className="mt-3">
      <button
        className="status-focused w-full rounded-[12px] border border-[var(--sc-separator)] px-3 py-2 text-sm font-medium text-sc-text transition-colors hover:bg-[var(--sc-surface-tertiary)]"
        onClick={() => setShowVoices(prev => !prev)}
      >
        {showVoices ? 'Hide Voice Selection' : 'Select Voice'}
      </button>
      {showVoices && (
        <div className="mt-2 overflow-hidden rounded-[18px] border border-[var(--sc-separator)] bg-[var(--sc-surface-tertiary)] p-3">
          <VoiceSelector provider="openai" backend="firebase" model="gpt-4o-mini-tts" />
        </div>
      )}
    </div>
  );
};

interface WidgetConfig {
  id: string;
  name: string;
  visible: boolean;
  order: number;
}

interface SettingsPanelProps {
  widgets: WidgetConfig[];
  toggleWidget: (id: string) => void;
  onApplyPreset?: (preset: string) => void;
  onResetLayout?: () => void;
  open: boolean;
  onClose: () => void;
  tiviParams?: TiviSettings;
  onTiviParamsChange?: (params: Partial<TiviSettings>) => void;
  tivi?: UseTiviReturn;
  speechProbRef?: React.MutableRefObject<number>;
  audioLevelRef?: React.MutableRefObject<number>;
  speechCooldownMs?: number;
  onSpeechCooldownChange?: (ms: number) => void;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  isListening?: boolean;
  // Appearance
  designPackId?: string;
  onDesignPackChange?: (id: string) => void;
  availableDesignPacks?: { id: string; name: string }[];
  activeShell?: string;
  onShellChange?: (id: string) => void;
  availableShells?: { id: string; name: string }[];
  colorMode?: 'dark' | 'light';
  onColorModeToggle?: () => void;
  voiceFeedbackVariant?: VoiceFeedbackVariant;
  onVoiceFeedbackVariantChange?: (variant: VoiceFeedbackVariant) => void;
  /** 'drawer' (default) renders in a side Drawer; 'fullscreen' renders as a full-page overlay with back button */
  variant?: 'drawer' | 'fullscreen';
  // Model selection
  aiModel?: string;
  onModelChange?: (model: string) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = React.memo(({
  widgets,
  toggleWidget,
  onApplyPreset,
  onResetLayout,
  open,
  onClose,
  tiviParams,
  onTiviParamsChange,
  tivi,
  speechProbRef,
  audioLevelRef,
  speechCooldownMs,
  onSpeechCooldownChange,
  playbackRate,
  onPlaybackRateChange,
  isListening = false,
  designPackId,
  onDesignPackChange,
  availableDesignPacks,
  activeShell,
  onShellChange,
  availableShells,
  colorMode,
  onColorModeToggle,
  voiceFeedbackVariant,
  onVoiceFeedbackVariantChange,
  variant = 'drawer',
  aiModel,
  onModelChange,
}) => {
  // Filter shell options: only show desktop-default, desktop-focus, claude-mobile-v2 (renamed "Mobile")
  const filteredShells = useMemo(() => {
    if (!availableShells) return undefined;
    const allowed = ['desktop-default', 'desktop-focus', 'claude-mobile-v2'];
    return availableShells
      .filter(s => allowed.includes(s.id))
      .map(s => s.id === 'claude-mobile-v2' ? { ...s, name: 'Mobile' } : s);
  }, [availableShells]);
  const modelOptions = useMemo(() =>
    Object.keys(getModelRegistry()).map(key => ({ value: key, label: key })),
  []);
  const settingsContent = (
    <>

      {/* Model Selection */}
      {aiModel && onModelChange && modelOptions.length > 0 && (
        <>
          <FieldGroup label="Model" className="mb-4">
            <SettingsRow label="AI Model">
              <div className="w-full sm:w-[220px]">
                <Select
                  value={aiModel}
                  onChange={onModelChange}
                  options={modelOptions}
                  aria-label="AI Model"
                />
              </div>
            </SettingsRow>
          </FieldGroup>
          <hr className="surface-divider my-4" />
        </>
      )}

      {/* Appearance Section */}
      {(availableDesignPacks || onColorModeToggle) && (
        <>
          <FieldGroup
            label="Appearance"
            className="mb-4"
          >

            {/* Design Pack Selector */}
            {availableDesignPacks && onDesignPackChange && designPackId !== undefined && (
              <SettingsRow
                label="Design Pack"
                description="Switch the active visual identity without changing application structure."
              >
                <div className="w-full sm:w-[220px]">
                  <Select
                    value={designPackId}
                    onChange={onDesignPackChange}
                    options={availableDesignPacks.map(dp => ({
                      value: dp.id,
                      label: dp.name,
                    }))}
                    aria-label="Design Pack"
                  />
                </div>
              </SettingsRow>
            )}

            {/* Shell Layout Selector */}
            {filteredShells && onShellChange && activeShell !== undefined && (
              <SettingsRow
                label="Layout"
                className="mt-3"
              >
                <div className="w-full sm:w-[220px]">
                  <Select
                    value={activeShell}
                    onChange={onShellChange}
                    options={filteredShells.map(s => ({
                      value: s.id,
                      label: s.name,
                    }))}
                    aria-label="Layout"
                  />
                </div>
              </SettingsRow>
            )}

            {voiceFeedbackVariant && onVoiceFeedbackVariantChange && (
              <SettingsRow
                label="Voice Feedback"
                description="Swap the live voice indicator style."
                className="mt-3"
              >
                <div className="w-full sm:w-[220px]">
                  <Select
                    value={voiceFeedbackVariant}
                    onChange={(value) => onVoiceFeedbackVariantChange(value as VoiceFeedbackVariant)}
                    options={voiceFeedbackVariantOptions}
                    aria-label="Voice Feedback Style"
                  />
                </div>
              </SettingsRow>
            )}

            {/* Dark/Light Mode Toggle */}
            {colorMode && onColorModeToggle && (
              <SettingsRow
                label="Dark Mode"
                className="mt-3"
              >
                <Switch
                  checked={colorMode === 'dark'}
                  onChange={() => onColorModeToggle()}
                  size="sm"
                />
              </SettingsRow>
            )}
          </FieldGroup>

          <hr className="surface-divider my-4" />
        </>
      )}

      {/* Voice Selection */}
      <FieldGroup
        label="Voice Selection"
        description="Choose which voice the assistant speaks with."
        className="mb-4"
      >
        <VoiceSelectorToggle />

        {tiviParams && onTiviParamsChange && (
          <div className="mt-3">
            <Select
              value={tiviParams.language}
              onChange={(value) => onTiviParamsChange({ language: value })}
              disabled={isListening}
              label="Recognition Language"
              options={[
                { value: 'en-US', label: 'English (US)' },
                { value: 'en-GB', label: 'English (UK)' },
                { value: 'es-ES', label: 'Spanish' },
                { value: 'fr-FR', label: 'French' },
                { value: 'de-DE', label: 'German' },
                { value: 'it-IT', label: 'Italian' },
                { value: 'pt-BR', label: 'Portuguese (Brazil)' },
                { value: 'ja-JP', label: 'Japanese' },
                { value: 'zh-CN', label: 'Chinese (Simplified)' },
                { value: 'ko-KR', label: 'Korean' },
              ]}
            />
          </div>
        )}
      </FieldGroup>

      <hr className="surface-divider my-4" />

      {tiviParams && onTiviParamsChange && (
        <FieldGroup
          label="Voice Recognition"
          description="Control the voice detection thresholds and runtime behavior without leaving the shared settings surface."
          className="mb-4"
        >

          {isListening && (
            <span className="text-xs text-sc-warning block mb-3">
              Stop listening to change voice settings
            </span>
          )}

          {/* VADMonitor - only runs when drawer is open */}
          {speechProbRef && (
            <div className="my-3 overflow-hidden rounded-[18px] border border-[var(--sc-separator)] bg-[var(--sc-surface-tertiary)] p-3">
              <VADMonitor
                speechProbRef={speechProbRef}
                audioLevelRef={audioLevelRef}
                threshold={tiviParams.positiveSpeechThreshold}
                powerThreshold={tiviParams.mode === 'responsive' ? tiviParams.powerThreshold : undefined}
                minSpeechStartMs={tiviParams.minSpeechStartMs}
                paused={!open}
                width={300}
                height={60}
              />
            </div>
          )}

          {/* Calibration */}
          {tivi && onTiviParamsChange && (
            <div className="mt-3 mb-4 overflow-x-auto rounded-[18px] border border-[var(--sc-separator)] bg-[var(--sc-surface-tertiary)] p-3">
              <CalibrationPanel
                tivi={tivi}
                vadParams={tiviParams}
                updateVadParam={(key, value) => onTiviParamsChange({ [key]: value })}
                disabled={tivi.isSpeaking}
              />
            </div>
          )}

          {/* Recognition Mode */}
          <div className="mt-3">
            <Select
              value={tiviParams.mode}
              onChange={(value) => onTiviParamsChange({ mode: value as TiviSettings['mode'] })}
              disabled={isListening}
              label="Recognition Mode"
              options={[
                { value: 'guarded', label: 'Guarded (VAD-triggered)' },
                { value: 'responsive', label: 'Responsive (power-triggered)' },
                { value: 'continuous', label: 'Continuous' },
              ]}
            />
          </div>

          {/* Enable Voice Interruption Toggle */}
          <div className="mt-3">
            <Switch
              size="sm"
              checked={tiviParams.enableInterruption}
              onChange={(checked) => onTiviParamsChange({ enableInterruption: checked })}
              disabled={isListening}
              label="Enable Voice Interruption"
            />
          </div>

          {/* Power Threshold - only show for responsive mode */}
          {tiviParams.mode === 'responsive' && (
            <div className="mt-3">
              <Slider
                value={tiviParams.powerThreshold}
                min={0.001}
                max={0.1}
                step={0.001}
                onChange={(value) => onTiviParamsChange({ powerThreshold: value })}
                disabled={isListening}
                label={`Power Threshold: ${tiviParams.powerThreshold.toFixed(3)}`}
              />
            </div>
          )}

          {/* Positive Speech Threshold */}
          <div className="mt-3">
            <Slider
              value={tiviParams.positiveSpeechThreshold}
              min={0}
              max={1}
              step={0.05}
              onChange={(value) => onTiviParamsChange({ positiveSpeechThreshold: value })}
              disabled={isListening}
              label={`Speech Detection Threshold: ${tiviParams.positiveSpeechThreshold.toFixed(2)}`}
            />
          </div>

          {/* Negative Speech Threshold */}
          <div className="mt-3">
            <Slider
              value={tiviParams.negativeSpeechThreshold}
              min={0}
              max={1}
              step={0.05}
              onChange={(value) => onTiviParamsChange({ negativeSpeechThreshold: value })}
              disabled={isListening}
              label={`Silence Detection Threshold: ${tiviParams.negativeSpeechThreshold.toFixed(2)}`}
            />
          </div>

          {/* Min Speech Start Duration */}
          <div className="mt-3">
            <span className="text-xs text-sc-text-muted block mb-1">
              Min Speech Start (ms)
            </span>
            <input
              type="number"
              value={tiviParams.minSpeechStartMs}
              onChange={(e) =>
                onTiviParamsChange({ minSpeechStartMs: parseInt(e.target.value) || 150 })
              }
              disabled={isListening}
              min={32}
              max={500}
              step={32}
              className="field-base status-focused-field status-disabled w-full rounded-[12px] px-3 py-1.5 text-sm text-sc-text outline-none"
            />
          </div>

          {/* Speech Cooldown */}
          {speechCooldownMs !== undefined && onSpeechCooldownChange && (
            <div className="mt-3">
              <Slider
                value={speechCooldownMs}
                min={0}
                max={5000}
                step={250}
                onChange={onSpeechCooldownChange}
                disabled={isListening}
                label={`Speech Cooldown: ${(speechCooldownMs / 1000).toFixed(1)}s`}
              />
              <span className="text-xs text-sc-text-muted block mt-1">
                Ignore speech within this time of last utterance
              </span>
            </div>
          )}

          {/* Playback Speed */}
          {playbackRate !== undefined && onPlaybackRateChange && (
            <div className="mt-3">
              <Slider
                value={playbackRate}
                min={0.5}
                max={2.0}
                step={0.1}
                onChange={onPlaybackRateChange}
                disabled={isListening}
                label={`Playback Speed: ${playbackRate.toFixed(1)}x`}
              />
            </div>
          )}

          {/* Verbose Logging */}
          <div className="mt-3">
            <Switch
              size="sm"
              checked={tiviParams.verbose}
              onChange={(checked) => onTiviParamsChange({ verbose: checked })}
              disabled={isListening}
              label="Verbose Logging"
            />
          </div>

        </FieldGroup>
      )}

      <hr className="surface-divider my-4" />

      {/* Widget Toggles — hidden on mobile and fullscreen variant (irrelevant for fixed mobile shell layout) */}
      {variant !== 'fullscreen' && (
        <div className="hidden md:block">
          <FieldGroup
            label="Visible Widgets"
            description="Widget visibility stays flexible, but these controls now use the same row pattern as the rest of settings."
            className="mb-4"
          >
            <div className="flex flex-col gap-2 mt-3">
              {widgets.map(widget => (
                <SettingsRow
                  key={widget.id}
                  label={widget.name}
                >
                  <Switch
                    size="sm"
                    checked={widget.visible}
                    onChange={() => toggleWidget(widget.id)}
                    aria-label={`Toggle ${widget.name}`}
                  />
                </SettingsRow>
              ))}
            </div>
          </FieldGroup>
        </div>
      )}

      {variant !== 'fullscreen' && onResetLayout && (
        <div className="hidden md:block">
          <hr className="surface-divider my-4" />

          {/* Reset Button */}
          <button
            className="status-focused w-full rounded-[12px] border border-sc-danger/50 px-3 py-2 text-sm font-medium text-sc-danger transition-colors hover:bg-sc-danger/10"
            onClick={onResetLayout}
          >
            Reset Layout to Default
          </button>
        </div>
      )}
    </>
  );

  // ── Fullscreen variant: renders as its own page with back button ──
  if (variant === 'fullscreen') {
    if (!open) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col bg-[var(--sc-background)]"
        style={{ overscrollBehavior: 'contain', animation: 'sc-slide-in-right 250ms ease-out' }}
      >
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--sc-separator)] bg-[color-mix(in_srgb,var(--sc-background)_85%,transparent)] px-4 py-3 backdrop-blur-xl">
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-sc-text transition-colors hover:bg-[var(--sc-surface-secondary)]"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-semibold text-sc-text">Settings</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          {settingsContent}
        </div>
      </div>
    );
  }

  // ── Drawer variant (default) ──
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      width={350}
      title="Settings"
    >
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-sc-text">
          Settings
        </h3>
        <p className="mt-1 text-sm text-sc-text-muted">
          Tune appearance, voice behavior, and workspace density from a single shared control surface.
        </p>
      </div>
      {settingsContent}
    </Drawer>
  );
});
