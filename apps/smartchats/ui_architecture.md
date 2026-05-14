# SmartChats UI Architecture

## Overview

SmartChats uses a **token-driven design system** with **swappable shells** and **design packs** as orthogonal concerns. Shells control layout and navigation; packs control visual appearance. Any shell works with any pack.

```
3 shells × 10 packs × 2 modes (dark/light) = 60 visual variants
```

---

## Token Pipeline

```
DesignPack (TypeScript)
    │
    ▼
DesignPackBridge (core/DesignPackBridge.tsx)
    │  useLayoutEffect injects 50+ CSS custom properties on :root
    ▼
CSS Variables (--sc-*)
    │
    ├──▶ Tailwind Config (tailwind.config.ts)
    │       Maps vars to utility classes: bg-sc-surface, text-sc-primary,
    │       shadow-sc-md, rounded-sc, duration-sc-fast, etc.
    │
    ├──▶ globals.css
    │       Fallback defaults, .panel utility, scrollbar styles, a11y
    │
    └──▶ Components
            Read pack via useDesignPack() for:
            - componentRules (Button, Input, Chip, Tooltip, WidgetItem)
            - surface tokens (elevated gradient, inset highlight)
            - mode (dark/light) for external lib theming
```

Pack/mode changes update CSS variables → all components respond instantly. No re-mount, no prop drilling.

---

## DesignPack Type System

Each `DesignPack` defines a complete visual language:

```typescript
type DesignPack = {
  id: string;
  name: string;
  mode: 'dark' | 'light';

  color: ColorTokens;        // 11 semantic colors
  surface: SurfaceTokens;    // elevated gradient + inset highlight
  shadow: ShadowTokens;      // sm/md/lg/xl (include ring + inset)
  opacity: OpacityTokens;    // hover/pressed/disabled/overlay
  typography: TypographyTokens; // fonts, sizes, weights, lineHeights
  space: SpaceTokens;        // base unit + density
  radius: RadiusTokens;      // sm/md/lg
  motion: MotionTokens;      // durationFast, durationBase, easing
  componentRules: ComponentRules; // 8 rules that change component behavior
};
```

A `PairedDesignPack` provides both dark and light variants under one ID.

### ColorTokens (11)

| Token | Purpose |
|-------|---------|
| `background` | Page/app background |
| `surface` | Card/panel fill |
| `surfaceAlt` | Nested panels, code blocks |
| `text` | Primary text |
| `textMuted` | Secondary/muted text |
| `primary` | Brand color, links, active states |
| `accent` | Highlights, secondary actions |
| `border` | Borders, dividers |
| `danger` | Errors, destructive actions |
| `success` | Success states |
| `warning` | Warning states |

### SurfaceTokens

Elevation on dark backgrounds can't rely on box-shadow alone (black shadow on near-black background is invisible). MUI solved this with progressively lighter surfaces. We solve it with:

| Token | Purpose | Example |
|-------|---------|---------|
| `elevated` | Background for raised panels. Can be a CSS gradient. | `linear-gradient(to bottom, #1f1f23, #1a1a1e)` |
| `insetHighlight` | Top-edge inner glow simulating light hitting a raised surface. | `inset 0 1px 0 rgba(255,255,255,0.05)` |

These are consumed by `WidgetItem` and composed with the shadow tokens: `boxShadow: var(--sc-shadow-md), ${pack.surface.insetHighlight}`.

### ShadowTokens

Each shadow string includes the full stack for its elevation level:
- **Ring separator** — `0 0 0 1px rgba(...)` hairline outline
- **Contact shadow** — tight, sharp shadow close to the surface
- **Ambient shadow** — diffused, larger shadow for depth

Dark theme shadows use higher opacity. Light theme shadows are subtle.

### ComponentRules (8)

Components read these to set their **default behavior**. Explicit props override.

| Rule | Values | Consumed By |
|------|--------|-------------|
| `panelStyle` | flat / elevated / outlined / glass | WidgetItem |
| `buttonStyle` | solid / outline / ghost / soft | Button |
| `messageStyle` | bubble / flat / bordered | ChatWidget |
| `inputStyle` | outlined / filled / underlined | Input |
| `badgeStyle` | solid / soft / outline | Chip (default variant) |
| `tooltipStyle` | solid / outlined | Tooltip |
| `dividerStyle` | solid / subtle / none | — |
| `focusRingStyle` | ring / outline / glow | — |

Example: Default pack sets `buttonStyle: 'solid'`, Midnight sets `buttonStyle: 'soft'`. A `<Button>` with no variant prop renders solid in Default and soft in Midnight. `<Button variant="ghost">` always renders ghost regardless of pack.

---

## Shell System

### Architecture

