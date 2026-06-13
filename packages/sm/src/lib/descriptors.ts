/**
 * Explain descriptors per verb.
 *
 * Each descriptor is built lazily from current detected state — so when the
 * user runs `sm explain dev` in the cloud repo with `functions/.env →
 * .env.cloud`, the output highlights the LIVE-keys danger rather than
 * generic doc.
 *
 * Add a new verb? Define its descriptor here. The CLI router just looks it
 * up by name.
 */

import type { Explain, ExplainContext, ExplainToggle } from './explain.js';
import {
    detectRepo,
    readFunctionsEnvSymlink,
    probePorts,
    probeDockerContainer,
} from './context.js';

// ---------------------------------------------------------------------------
// Helpers for shared context probes
// ---------------------------------------------------------------------------

function cloudEnvContext(cloudRoot: string): ExplainContext {
    const env = readFunctionsEnvSymlink(cloudRoot);
    if (env.symlinkTarget === '.env.local-test') {
        return {
            label: 'functions/.env symlink',
            current: '→ .env.local-test',
            impact: 'Stripe sk_test_ key, test webhook secret, points at cloud_test_db. Safe for dev.',
            status: 'ok',
        };
    }
    if (env.symlinkTarget === '.env.cloud') {
        return {
            label: 'functions/.env symlink',
            current: '→ .env.cloud',
            impact: 'LIVE Stripe sk_live_, prod webhook secret, LIVE Surreal. Deploy mode — never run dev against this.',
            status: 'warn',
        };
    }
    return {
        label: 'functions/.env symlink',
        current: env.symlinkTarget,
        impact: 'Functions deploy will fail predeploy check. Run `bin/devserve` once to restore the symlink.',
        status: 'error',
    };
}

function cloudTestDbContext(): ExplainContext {
    const ctr = probeDockerContainer('cloud_test_db');
    return {
        label: 'cloud_test_db container',
        current: ctr.running ? 'running on :8001' : 'not running',
        impact: ctr.running
            ? 'Local-mode Functions hit this Surreal (v3.0.5, cloud schema applied).'
            : 'bin/devserve will auto-start it; bin/test-stripe expects it up.',
        status: ctr.running ? 'ok' : 'warn',
    };
}

function stripeListenContext(): ExplainContext {
    const ports = probePorts([5001]);
    // `stripe listen` doesn't open a listening socket of its own; it tunnels to :5001.
    // Approximate: if :5001 is open AND `stripe` process is running. We only probe :5001 here;
    // a proper probe would parse `ps`, but that's noisy on macOS — keep it simple.
    return {
        label: 'Stripe webhook tunnel',
        current: ports[0].inUse ? 'emulator on :5001 detected (stripe listen unverified)' : 'emulator :5001 down',
        impact: 'bin/test-stripe needs `stripe listen --forward-to http://localhost:5001/...` running in another terminal.',
        status: ports[0].inUse ? 'unknown' : 'warn',
    };
}

function openStackContext(openRoot: string): ExplainContext {
    const ports = probePorts([3000, 4242, 8000]);
    const inUse = ports.filter(p => p.inUse).map(p => p.port);
    if (inUse.length === 0) {
        return {
            label: 'Local stack',
            current: 'not running',
            impact: 'No port conflicts — safe to start any dev mode.',
            status: 'ok',
        };
    }
    return {
        label: 'Local stack',
        current: `in use: ${inUse.join(', ')}`,
        impact: 'Another stack is already up (devserve / aio / test-bun-deploy / smartchats start). Stop it first.',
        status: 'warn',
    };
}

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

