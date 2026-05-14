'use client';

/**
 * DesignPackBridge — injects DesignPack tokens as CSS custom properties.
 *
 * All styling flows through CSS variables (--sc-*) consumed by Tailwind
 * utilities and inline styles. Pack changes update vars → all components respond.
 */

import React, { useLayoutEffect } from 'react';
import type { DesignPack } from './types';
import { useDesignPack } from './DesignPackContext';

function deriveSemanticVars(pack: DesignPack) {
  const isLight = pack.mode === 'light';
  const surfaceBlend = isLight ? 84 : 74;
  const surfaceTertiaryBlend = isLight ? 68 : 58;
  const accentSoftBlend = isLight ? 14 : 20;
  const defaultHoverBlend = isLight ? 88 : 82;
  const fieldBlend = isLight ? 92 : 78;
  const fieldHoverBlend = isLight ? 84 : 70;
  const fieldFocusBlend = isLight ? 97 : 86;

  return {
    '--sc-surface-secondary': `color-mix(in srgb, ${pack.color.surface} ${surfaceBlend}%, ${pack.color.background} ${100 - surfaceBlend}%)`,
    '--sc-surface-tertiary': `color-mix(in srgb, ${pack.color.surfaceAlt} ${surfaceTertiaryBlend}%, ${pack.color.background} ${100 - surfaceTertiaryBlend}%)`,
    '--sc-surface-secondary-foreground': pack.color.text,
    '--sc-surface-tertiary-foreground': pack.color.textMuted,
    '--sc-separator': `color-mix(in srgb, ${pack.color.border} 88%, transparent)`,
    '--sc-overlay': `color-mix(in srgb, ${pack.color.background} ${isLight ? 56 : 72}%, transparent)`,
    '--sc-default': `color-mix(in srgb, ${pack.color.surfaceAlt} ${isLight ? 78 : 66}%, ${pack.color.background} ${isLight ? 22 : 34}%)`,
    '--sc-default-foreground': pack.color.text,
    '--sc-default-hover': `color-mix(in srgb, ${pack.color.surfaceAlt} ${defaultHoverBlend}%, ${pack.color.text} ${100 - defaultHoverBlend}%)`,
    '--sc-accent-soft': `color-mix(in srgb, ${pack.color.primary} ${accentSoftBlend}%, ${pack.color.surface} ${100 - accentSoftBlend}%)`,
    '--sc-accent-soft-foreground': isLight ? pack.color.primary : pack.color.text,
    '--sc-field-background': `color-mix(in srgb, ${pack.color.surface} ${fieldBlend}%, ${pack.color.background} ${100 - fieldBlend}%)`,
    '--sc-field-foreground': pack.color.text,
    '--sc-field-placeholder': `color-mix(in srgb, ${pack.color.textMuted} 76%, transparent)`,
    '--sc-field-hover': `color-mix(in srgb, ${pack.color.surfaceAlt} ${fieldHoverBlend}%, ${pack.color.surface} ${100 - fieldHoverBlend}%)`,
    '--sc-field-focus': `color-mix(in srgb, ${pack.color.surface} ${fieldFocusBlend}%, ${isLight ? '#ffffff' : pack.color.primary} ${100 - fieldFocusBlend}%)`,
    '--sc-field-border': `color-mix(in srgb, ${pack.color.border} ${isLight ? 100 : 92}%, transparent)`,
    '--sc-field-border-hover': `color-mix(in srgb, ${pack.color.border} ${isLight ? 78 : 72}%, ${pack.color.text} ${isLight ? 22 : 28}%)`,
    '--sc-field-border-focus': `color-mix(in srgb, ${pack.color.primary} ${isLight ? 46 : 58}%, transparent)`,
    '--sc-status-focus-ring': `0 0 0 1px color-mix(in srgb, ${pack.color.primary} ${isLight ? 40 : 55}%, transparent), 0 0 0 4px color-mix(in srgb, ${pack.color.primary} ${isLight ? 14 : 20}%, transparent)`,
    '--sc-status-focus-field': `0 0 0 1px color-mix(in srgb, ${pack.color.primary} ${isLight ? 45 : 58}%, transparent), 0 0 0 4px color-mix(in srgb, ${pack.color.primary} ${isLight ? 12 : 18}%, transparent)`,
    '--sc-status-invalid-ring': `0 0 0 1px color-mix(in srgb, ${pack.color.danger} ${isLight ? 42 : 55}%, transparent), 0 0 0 4px color-mix(in srgb, ${pack.color.danger} ${isLight ? 12 : 18}%, transparent)`,
    '--sc-status-invalid-border': `color-mix(in srgb, ${pack.color.danger} ${isLight ? 52 : 64}%, transparent)`,
    '--sc-status-pending-opacity': '0.72',
  } as const;
}

/**
 * Build a flat Record<string, string> of all --sc-* tokens from a DesignPack.
 * Used for both :root injection and app iframe theming.
 */