```
app3.tsx (Shell Host)
  ├── All initialization (auth, insights, agent, tivi, orchestrator)
  ├── All Zustand store selectors (70+)
  ├── Settings persistence, auto-scroll, window globals
  ├── Composes typed ShellProps
  └── return <ActiveShell {...shellProps} />
```

The host owns **all state management**. Shells own **only layout**. This follows the composition pattern of decoupling state from UI — the shell receives a typed props contract and decides how to arrange it.

### ShellProps

```typescript
type ShellProps = {
  voice: ShellVoiceState;        // started, transcribe, audioLevelRef, etc.
  ui: ShellUIState;              // mode, focusedWidget, settingsOpen
  auth: ShellAuthState;          // firebaseUser, totalAvailable
  settings: ShellSettingsState;  // aiModel, colorMode, designPackId
  widgetConfig: ShellWidgetConfig; // widgets, visibleWidgets, widgetLayout
  widgetProps: WidgetRenderProps;   // typed props for all 17 widgets
  actions: ShellActions;         // all callbacks (30+)
  meta: ShellMeta;               // tivi, tiviSettings, shell switching
};
```

### Shell Variants

| Shell | File | Layout | Use Case |
|-------|------|--------|----------|
| Desktop Default | `app/shells/DesktopDefaultShell.tsx` | TopBar + draggable 12-col widget grid + drawers | Power users, full dashboard |
| Desktop Focus | `app/shells/DesktopFocusShell.tsx` | Compact bar + full-height conversation + collapsible tool sidebar | Focused work, presentations |
| Mobile | `app/shells/MobileShell.tsx` | Bottom tabs (Chat/Tools/Settings) + stacked panels | Touch devices, narrow viewports |

### Shell Switching

Settings → Appearance → Shell Layout dropdown. Persisted to localStorage.

```javascript
// Console API
window.__smartchats_shells__.switch('desktop-focus')
window.__smartchats_shells__.available // ['desktop-default', 'desktop-focus', 'mobile']
```

### Adding a New Shell

1. Create `app/shells/MyShell.tsx` — receives `ShellProps`, renders layout
2. Add to `SHELLS` map in `app3.tsx`
3. Add to `meta.availableShells` array in `app3.tsx`

No changes to state management, store selectors, or initialization code.

---

## UI Primitives

9 components in `app/ui/` provide the building blocks. All use `sc-*` tokens. Components that support it read `componentRules` from the active pack.

| Component | Props | Pack-Driven |
|-----------|-------|-------------|
| **Button** | variant, size, loading, disabled | Default variant from `buttonStyle` |
| **Input** | label, error, helperText, size | Style from `inputStyle` |
| **Modal** | open, onClose, title, size | Focus trap, portal, ARIA |
| **Drawer** | open, onClose, anchor, width | Focus trap, ARIA, overlay opacity |
| **Switch** | checked, onChange, label, size | focus-visible ring |
| **Slider** | value, onChange, min/max/step, label | — |
| **Select** | value, onChange, options, label | Theme-aware dropdown arrow |
| **Tooltip** | content, children, position | Style from `tooltipStyle` |
| **Chip** | label, variant, size | Default variant from `badgeStyle` |

### WidgetItem

`app/WidgetItem.tsx` wraps every widget. It reads `panelStyle` from the pack and applies:
- **flat** — plain surface, no border or shadow
- **elevated** — surface gradient (`pack.surface.elevated`), border, shadow + inset highlight
- **outlined** — transparent background, visible border
- **glass** — blurred backdrop, semi-transparent surface, gradient + highlight

The elevated style is the key to professional appearance on dark backgrounds. It combines:
1. A gradient background (lighter at top)
2. An inset top-edge highlight (simulates light)
3. A ring separator + layered shadow
4. Hover lift animation (`translateY(-1px)`)

---

## Design Packs (10)

| Pack | File | Aesthetic | Dark Primary |
|------|------|-----------|-------------|
| Default | `default.ts` | Refined professional | `#3b82f6` (blue) |
| Midnight | `midnight.ts` | Glass/vibrant | `#818cf8` (indigo) |
| Neon Terminal | `neon_terminal.ts` | Cyberpunk/hacker | `#00ff88` (green) |
| Zen | `zen.ts` | Calm/wellness | `#8b9cf6` (lavender) |
| Brutalist | `brutalist.ts` | Raw/anti-design | `#ff0000` (red) |
| Aurora | `aurora.ts` | Iridescent/premium | `#a78bfa` (violet) |
| Crypto Gold | `crypto_gold.ts` | Fintech/trust | `#f59e0b` (gold) |
| Creative | `creative.ts` | Bold/playful | `#ec4899` (pink) |
| OLED Black | `oled_black.ts` | True black/minimal | `#60a5fa` (blue) |
| Dev Tools | `dev_tools.ts` | IDE/code | `#22c55e` (green) |

