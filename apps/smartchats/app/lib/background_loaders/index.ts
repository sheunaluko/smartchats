/**
 * Startup loaders registry — wires the 7 prefetch items to the
 * background_loader primitive with one shared insights pipeline.
 *
 * Design contract (see ./loader.ts for the primitive):
 *
 *   page-load → `createStartupLoaders(...)` + fire `.prefetch()` on all.
 *   Each load is fire-and-forget. The user's first agent turn does NOT
 *   wait for any of these. When each resolves, the value is auto-injected
 *   into the cortex agent's user_data_input context via `onResolve`, so
 *   the LLM sees richer context starting with the NEXT run_llm call.
 *
 *   If an agent function (`get_metrics_context`, `initialize`, …) is
 *   invoked while its corresponding loader is in-flight, the function
 *   awaits the SAME promise — no duplicate roundtrip. If invoked after
 *   resolve, returns the cached value. If invoked before prefetch was
 *   ever fired (defensive), starts the fetch on the spot.
 *
 * Late-bound singleton for cross-module access (modules can't reach
 * React-scoped state without an awkward provider — store + module-level
 * registry is the pattern already used for auth/insights).
 */

import { logger } from 'smartchats-common';
import { createBackgroundLoader, type BackgroundLoader } from './loader';
import { fetchInitInstructions } from '../../modules/initialization';
import { fetchProceduralInstructions } from '../../modules/procedural_instructions';
import { fetchMetricsContext } from '../../modules/metrics';
import { fetchLogCategories } from '../../modules/logging';
import { fetchTodosContext } from '../../modules/todos';
import { listInstalls, getApp } from '../../modules/app_registry';
import { seedBuiltinApps } from '../../apps/builtin_apps';
import { hydrateOnboardingFromKG } from '../../modules/onboarding';
import { hydrateAppLauncherInstalls } from '../../modules/app_launcher';
import { search_knowledge_deep } from '../../graph_utils';
import { embed_vector } from '@/lib/backend';
import { useSmartChatsStore } from '../../store/useSmartChatsStore';

const log = logger.get_logger({ id: 'bg_loaders' });

export interface StartupLoaderDeps {
    /** Returns the current cortex agent, or null if not yet ready.
     *  Called lazily on each onResolve — loaders may resolve before
     *  the agent finishes initializing. */
    agent: () => any | null;
    /** Insights client for bg_load_start / bg_load_complete telemetry. */
    insights: any;
}

export interface StartupLoaders {
    user_kg_shallow: BackgroundLoader<any>;
    todos_context: BackgroundLoader<any>;
    metrics_context: BackgroundLoader<any>;
    log_categories: BackgroundLoader<any[]>;
    init_instructions: BackgroundLoader<any[]>;
    procedural_instructions: BackgroundLoader<any[]>;
    installed_apps: BackgroundLoader<any[]>;
}

/** Fire prefetch() on every loader. Idempotent (loaders dedupe themselves). */
export function prefetchAll(loaders: StartupLoaders): void {
    for (const loader of Object.values(loaders)) loader.prefetch();
}

/**
 * Inject value into the agent's user_data_input context. Safe to call
 * with a null agent — the data is dropped (loader will not re-inject
 * later because resolve fires once). If your data is needed and the
 * agent might not yet exist, prefetch should be deferred until after
 * the agent is ready.
 */
function injector(deps: StartupLoaderDeps, kind: string) {
    return (value: any) => {
        const agent = deps.agent();
        if (!agent) {
            log(`onResolve(${kind}): agent not yet ready — value dropped from context`);
            return;
        }
        agent.add_user_data_input(value, `bg_${kind}`);
    };
}

