/**
 * DesignPack — a complete visual language definition.
 *
 * A design pack decides how the app LOOKS (colors, typography, spacing, motion).
 * A shell decides how the app is ORGANIZED (layout, navigation, widget density).
 * Shells and design packs are independent — any pack can be applied to any shell.
 */

export type Density = 'compact' | 'comfortable' | 'spacious';

export type ColorTokens = {
  /** App background */
  background: string;
  /** Card/panel surface */
  surface: string;
  /** Alternate surface (e.g. code blocks, nested panels) */
  surfaceAlt: string;
  /** Primary text */
  text: string;
  /** Secondary/muted text */
  textMuted: string;
  /** Primary brand color (buttons, links, active states) */
  primary: string;
  /** Accent color (highlights, badges, secondary actions) */
  accent: string;
  /** Border/divider color */
  border: string;
  /** Error/destructive actions */
  danger: string;
  /** Success states */
  success: string;
  /** Warning states */
  warning: string;
};

export type ShadowTokens = {
  /** Subtle lift — buttons, chips */
  sm: string;
  /** Card/panel elevation (should include ring + inset highlight for dark themes) */
  md: string;
  /** Dropdowns, popovers */
  lg: string;
  /** Modals, dialogs */
  xl: string;
};

export type SurfaceTokens = {
  /** Surface background for elevated panels (can be a gradient) */
  elevated: string;
  /** Top-edge inset highlight for depth perception (e.g. "inset 0 1px 0 rgba(255,255,255,0.05)") */
  insetHighlight: string;
};

export type OpacityTokens = {
  /** Hover overlays */
  hover: number;
  /** Pressed/active feedback */
  pressed: number;
  /** Disabled elements */
  disabled: number;
  /** Backdrop/scrim overlays */
  overlay: number;
};

export type TypographyTokens = {
  fontSans: string;
  fontMono: string;
  /** Type scale ratio or named scale */
  scale: 'sm' | 'base' | 'lg';
  /** Default font weight */
  weight: number;
  /** Font size scale in rem */
  sizes: {
    xs: string;
    sm: string;
    base: string;
    lg: string;
    xl: string;
    '2xl': string;
  };
  /** Font weight scale */
  weights: {
    normal: number;
    medium: number;
    semibold: number;
    bold: number;
  };
  /** Line height scale */
  lineHeights: {
    tight: number;
    normal: number;
    relaxed: number;
  };
};

export type SpaceTokens = {
  /** Base spacing unit in px */
  unit: number;
  density: Density;
};

export type RadiusTokens = {
  sm: number;
  md: number;
  lg: number;
};

export type MotionTokens = {
  durationFast: string;
  durationBase: string;
  easing: string;
};

export type ComponentRules = {
  /** Panel appearance */
  panelStyle: 'flat' | 'elevated' | 'outlined' | 'glass';
  /** Button appearance */
  buttonStyle: 'solid' | 'outline' | 'ghost' | 'soft';
  /** Chat message bubble style */
  messageStyle: 'bubble' | 'flat' | 'bordered';
  /** Input field style */
  inputStyle: 'outlined' | 'filled' | 'underlined';
  /** Badge/chip style */
  badgeStyle: 'solid' | 'soft' | 'outline';
  /** Tooltip style */
  tooltipStyle: 'solid' | 'outlined';
  /** Divider style */
  dividerStyle: 'solid' | 'subtle' | 'none';
  /** Focus ring style */
  focusRingStyle: 'ring' | 'outline' | 'glow';
};

export type DesignPack = {
  id: string;
  name: string;
  description: string;
  mode: 'dark' | 'light';
  color: ColorTokens;
  surface: SurfaceTokens;
  shadow: ShadowTokens;
  opacity: OpacityTokens;
  typography: TypographyTokens;
  space: SpaceTokens;
  radius: RadiusTokens;
  motion: MotionTokens;
  componentRules: ComponentRules;
};

/**
 * A paired design pack provides both dark and light variants.
 * The shell/theme system can switch between them based on user preference.
 */
export type PairedDesignPack = {
  id: string;
  name: string;
  description: string;
  dark: DesignPack;
  light: DesignPack;
};
