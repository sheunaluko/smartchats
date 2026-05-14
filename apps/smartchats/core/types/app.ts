/**
 * SmartChats App Platform — Type Definitions
 *
 * An "app" is a packaging and identity envelope around SCM modules,
 * with associated metadata, HTML UI, scoped state, and declared permissions.
 * Apps compose INTO the agent — they are not standalone programs.
 */

// ── Permission System ──

export type AppPermission =
  | 'display'
  | 'workspace:read' | 'workspace:write'
  | 'data:read' | 'data:write' | 'data:raw_query'
  | 'voice:tts' | 'voice:mic'
  | 'functions:dynamic'
  | 'process:spawn'
  | 'search:web'
  | 'system:appearance'
  | 'llm:call'

export type AppSource = 'builtin' | 'agent' | 'community'
export type AppDisplayMode = 'overlay' | 'panel' | 'inline'
export type AppLifecycleState = 'installed' | 'loaded' | 'active' | 'suspended'
export type AppInteractionMode = 'agent_driven' | 'app_driven' | 'hybrid'

// ── Author ──

export interface AppAuthor {
  uid: string
  name: string
  url?: string
}

// ── Serialized Function (stored in DB, runs in iframe) ──
// Signature: (fnArgs, app, util) => { ... }

export interface SerializedAppFunction {
  name: string
  description: string
  parameters: Record<string, string> | null
  return_type: string
  code: string
}

// ── Serialized Module (stored in DB) ──

export interface SerializedAppModule {
  id: string
  name: string
  position: number
  system_msg?: string
  output_instructions?: string
  functions?: SerializedAppFunction[]
  builtin_factory?: string
  data_tables?: string[]
  required_permissions?: AppPermission[]
}

// ── Voice Hooks ──

export interface AppVoiceHooks {
  wants_transcripts: boolean
  on_open?: string
  on_data?: string
  commands?: Record<string, string>
  escape_commands?: string[]
}

// ── State Schema Entry ──

export interface AppStateField {
  type: string
  default: any
  description: string
  /** Whether this field survives across sessions. Default: true. */
  persist?: boolean
}

// ── Version History Entry ──

export interface AppVersionEntry {
  version: string
  published_at: string
  changelog?: string
}

// ── App Manifest (global definition in smartchats_apps table) ──

export interface AppManifest {
  // Identity
  id: string
  name: string
  version: string
  description: string
  author?: AppAuthor
  icon?: string

  // Classification
  categories?: string[]
  tags?: string[]
  embedding?: number[]

  // Agent Integration
  modules: SerializedAppModule[]
  interaction_mode?: AppInteractionMode

  // UI
  html_templates?: Record<string, string>
  display_mode?: AppDisplayMode

  // State
  state_schema?: Record<string, AppStateField>

  // Permissions
  permissions: AppPermission[]
  requested_functions?: string[]

  // Voice
  voice_hooks?: AppVoiceHooks

  // External scripts (CDN imports — enforced via CSP in iframe)
  external_scripts?: string[]

  // Lifecycle hooks (function names within the app)
  on_activate?: string
  on_deactivate?: string

  // Migration
  migrations?: Array<{ from_version: string; to_version: string; queries: string[] }>

  // Origin
  source: AppSource
  forked_from?: string

  // Ecosystem
  install_count?: number
  rating_sum?: number
  rating_count?: number
  featured?: boolean
  verified?: boolean
  min_tier?: string
  version_history?: AppVersionEntry[]

  // Timestamps
  created_at?: string
  updated_at?: string
  published_at?: string | null
}

// ── App Install (per-user record in smartchats_app_installs) ──

export interface AppInstall {
  id?: string
  app_id: string
  installed_version: string
  granted_permissions: AppPermission[]
  app_state: Record<string, any>
  config: Record<string, any>
  last_activated_at?: string
  activation_count: number
  installed_at?: string
  updated_at?: string
}

// ── Runtime Types (in-memory only) ──

export interface LoadedApp {
  manifest: AppManifest
  install: AppInstall
  state: AppLifecycleState
  preview?: boolean
}