All packs live in `core/theme-packs/`. Adding a pack:
1. Create `core/theme-packs/my_pack.ts` exporting a `PairedDesignPack`
2. Import and register in `core/theme-packs/index.ts`
3. Automatically appears in the Settings dropdown

---

## Accessibility

| Feature | Implementation |
|---------|---------------|
| Reduced motion | `@media (prefers-reduced-motion: reduce)` in globals.css |
| Color scheme | `color-scheme: dark` on `:root` |
| Touch optimization | `touch-action: manipulation` on interactive elements |
| Theme color | `<meta name="theme-color">` in layout |
| Skip link | First child of body, sr-only → visible on focus |
| Focus traps | Drawer, Modal — Tab cycling, focus save/restore |
| ARIA roles | `role="dialog"` + `aria-modal` on Drawer/Modal, `role="tooltip"` on Tooltip |
| Focus indicators | `focus-visible:ring` on Switch, Button, Input |
| Color-not-only | SandboxLogsWidget: icons alongside color-coded log levels |
| Disabled states | `opacity: var(--sc-opacity-disabled)`, `cursor: not-allowed` |

---

## Performance

| Optimization | Where |
|-------------|-------|
| `content-visibility: auto` | `.widget-auto-contain` on off-screen widget grid items |
| `useLayoutEffect` | DesignPackBridge — prevents flash of unstyled content |
| Memoized widget grid | `useMemo` in shells — grid only re-renders when layout/visible widgets change |
| Memoized widget props | `useMemo` in app3.tsx — 45-field object recomputed only when deps change |
| React.memo | All widget components, TopBar, SettingsPanel, SessionBrowser, ChatModeView |
| Dynamic imports | KnowledgeGraphWidget (sigma.js), AceEditor |

---

## File Structure

```
apps/smartchats/
├── core/
│   ├── types/
│   │   ├── design_pack.ts     # DesignPack, ColorTokens, SurfaceTokens, ComponentRules, etc.
│   │   ├── shell.ts           # ShellProps, ShellVoiceState, ShellActions, ShellMeta
│   │   └── index.ts
│   ├── theme-packs/
│   │   ├── default.ts         # + 9 more pack files
│   │   └── index.ts           # Registry (10 packs)
│   ├── platform/              # SmartChatsAudio, SmartChatsStorage interfaces
│   ├── DesignPackBridge.tsx   # CSS variable injection
│   ├── DesignPackContext.tsx   # React context + useDesignPack()
│   ├── shell_registry.ts      # Shell registry API
│   └── index.ts               # Public API
├── app/
│   ├── shells/
│   │   ├── DesktopDefaultShell.tsx
│   │   ├── DesktopFocusShell.tsx
│   │   ├── MobileShell.tsx
│   │   └── index.ts
│   ├── ui/
│   │   ├── Button.tsx, Input.tsx, Modal.tsx, Drawer.tsx,
│   │   │   Switch.tsx, Slider.tsx, Select.tsx, Tooltip.tsx, Chip.tsx
│   │   └── index.ts
│   ├── components/            # TopBar, SettingsPanel, ChatModeView, etc.
│   ├── widgets/               # 17 widget components
│   ├── hooks/                 # useOrchestrator, useChatMode, useWidgetConfig, etc.
│   ├── store/                 # useSmartChatsStore (Zustand)
│   ├── app3.tsx               # Shell host (state management + shell selection)
│   ├── WidgetItem.tsx         # Widget wrapper (reads panelStyle from pack)
│   ├── globals.css            # Tailwind import, CSS var defaults, utilities
│   └── layout.tsx             # Root layout, ThemeContextProvider, meta
├── tailwind.config.ts         # sc-* utility mappings
└── postcss.config.mjs
```

---

## Key Design Decisions

1. **Shadows include ring + inset** — On dark backgrounds, traditional box-shadows are invisible. Shadow tokens include a hairline ring separator and the inset highlight is composed at render time from `pack.surface.insetHighlight`.

2. **Surface gradient for elevation** — `pack.surface.elevated` can be a CSS gradient (lighter at top, darker at bottom) which is what creates the perception of depth. This replaces MUI's elevation-based surface lightening.

3. **ComponentRules as defaults, not overrides** — Packs set the default personality (solid vs soft buttons, elevated vs glass panels). Explicit props always win. This means packs feel different without breaking specific UI choices.

4. **Host/shell separation** — app3.tsx has 70+ store selectors and complex initialization. None of that is in any shell. Shells are pure layout components receiving typed props. This means adding a new shell is 100-200 lines of layout code with zero state management.

5. **CSS variables over Tailwind for critical styling** — Shadows and surface gradients are applied via inline `style` reading from `pack.surface.*` and `var(--sc-shadow-*)`. Tailwind utility classes handle everything else. This ensures shadows render correctly (Tailwind v4's CSS variable box-shadow mapping can be unreliable).
