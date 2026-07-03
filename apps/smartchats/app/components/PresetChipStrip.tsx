'use client';

/**
 * PresetChipStrip
 *
 * Horizontal chip strip that surfaces the AGENT_PRESETS (defined in
 * cortex/src/presets.ts) as clickable pills in the top bar. Replaces
 * the old model-only dropdown — a preset atomically bundles LLM model +
 * TTS provider + TTS voice, which is what users actually care about
 * ("snappy" not "grok-4.20-non-reasoning + Azure Ava").
 *
 * A preset is "active" iff the current (aiModel, ttsProvider, ttsVoice)
 * triple matches its definition. If the triple was drifted (e.g. the
 * agent's set_voice tool changed the voice individually), no preset
 * matches — we render a compact "Custom" indicator and no chip glows.
 *
 * Fine-grained model / voice controls live in the settings drawer for
 * users who want to override individual axes. This strip is the
 * one-click "give me the right bundle for this workflow" affordance.
 */

import React from 'react';
import { AGENT_PRESETS, findMatchingPreset } from 'cortex';
import { Tooltip } from '../ui/Tooltip';

type PresetChipStripProps = {
    aiModel: string;
    ttsProvider: string;
    ttsVoice: string;
    onSelectPreset: (presetId: string) => void;
    /** Freeze the strip while a session is running — switching mid-session
     *  would swap adapters mid-stream. */
    disabled?: boolean;
    className?: string;
};

export const PresetChipStrip: React.FC<PresetChipStripProps> = React.memo(({
    aiModel,
    ttsProvider,
    ttsVoice,
    onSelectPreset,
    disabled = false,
    className = '',
}) => {
    const active = findMatchingPreset(aiModel, ttsProvider, ttsVoice);
    const activeId = active?.id ?? null;

    return (
        <div className={`flex items-center gap-1 ${className}`} role="radiogroup" aria-label="Agent preset">
            {AGENT_PRESETS.map((preset) => {
                const isActive = preset.id === activeId;
                return (
                    <Tooltip key={preset.id} content={preset.description}>
                        <button
                            type="button"
                            role="radio"
                            aria-checked={isActive}
                            disabled={disabled}
                            onClick={() => onSelectPreset(preset.id)}
                            className={`
                                inline-flex items-center rounded-full border font-medium text-xs px-2.5 py-1
                                transition-colors duration-150
                                ${isActive
                                    ? 'bg-[color-mix(in_srgb,var(--sc-primary)_18%,transparent)] text-sc-primary border-[color-mix(in_srgb,var(--sc-primary)_35%,transparent)]'
                                    : 'bg-[var(--sc-surface-secondary)] text-sc-text-muted border-transparent hover:text-sc-text hover:bg-[var(--sc-surface-tertiary)]'}
                                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                            `}
                        >
                            {preset.name}
                        </button>
                    </Tooltip>
                );
            })}
            {activeId === null && (
                <Tooltip content={`Custom (model=${aiModel}, voice=${ttsVoice}). Pick a preset to snap back to a known bundle.`}>
                    <span
                        className="inline-flex items-center rounded-full border border-dashed border-[var(--sc-separator)] text-sc-text-muted font-medium text-xs px-2 py-1"
                    >
                        Custom
                    </span>
                </Tooltip>
            )}
        </div>
    );
});

PresetChipStrip.displayName = 'PresetChipStrip';
