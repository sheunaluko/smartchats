// Types
export type {
  DesignPack,
  PairedDesignPack,
  ColorTokens,
  ShadowTokens,
  SurfaceTokens,
  OpacityTokens,
  TypographyTokens,
  SpaceTokens,
  RadiusTokens,
  MotionTokens,
  ComponentRules,
  Density,
  ShellDefinition,
  ShellMetadata,
  ShellProps,
  ShellTarget,
  SmartChatsAudio,
  AudioCapabilities,
  SmartChatsStorage,
} from './types';

// Shell registry
export { registerShell, getShell, listShells, getShellIds } from './shell_registry';

// Design pack registry
export { designPacks, getDesignPack, listDesignPacks, defaultPack, midnightPack } from './theme-packs';

// Design pack context (React)
export { DesignPackProvider, useDesignPack } from './DesignPackContext';

// DesignPack bridge (CSS variable injection)
export { DesignPackBridge, useColorMode } from './DesignPackBridge';

// VizMotif registry
export { vizMotifs, getVizMotif, listVizMotifs, defaultMotif as defaultVizMotif } from './viz-motifs';

// VizMotif context (React)
export { VizMotifProvider, useVizMotif } from './VizMotifContext';

// Domain (portable business logic re-exports)
export * from './domain';