function describeStatus(): Explain {
    return {
        verb: 'status',
        summary: 'Read-only snapshot of the current repo + recommended next step.',
        audience: 'maintainer',
        repos: ['open', 'cloud'],
        toggles: [],
        context: [],
        steps: [
            'Detect which repo you are in (open vs cloud) by walking up from cwd.',
            'Read git state: branch, dirty, ahead/behind origin.',
            'Read .synced-from (cloud only) to compare against open\'s HEAD.',
            'Read ~/.smartchats/sm/last-verify-<repo>.json for the last verify result.',
            'Print summary; in later phases will fetch Vercel/Firebase/npm state in parallel.',
        ],
        sideEffects: [
            { kind: 'disk', description: 'Reads ~/.smartchats/sm/last-verify-*.json (no writes).' },
            { kind: 'none', description: 'No network calls in Phase 1.' },
        ],
        gotchas: [
            'Status is local-only in Phase 1. Vercel / Firebase / npm reads land in Phase 4.',
        ],
        seeAlso: ['sm explain verify', 'sm explain dev'],
    };
}

function describeVerify(level?: string): Explain {
    const repo = detectRepo();

    const levelToggle: ExplainToggle = {
        label: 'level',
        current: level ?? 'quick (default)',
        impact: levelImpact(level ?? 'quick'),
        alternatives: [
            { value: 'quick', impact: 'lint + build (L0 + L1). Sub-30s. Safe pre-commit gate.' },
            { value: 'lint', impact: 'L0: turbo run lint. Skipped if no package defines a lint script.' },
            { value: 'build', impact: 'L1: turbo run build = tsc emit. Acts as workspace type-check.' },
            { value: 'unit', impact: 'L2: vitest in every package with a test:unit script.' },
            { value: 'integration', impact: 'L3: spawns surreal --memory on a free port; runs verify_surreal_rpc_path.ts (CBOR vs JSON-RPC divergence check). Closes the STATUS.txt ★ item once promoted.' },
            { value: 'e2e', impact: 'L4: wraps bin/test-e2e. Boots bin/test-bun-deploy (Bun-compiled + native surreal), polls :3000/local-api/health, runs Playwright simi suite, tears down.' },
            { value: 'install', impact: 'L5 (planned): scripts/test-install.sh — builds tarball, serves over HTTP, docker build Dockerfile.aio against local URL.' },
            { value: 'stripe', impact: '(cloud only, planned) bin/test-stripe — 3 Stripe flows in sandbox. Needs Functions emulator + stripe listen tunnel + sk_test_.' },
            { value: 'all', impact: 'Every level applicable to this repo.' },
            { value: 'ci', impact: 'Curated subset CI runs on every push: quick + unit + integration. e2e is opt-in.' },
        ],
    };

    const context: ExplainContext[] = [];
    if (repo.kind === 'open' && repo.root) {
        context.push(openStackContext(repo.root));
        if (level === 'e2e' || level === 'all' || level === 'install') {
            // These need the docker daemon + bun.
            const docker = probeDockerContainer('___sentinel_never_matches___');
            context.push({
                label: 'Docker daemon',
                current: docker.running ? 'reachable' : 'reachable or down (probe is a no-op sentinel)',
                impact: 'install level needs Docker; e2e does NOT need Docker (uses native binaries via test-bun-deploy).',
                status: 'unknown',
            });
        }
    }
    if (repo.kind === 'cloud' && repo.root) {
        context.push(cloudEnvContext(repo.root));
        if (level === 'stripe') {
            context.push(cloudTestDbContext());
            context.push(stripeListenContext());
        }
    }

    return {
        verb: 'verify' + (level ? ` ${level}` : ''),
        summary: 'Run tests at the chosen scope. Wraps smartchats-test levels + e2e + install + stripe.',
        audience: 'maintainer',
        repos: ['open', 'cloud'],
        toggles: [levelToggle],
        context,
        steps: stepsForVerify(level ?? 'quick'),
        sideEffects: sideEffectsForVerify(level ?? 'quick'),
        gotchas: [
            '`quick` runs lint + build only; never use it alone before a deploy.',
            'L4 e2e needs port 3000 free — stop any running dev stack first.',
            'L4 boots its own surreal + server (test-bun-deploy); no infra setup required.',
            '`stripe` (cloud) needs TWO prerequisite terminals: bin/devserve + `stripe listen`. Run `sm explain verify stripe` in the cloud repo for details.',
            'Last verify result is cached at ~/.smartchats/sm/last-verify-<repo>.json — checked by `sm ship` before deploying.',
        ],
        seeAlso: ['sm explain dev', 'sm explain ship'],
    };
}

