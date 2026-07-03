'use client';

/**
 * PresetMenu
 *
 * Single-button trigger that opens a three-column popup:
 *   [ Presets ] [ Model ] [ Voice (grouped by provider) ]
 *
 * The trigger label is the current preset name (or "Custom" if the
 * (aiModel, ttsProvider, ttsVoice) triple doesn't match any preset).
 * Clicking a preset atomically swaps all three axes. Clicking a model
 * or voice edits that axis only — since the triple then usually drifts,
 * the trigger flips to "Custom" via findMatchingPreset(...) === null.
 *
 * Interaction:
 *   - click trigger  → toggle open
 *   - hover trigger  → open (desktop-only; touch devices see click)
 *   - click preset   → apply + close
 *   - click model    → apply + stay open (user might tweak voice next)
 *   - click voice    → apply + stay open
 *   - click outside  → close
 *   - Esc           → close
 *
 * Voice column is a single scrolling list with section headers by
 * provider — no per-row provider badge (per user preference).
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import {
    AGENT_PRESETS,
    findMatchingPreset,
    MODEL_REGISTRY,
    VOICE_CATALOG,
    type TTSProvider,
    type VoiceInfo,
} from 'cortex';

type PresetMenuProps = {
    aiModel: string;
    ttsProvider: string;
    ttsVoice: string;
    onSelectPreset: (presetId: string) => void;
    onSelectModel: (modelId: string) => void;
    onSelectVoice: (voiceId: string) => void;
    /** Freeze axis edits while a session is running (adapter swap guard). */
    disabled?: boolean;
    className?: string;
};

// Provider-ordered voice groups. Order in VOICE_CATALOG defines display order.
const VOICE_GROUPS: Array<{ provider: TTSProvider; label: string; voices: VoiceInfo[] }> =
    (Object.keys(VOICE_CATALOG) as TTSProvider[]).map((p) => ({
        provider: p,
        label: p === 'openai' ? 'OpenAI' : p === 'azure' ? 'Azure' : p,
        voices: VOICE_CATALOG[p],
    }));

const MODEL_IDS = Object.keys(MODEL_REGISTRY);