export function createStartupLoaders(deps: StartupLoaderDeps): StartupLoaders {
    const i = deps.insights;

    return {
        // Shallow KG (depth-1) for the greeting + first-turn personalization.
        // Depth-2 expansion happens lazily later when the agent calls
        // retrieve_declarative_knowledge for a specific entity.
        user_kg_shallow: createBackgroundLoader({
            id: 'user_kg_shallow',
            fetch: () => search_knowledge_deep('current_user', { depth: 1 }).then((r) => ({
                entities: Array.from(r.expanded.entities.values()).map((e: any) => ({
                    name: e.name, depth: e.depth, distance: e.distance,
                })),
                relations: [...r.seeds.relations, ...r.expanded.relations].map((rel: any) => ({
                    source: rel.sourceName, relation: rel.kind, target: rel.targetName,
                })),
                total_entities: r.totalEntities,
                total_relations: r.totalRelations,
            })).catch(() => ({ entities: [], relations: [], total_entities: 0, total_relations: 0 })),
            onResolve: (value, opts) => {
                injector(deps, 'user_kg')(value);
                // Onboarding cache was previously hydrated by a module-load-time
                // prefetchStartup().then(...) side effect; now it's driven by
                // the loader's resolve event so we share the single fetch.
                hydrateOnboardingFromKG(value);
            },
            insights: i,
        }),

        todos_context: createBackgroundLoader({
            id: 'todos_context',
            fetch: () => fetchTodosContext().catch(() => ({
                overdue: [], due_today: [], upcoming_7d: [], no_date: [], total_active: 0, recurring_due: [],
            })),
            onResolve: injector(deps, 'todos_context'),
            insights: i,
        }),

        metrics_context: createBackgroundLoader({
            id: 'metrics_context',
            fetch: () => fetchMetricsContext().catch(() => ({ tracked_metrics: [], recent_entries: [] })),
            onResolve: injector(deps, 'metrics_context'),
            insights: i,
        }),

        log_categories: createBackgroundLoader({
            id: 'log_categories',
            fetch: () => fetchLogCategories().catch(() => []),
            onResolve: injector(deps, 'log_categories'),
            insights: i,
        }),

        init_instructions: createBackgroundLoader({
            id: 'init_instructions',
            fetch: () => fetchInitInstructions().catch(() => []),
            onResolve: injector(deps, 'init_instructions'),
            insights: i,
        }),

        procedural_instructions: createBackgroundLoader({
            id: 'procedural_instructions',
            fetch: () => fetchProceduralInstructions().catch(() => []),
            onResolve: injector(deps, 'procedural_instructions'),
            insights: i,
        }),

        // Apps: seed builtins (idempotent), list installs, hydrate manifests.
        // Resolves with the structured items so the onResolve can populate
        // both the store (UI subscribes to installedApps) AND the agent
        // context (summaries only — full manifests with HTML/code stay in
        // the appManifestCache).
        installed_apps: createBackgroundLoader<any[]>({
            id: 'installed_apps',
            fetch: async () => {
                await seedBuiltinApps(embed_vector).catch(() => null);
                const installs = await listInstalls();
                const items = await Promise.all(installs.map(async (i) => ({
                    install: i,
                    manifest: await getApp(i.app_id).catch(() => null),
                })));
                return items.filter((x: any) => x.manifest !== null);
            },
            onResolve: (items) => {
                const installs = items.map((x: any) => x.install);
                const cache: Record<string, any> = {};
                for (const x of items) cache[x.install.app_id] = x.manifest;
                useSmartChatsStore.setState({ installedApps: installs, appManifestCache: cache });

                // app_launcher.ts maintains its own installs cache for routing.
                // Was previously hydrated via a module-load prefetchStartup side
                // effect; now shares this loader's single fetch.
                hydrateAppLauncherInstalls(items);

                const agent = deps.agent();
                if (!agent) {
                    log('onResolve(installed_apps): agent not yet ready — context injection skipped');
                    return;
                }
                const summaries = items.map((x: any) => ({
                    id: x.manifest.id,
                    name: x.manifest.name,
                    description: x.manifest.description,
                    icon: x.manifest.icon,
                }));
                agent.add_user_data_input({ installed_apps: summaries }, 'bg_installed_apps');
            },
            insights: i,
        }),
    };
}

// ── Late-bound singleton (module-level access pattern) ──

let _instance: StartupLoaders | null = null;

export function setStartupLoaders(loaders: StartupLoaders | null): void {
    _instance = loaders;
}

/** Returns the active registry, or null if not yet initialized.
 *  Module function fns should call this and fall back to a direct fetch
 *  if it returns null (defensive — shouldn't happen post-mount). */
export function getStartupLoaders(): StartupLoaders | null {
    return _instance;
}