function levelImpact(level: string): string {
    switch (level) {
        case 'quick': return 'lint + build only. Fast pre-commit; not a deploy gate.';
        case 'lint': return 'turbo run lint across packages that define a lint script.';
        case 'build': return 'turbo run build — type-checks via tsc emit.';
        case 'unit': return 'vitest in every package with a test:unit script.';
        case 'integration': return 'Self-managed surreal --memory + wire-format integration tests.';
        case 'e2e': return 'Full Playwright simi suite against a freshly-booted native-binary stack.';
        case 'install': return 'Tarball build + Docker AIO install rehearsal.';
        case 'stripe': return 'Sandbox Stripe lifecycle test (cloud repo only).';
        case 'all': return 'Everything applicable in this repo.';
        case 'ci': return 'Curated CI set: quick + unit + integration.';
        default: return `Custom level: ${level}.`;
    }
}

function stepsForVerify(level: string): string[] {
    switch (level) {
        case 'quick':
            return [
                'turbo run lint --continue (skipped if no package has a lint script)',
                'turbo run build (emits dist/ + .next/, doubles as type-check)',
                'Write result to ~/.smartchats/sm/last-verify-<repo>.json',
            ];
        case 'unit':
            return [
                'Enumerate packages with a test:unit script',
                'For each: npm run test:unit (vitest)',
                'Write result to cache file',
            ];
        case 'integration':
            return [
                'Spawn `surreal start --memory` on a free random port',
                'Run packages/smartchats-cloud/scripts/verify_surreal_rpc_path.ts (open: stub; cloud: real)',
                'Tear down surreal subprocess via try/finally',
                'Write result to cache file',
            ];
        case 'e2e':
            return [
                'Preflight: check :3000 is free',
                'Spawn bin/test-bun-deploy in background (boots native surreal + bun-compiled server)',
                'Poll http://localhost:3000/local-api/health until ready (120s timeout)',
                'Bootstrap .auth/test-profile/ if missing (setup-test-profile.spec.ts)',
                'Run Playwright simi suite (workers configurable)',
                'Teardown: kill bun + surreal children via signal trap',
                'Write result to cache file',
            ];
        case 'install':
            return [
                'scripts/build-release.sh — produce platform tarball',
                'Start python3 http.server in tmp dir serving install.sh + tarball',
                'docker build Dockerfile.aio with build-args pointing at the local URL',
                'Run container, poll /local-api/health',
                'Print container logs on failure',
            ];
        case 'stripe':
            return [
                'Preflight: Functions emulator on :5001, sk_test_ in env, `stripe listen` tunnel up',
                'Run packages/smartchats-cloud/scripts/test_stripe.ts',
                '  - idempotency test (resend event)',
                '  - subscription lifecycle (create → cancel)',
                '  - tier change (lookup_key reverse-map)',
                'Append to data/logs/stripe-test.log',
            ];
        case 'all':
            return [
                'Run lint → build → unit → integration → e2e in sequence.',
                'In cloud repo: also stripe.',
                'Stop on first failure unless --continue-on-failure.',
            ];
        case 'ci':
            return [
                'Curated set CI runs on every push.',
                'lint + build + unit + integration. e2e is opt-in via workflow_dispatch.',
            ];
        default:
            return [`Run smartchats-test level: ${level}`];
    }
}