export const PresetMenu: React.FC<PresetMenuProps> = React.memo(({
    aiModel,
    ttsProvider,
    ttsVoice,
    onSelectPreset,
    onSelectModel,
    onSelectVoice,
    disabled = false,
    className = '',
}) => {
    const [open, setOpen] = useState(false);
    const [popupPos, setPopupPos] = useState<{ top: number; left: number; width: number } | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);

    const active = useMemo(
        () => findMatchingPreset(aiModel, ttsProvider, ttsVoice),
        [aiModel, ttsProvider, ttsVoice],
    );
    const triggerLabel = active?.name ?? 'Custom';

    // Compute popup position: centered horizontally on the trigger button
    // (so the middle column lines up with the trigger), placed just below
    // it. Clamped to viewport so it never runs off-screen. Recomputed on
    // window resize + scroll while open.
    const recomputePos = useCallback(() => {
        const t = triggerRef.current;
        if (!t) return;
        const rect = t.getBoundingClientRect();
        const vw = window.innerWidth;
        // Match the CSS max-width used below (`min(720px, 90vw)`).
        const width = Math.min(720, vw * 0.9);
        const triggerCenter = rect.left + rect.width / 2;
        let left = Math.round(triggerCenter - width / 2);
        const margin = 8;
        if (left < margin) left = margin;
        if (left + width > vw - margin) left = vw - width - margin;
        const top = Math.round(rect.bottom + 6);
        setPopupPos({ top, left, width });
    }, []);

    useLayoutEffect(() => {
        if (!open) return;
        recomputePos();
        const onResize = () => recomputePos();
        window.addEventListener('resize', onResize);
        window.addEventListener('scroll', onResize, true);
        return () => {
            window.removeEventListener('resize', onResize);
            window.removeEventListener('scroll', onResize, true);
        };
    }, [open, recomputePos]);

    // Close on click-outside + Esc. Trigger + popup both count as "inside".
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            const inTrigger = wrapRef.current?.contains(e.target as Node);
            const inPopup   = popupRef.current?.contains(e.target as Node);
            if (!inTrigger && !inPopup) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const handleTriggerClick = useCallback(() => {
        setOpen((v) => !v);
    }, []);
    const handleTriggerEnter = useCallback(() => {
        if (disabled) return;
        // Hover-open is a desktop nicety — pointer:fine covers mouse-only.
        if (window.matchMedia?.('(pointer: fine)').matches) setOpen(true);
    }, [disabled]);

    const handlePickPreset = useCallback((id: string) => {
        onSelectPreset(id);
        setOpen(false);
    }, [onSelectPreset]);
    const handlePickModel = useCallback((id: string) => {
        onSelectModel(id);
    }, [onSelectModel]);
    const handlePickVoice = useCallback((id: string) => {
        onSelectVoice(id);
    }, [onSelectVoice]);

    return (
        <div
            ref={wrapRef}
            className={`relative inline-block ${className}`}
            onMouseEnter={handleTriggerEnter}
        >
            <button
                ref={triggerRef}
                type="button"
                onClick={handleTriggerClick}
                disabled={disabled}
                aria-haspopup="menu"
                aria-expanded={open}
                className={`
                    inline-flex items-center gap-1.5 rounded-full border font-medium text-xs
                    px-3 py-1.5 transition-colors duration-150
                    border-[var(--sc-separator)] bg-[var(--sc-surface-secondary)] text-sc-text
                    hover:bg-[var(--sc-surface-tertiary)]
                    ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                    ${open ? 'bg-[var(--sc-surface-tertiary)]' : ''}
                `}
            >
                <span className="truncate max-w-[10rem]">{triggerLabel}</span>
                <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && popupPos && typeof document !== 'undefined' && createPortal(
                <div
                    ref={popupRef}
                    role="menu"
                    className="rounded-md border border-[var(--sc-separator)] bg-[var(--sc-surface)] shadow-2xl overflow-hidden"
                    style={{
                        position: 'fixed',
                        top: popupPos.top,
                        left: popupPos.left,
                        width: popupPos.width,
                        zIndex: 1000,
                    }}
                >
                    <div className="grid grid-cols-3 divide-x divide-[var(--sc-separator)]">
                        {/* ── Presets column ─────────────────────────── */}
                        <MenuColumn heading="Presets">
                            {AGENT_PRESETS.map((p) => (
                                <MenuItem
                                    key={p.id}
                                    label={p.name}
                                    detail={p.description}
                                    selected={active?.id === p.id}
                                    onClick={() => handlePickPreset(p.id)}
                                    disabled={disabled}
                                />
                            ))}
                            <MenuItem
                                key="__custom"
                                label="Custom"
                                detail="Set model + voice individually below."
                                selected={active === null}
                                onClick={() => { /* no-op — Custom is a derived state */ }}
                                disabled
                                subdued
                            />
                        </MenuColumn>

                        {/* ── Model column ───────────────────────────── */}
                        <MenuColumn heading="Model">
                            {MODEL_IDS.map((mid) => {
                                const info = MODEL_REGISTRY[mid];
                                return (
                                    <MenuItem
                                        key={mid}
                                        label={mid}
                                        detail={info?.provider ?? ''}
                                        selected={aiModel === mid}
                                        onClick={() => handlePickModel(mid)}
                                        disabled={disabled}
                                    />
                                );
                            })}
                        </MenuColumn>

                        {/* ── Voice column (grouped, no badges) ──────── */}
                        <MenuColumn heading="Voice">
                            {VOICE_GROUPS.map((group) => (
                                <React.Fragment key={group.provider}>
                                    <div className="px-3 pt-2 pb-1 text-[0.65rem] uppercase tracking-wider text-sc-text-muted">
                                        {group.label}
                                    </div>
                                    {group.voices.map((v) => (
                                        <MenuItem
                                            key={v.id}
                                            label={v.displayName}
                                            detail={v.description}
                                            selected={ttsVoice === v.id}
                                            onClick={() => handlePickVoice(v.id)}
                                            disabled={disabled}
                                        />
                                    ))}
                                </React.Fragment>
                            ))}
                        </MenuColumn>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
});

PresetMenu.displayName = 'PresetMenu';

// ── Internals ────────────────────────────────────────────────────

function MenuColumn({ heading, children }: { heading: string; children: React.ReactNode }) {
    return (
        <div className="max-h-[22rem] overflow-y-auto">
            <div className="sticky top-0 z-10 bg-[var(--sc-surface)] px-3 py-2 text-[0.7rem] uppercase tracking-wider text-sc-text-muted border-b border-[var(--sc-separator)]">
                {heading}
            </div>
            <div className="py-1">{children}</div>
        </div>
    );
}

type MenuItemProps = {
    label: string;
    detail?: string;
    selected: boolean;
    onClick: () => void;
    disabled?: boolean;
    /** Muted rendering — for the Custom pseudo-row. */
    subdued?: boolean;
};
function MenuItem({ label, detail, selected, onClick, disabled, subdued }: MenuItemProps) {
    return (
        <button
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            onClick={onClick}
            disabled={disabled}
            className={`
                w-full text-left px-3 py-1.5 text-xs flex items-start gap-2
                ${selected
                    ? 'bg-[color-mix(in_srgb,var(--sc-primary)_12%,transparent)] text-sc-primary'
                    : subdued
                        ? 'text-sc-text-muted'
                        : 'text-sc-text hover:bg-[var(--sc-surface-secondary)]'}
                ${disabled ? 'cursor-default' : 'cursor-pointer'}
            `}
        >
            <span className="mt-0.5 shrink-0 w-3">
                {selected && <Check size={12} />}
            </span>
            <span className="flex-1 min-w-0">
                <span className="block font-medium truncate">{label}</span>
                {detail && (
                    <span className="block text-[0.65rem] text-sc-text-muted truncate">
                        {detail}
                    </span>
                )}
            </span>
        </button>
    );
}