export function buildThemeTokens(pack: DesignPack): Record<string, string> {
  const u = pack.space.unit;
  const tokens: Record<string, string> = {
    // Colors
    '--sc-background': pack.color.background,
    '--sc-surface': pack.color.surface,
    '--sc-surface-alt': pack.color.surfaceAlt,
    '--sc-text': pack.color.text,
    '--sc-text-muted': pack.color.textMuted,
    '--sc-primary': pack.color.primary,
    '--sc-accent': pack.color.accent,
    '--sc-border': pack.color.border,
    '--sc-danger': pack.color.danger,
    '--sc-success': pack.color.success,
    '--sc-warning': pack.color.warning,
    // Surface
    '--sc-surface-elevated': pack.surface.elevated,
    '--sc-surface-inset-highlight': pack.surface.insetHighlight,
    // Shadows
    '--sc-shadow-sm': pack.shadow.sm,
    '--sc-shadow-md': pack.shadow.md,
    '--sc-shadow-lg': pack.shadow.lg,
    '--sc-shadow-xl': pack.shadow.xl,
    // Opacity
    '--sc-opacity-hover': String(pack.opacity.hover),
    '--sc-opacity-pressed': String(pack.opacity.pressed),
    '--sc-opacity-disabled': String(pack.opacity.disabled),
    '--sc-opacity-overlay': String(pack.opacity.overlay),
    // Typography
    '--sc-font-sans': pack.typography.fontSans,
    '--sc-font-mono': pack.typography.fontMono,
    '--sc-text-xs': pack.typography.sizes.xs,
    '--sc-text-sm': pack.typography.sizes.sm,
    '--sc-text-base': pack.typography.sizes.base,
    '--sc-text-lg': pack.typography.sizes.lg,
    '--sc-text-xl': pack.typography.sizes.xl,
    '--sc-text-2xl': pack.typography.sizes['2xl'],
    '--sc-font-weight-normal': String(pack.typography.weights.normal),
    '--sc-font-weight-medium': String(pack.typography.weights.medium),
    '--sc-font-weight-semibold': String(pack.typography.weights.semibold),
    '--sc-font-weight-bold': String(pack.typography.weights.bold),
    '--sc-leading-tight': String(pack.typography.lineHeights.tight),
    '--sc-leading-normal': String(pack.typography.lineHeights.normal),
    '--sc-leading-relaxed': String(pack.typography.lineHeights.relaxed),
    // Radius
    '--sc-radius-sm': `${pack.radius.sm}px`,
    '--sc-radius-md': `${pack.radius.md}px`,
    '--sc-radius-lg': `${pack.radius.lg}px`,
    // Spacing
    '--sc-space-unit': `${u}px`,
    '--sc-space-0\\.5': `${u * 0.5}px`,
    '--sc-space-1': `${u}px`,
    '--sc-space-1\\.5': `${u * 1.5}px`,
    '--sc-space-2': `${u * 2}px`,
    '--sc-space-3': `${u * 3}px`,
    '--sc-space-4': `${u * 4}px`,
    '--sc-space-6': `${u * 6}px`,
    '--sc-space-8': `${u * 8}px`,
    // Motion
    '--sc-motion-fast': pack.motion.durationFast,
    '--sc-motion-base': pack.motion.durationBase,
    '--sc-motion-easing': pack.motion.easing,
    // Component rules
    '--sc-panel-style': pack.componentRules.panelStyle,
    '--sc-button-style': pack.componentRules.buttonStyle,
    '--sc-message-style': pack.componentRules.messageStyle,
    '--sc-input-style': pack.componentRules.inputStyle,
    '--sc-tooltip-style': pack.componentRules.tooltipStyle,
    '--sc-divider-style': pack.componentRules.dividerStyle,
    '--sc-badge-style': pack.componentRules.badgeStyle,
    '--sc-focus-ring-style': pack.componentRules.focusRingStyle,
    // Derived semantic
    ...deriveSemanticVars(pack),
  };
  return tokens;
}

/** Convert token map to a CSS :root { ... } string for iframe injection */
export function themeTokensToCss(tokens: Record<string, string>): string {
  const lines = Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

function injectCssVars(pack: DesignPack) {
  const s = document.documentElement.style;
  const tokens = buildThemeTokens(pack);

  for (const [key, value] of Object.entries(tokens)) {
    s.setProperty(key, value);
  }

  s.colorScheme = pack.mode;
  document.documentElement.dataset.scMode = pack.mode;

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', pack.color.background);
  }
}

/**
 * Injects DesignPack tokens as CSS custom properties on :root.
 * Uses useLayoutEffect to prevent flash of unstyled content.
 */
export function DesignPackBridge({ children }: { children: React.ReactNode }) {
  const { pack } = useDesignPack();

  useLayoutEffect(() => {
    injectCssVars(pack);
    // Notify app platform of theme change
    window.dispatchEvent(new CustomEvent('smartchats:theme_change', {
      detail: { tokens: buildThemeTokens(pack) }
    }));
  }, [pack]);

  return <>{children}</>;
}

/**
 * Backward-compat hook — mirrors the old useColorMode API.
 */
export function useColorMode() {
  const { toggleMode: toggleColorMode, mode } = useDesignPack();
  return { toggleColorMode, mode };
}