function sideEffectsForVerify(level: string): Explain['sideEffects'] {
    const base: Explain['sideEffects'] = [
        { kind: 'disk', description: 'Writes ~/.smartchats/sm/last-verify-<repo>.json' },
    ];
    switch (level) {
        case 'quick':
        case 'lint':
        case 'build':
            return [{ kind: 'disk', description: 'Emits dist/, .next/, turbo cache' }, ...base];
        case 'unit':
            return [{ kind: 'disk', description: 'vitest cache' }, ...base];
        case 'integration':
            return [
                { kind: 'process', description: 'Spawns + tears down surreal --memory' },
                ...base,
            ];
        case 'e2e':
            return [
                { kind: 'process', description: 'Spawns + tears down: surreal + bun server + Playwright workers' },
                { kind: 'disk', description: 'Playwright reports in .playwright/' },
                ...base,
            ];
        case 'install':
            return [
                { kind: 'network', description: 'Pulls debian:bookworm-slim, fetches SurrealDB binary inside container' },
                { kind: 'process', description: 'Builds + runs Docker container; local HTTP server in tmp dir' },
                ...base,
            ];
        case 'stripe':
            return [
                { kind: 'network', description: 'Stripe API calls (sandbox only, never live)' },
                { kind: 'disk', description: 'Appends to data/logs/stripe-test.log' },
                ...base,
            ];
        default:
            return base;
    }
}

function describeDev(): Explain {
    const repo = detectRepo();
    const toggles: ExplainToggle[] = [];
    const context: ExplainContext[] = [];

    if (repo.kind === 'open') {
        toggles.push({
            label: 'target (open repo)',
            current: 'surreal (bin/devserve default)',
            impact: 'SurrealDB in Docker on :8000 + Express on :4242 + Next.js dev :3000 with HMR. Hot-reload across the workspace.',
            alternatives: [
                { value: 'aio', impact: 'Delegates to bin/aio: full Docker AIO container, production-style. Slower iteration but closer to deploy artifact.' },
                { value: '(test-bun-deploy)', impact: 'Native binaries via bin/test-bun-deploy. Not a "dev" mode — used by e2e and as install rehearsal.' },
            ],
        });
        if (repo.root) context.push(openStackContext(repo.root));
        context.push({
            label: 'SurrealDB version',
            current: 'Docker image pinned in bin/devserve (3.0.5)',
            impact: 'Cloud production runs 3.1.2 — wire-format bug from 2026-06-04 is the kind of divergence this mismatch can mask.',
            status: 'warn',
        });
    } else if (repo.kind === 'cloud') {
        toggles.push({
            label: 'target (cloud repo, bin/devserve --target=)',
            current: 'local-test (default)',
            impact: 'Functions emulator points at cloud_test_db on :8001. Stripe sk_test_. Safe sandbox.',
            alternatives: [
                { value: 'cloud', impact: '⚠ Functions emulator points at LIVE production Surreal. Uses sk_live_ (.env.cloud must be symlinked). Dangerous — never use for routine dev.' },
            ],
        });
        toggles.push({
            label: 'sync-from-open',
            current: 'runs first (unless --no-sync)',
            impact: 'rsyncs open packages + apps into the cloud vendored tree. Writes .synced-from.',
        });
        if (repo.root) {
            context.push(cloudEnvContext(repo.root));
            context.push(cloudTestDbContext());
            // probe emulator + next ports
            const ports = probePorts([3000, 5001]);
            context.push({
                label: 'Ports 3000 / 5001',
                current: ports.map(p => `:${p.port}=${p.inUse ? 'in use' : 'free'}`).join(', '),
                impact: 'devserve will refuse to boot if either is in use. Run `bin/kill-dev` to clear.',
                status: ports.some(p => p.inUse) ? 'warn' : 'ok',
            });
        }
    }

    return {
        verb: 'dev',
        summary: 'Start the dev environment for this repo.',
        audience: 'maintainer',
        repos: ['open', 'cloud'],
        toggles,
        context,
        steps: stepsForDev(repo.kind),
        sideEffects: sideEffectsForDev(repo.kind),
        gotchas: gotchasForDev(repo.kind),
        seeAlso: ['sm explain verify', 'sm explain status'],
    };
}

function stepsForDev(repo: 'open' | 'cloud' | 'unknown'): string[] {
    if (repo === 'open') {
        return [
            'Delegate to bin/devserve (with --target=surreal by default).',
            'Start SurrealDB container on :8000.',
            'Run apps/smartchats prebuild (site + assets).',
            'Start Express server on :4242.',
            'Start Next.js dev server on :3000 with HMR.',
        ];
    }
    if (repo === 'cloud') {
        return [
            'bin/sync-from-open (unless --no-sync) — rsync open into vendored tree.',
            'Start cloud_test_db container on :8001 (unless --no-db or --target=cloud).',
            'Start Firebase Functions emulator on :5001.',
            'Start Next.js dev server on :3000.',
        ];
    }
    return ['(no repo detected — sm dev only works inside open or cloud repo)'];
}

function sideEffectsForDev(repo: 'open' | 'cloud' | 'unknown'): Explain['sideEffects'] {
    if (repo === 'open') {
        return [
            { kind: 'process', description: 'Long-running: surreal container + Express + Next.js dev' },
            { kind: 'disk', description: 'data/logs/, .next/, prebuild outputs' },
            { kind: 'network', description: 'Pulls SurrealDB Docker image on first run' },
        ];
    }
    if (repo === 'cloud') {
        return [
            { kind: 'disk', description: 'Vendored open packages, .synced-from, data/logs/' },
            { kind: 'process', description: 'Long-running: cloud_test_db + Functions emulator + Next.js dev' },
            { kind: 'network', description: 'sync-from-open reads from local open clone (no network); SurrealDB image pull on first run' },
        ];
    }
    return [{ kind: 'none', description: '(no repo)' }];
}

function gotchasForDev(repo: 'open' | 'cloud' | 'unknown'): string[] {
    if (repo === 'open') {
        return [
            'bin/devserve --target=aio is a different beast: full Docker AIO (no HMR). Use that to reproduce deploy issues.',
            'apps/smartchats/lint script was dropped — type-checking happens via build.',
            'Surreal version pin (3.0.5) does not match cloud production (3.1.2).',
        ];
    }
    if (repo === 'cloud') {
        return [
            'If functions/.env points at .env.cloud, `bin/devserve` will refuse — it expects local-test for dev.',
            'Stripe webhook testing requires a SEPARATE terminal running `stripe listen --forward-to http://localhost:5001/...` — sm dev does not start this.',
            '--target=cloud points the LOCAL Functions emulator at LIVE production Surreal. Never use for routine dev.',
            'cloud_test_db container persists data across restarts; use `bin/cloud_test_db --reset` to wipe.',
            '`bin/kill-dev` is the right cleanup tool if devserve hangs — clears ports 3000 / 5001 / 4400 / 4500 / 8080 / 9099.',
        ];
    }
    return ['Run from inside an open or cloud repo.'];
}

function describeDoctor(): Explain {
    return {
        verb: 'doctor',
        summary: 'Environment health check for this repo.',
        audience: 'maintainer',
        repos: ['open', 'cloud'],
        toggles: [],
        context: [],
        steps: [
            'Open repo: delegate to `smartchats doctor` (CLI).',
            'Cloud repo: planned — check firebase login, .env files exist, ports free, stripe CLI present, sync state, surreal reachable.',
        ],
        sideEffects: [{ kind: 'none', description: 'Read-only checks.' }],
        gotchas: [
            'Open-repo doctor exists today; cloud-repo doctor is Phase-later.',
        ],
        seeAlso: ['sm explain status'],
    };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function getExplain(verb: string, sub?: string): Explain | null {
    const head = verb.toLowerCase();
    switch (head) {
        case 'status':
            return describeStatus();
        case 'verify':
            return describeVerify(sub);
        case 'dev':
            return describeDev();
        case 'doctor':
            return describeDoctor();
        default:
            return null;
    }
}

export function listVerbs(): Array<{ verb: string; summary: string }> {
    return [
        { verb: 'status', summary: describeStatus().summary },
        { verb: 'verify', summary: describeVerify().summary },
        { verb: 'dev', summary: describeDev().summary },
        { verb: 'doctor', summary: describeDoctor().summary },
    ];
}
