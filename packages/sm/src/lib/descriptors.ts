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
        current: level ?? 'all (default)',
        impact: levelImpact(level ?? 'all'),
        alternatives: [
            { value: 'all', impact: 'L0 → L4 applicable to this repo: quick + unit + integration + e2e. Full pre-ship gate; what `sm verify` runs by default.' },
            { value: 'quick', impact: 'lint + build (L0 + L1). Sub-30s. Fast pre-commit gate.' },
            { value: 'lint', impact: 'L0: turbo run lint. Skipped if no package defines a lint script.' },
            { value: 'build', impact: 'L1: turbo run build = tsc emit. Acts as workspace type-check.' },
            { value: 'unit', impact: 'L2: vitest in every package with a test:unit script.' },
            { value: 'integration', impact: 'L3: spawns surreal --memory on a free port; runs verify_surreal_rpc_path.ts (CBOR vs JSON-RPC divergence check). Closes the STATUS.txt ★ item once promoted.' },
            { value: 'e2e', impact: 'L4: wraps bin/test-e2e. Boots bin/test-bun-deploy (Bun-compiled + native surreal), polls :3000/local-api/health, runs Playwright simi suite, tears down.' },
            { value: 'install', impact: 'L5 (planned): scripts/test-install.sh — builds tarball, serves over HTTP, docker build Dockerfile.aio against local URL.' },
            { value: 'stripe', impact: '(cloud only) bin/test-stripe — 3 Stripe flows in sandbox. Opt-in; needs Functions emulator + stripe listen tunnel + sk_test_.' },
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
        steps: stepsForVerify(level ?? 'all'),
        sideEffects: sideEffectsForVerify(level ?? 'all'),
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

// ---------------------------------------------------------------------------
// Phase 2: action verbs
// ---------------------------------------------------------------------------

function describeSync(): Explain {
    const repo = detectRepo();
    const context: ExplainContext[] = [];
    const openHome = process.env.SMARTCHATS_PATH ?? `${process.env.HOME}/dev/smartchats`;
    context.push({
        label: '$SMARTCHATS_PATH (open repo)',
        current: openHome,
        impact: 'rsync source. Must be a valid git checkout.',
        status: 'ok',
    });
    if (repo.kind === 'cloud' && repo.root) {
        context.push(cloudEnvContext(repo.root));
    }
    return {
        verb: 'sync',
        summary: 'rsync open packages + app into the cloud vendored tree.',
        audience: 'maintainer',
        repos: ['cloud'],
        toggles: [
            {
                label: '--dry-run',
                current: 'off',
                impact: 'Off: actually rsync. On: print what would happen, no writes.',
            },
            {
                label: '--no-install',
                current: 'off',
                impact: 'Off: runs npm install after sync (slower but consistent). On: skips install.',
            },
        ],
        context,
        steps: [
            'rsync open/packages/* into this repo packages/ (vendored)',
            'rsync open/apps/smartchats/ into apps/smartchats/',
            'rsync overlays/smartchats-app/ on top (closed-only overrides win)',
            'npm install (unless --no-install)',
            'Write .synced-from with open SHA, subject, timestamp, captured commits',
        ],
        sideEffects: [
            { kind: 'disk', description: 'Overwrites vendored packages/* and apps/smartchats/ files. Updates .synced-from.' },
            { kind: 'process', description: 'npm install (unless --no-install)' },
        ],
        gotchas: [
            'Anything in vendored packages/* that is NOT in open will be DELETED by rsync.',
            'Overlay shadowing: overlays/smartchats-app/ ALWAYS wins after the open sync — edit there for closed-only changes.',
            'Open uncommitted changes ARE synced (rsync looks at the working tree, not git HEAD).',
        ],
        seeAlso: ['sm explain ship', 'sm explain deploy'],
    };
}

function describeDeploy(target?: string): Explain {
    const repo = detectRepo();
    const context: ExplainContext[] = [];
    if (repo.kind === 'cloud' && repo.root) {
        context.push(cloudEnvContext(repo.root));
    }

    const targetToggle: ExplainToggle = {
        label: 'target',
        current: target ?? '(none — specify)',
        impact: target ? deployTargetImpact(target) : 'Pick one of: functions / frontend / schema / all',
        alternatives: [
            { value: 'functions', impact: 'Firebase Functions + Firestore indexes via bin/deploy-functions (forces .env→.env.cloud, type-checks, firebase deploy).' },
            { value: 'frontend', impact: 'git push origin main (Vercel auto-deploys within ~1 min).' },
            { value: 'schema', impact: 'SurrealDB DDL apply. Defaults to --dry-run; needs --apply to commit. Requires SMARTCHATS_CLOUD_* root creds in env.' },
            { value: 'all', impact: 'functions, then frontend. Bails on first failure.' },
        ],
    };

    return {
        verb: 'deploy' + (target ? ` ${target}` : ''),
        summary: 'Deploy a specific target. Preflights before doing anything destructive.',
        audience: 'maintainer',
        repos: ['cloud'],
        toggles: [targetToggle],
        context,
        steps: stepsForDeploy(target),
        sideEffects: sideEffectsForDeploy(target),
        gotchas: gotchasForDeploy(target),
        seeAlso: ['sm explain ship', 'sm explain rollback'],
    };
}

function deployTargetImpact(target: string): string {
    switch (target) {
        case 'functions': return 'Wraps bin/deploy-functions. Forces .env→.env.cloud, type-checks, firebase deploy. LIVE keys, LIVE Surreal.';
        case 'frontend': return 'git push origin main. Vercel watches origin/main and auto-deploys.';
        case 'schema': return 'npm run schema:apply against SMARTCHATS_CLOUD_*. --dry-run by default; --apply to commit (irreversible).';
        case 'all': return 'functions + frontend in sequence.';
        default: return `Custom target: ${target}`;
    }
}

function stepsForDeploy(target?: string): string[] {
    switch (target) {
        case 'functions':
            return [
                'Preflight: on main, tree clean, last verify fresh + on current HEAD, .env→.env.cloud (or warn).',
                'Confirm.',
                'bin/deploy-functions: rebuild functions/lib, then ./deploy (forces .env→.env.cloud, type-checks, firebase deploy --only functions,firestore:indexes).',
            ];
        case 'frontend':
            return [
                'Preflight: on main, tree clean, ahead of origin.',
                'Confirm.',
                'git push origin main → Vercel watches origin/main and auto-deploys within ~1 min.',
            ];
        case 'schema':
            return [
                'Preflight: all SMARTCHATS_CLOUD_* env vars set. Mode (--dry-run default vs --apply).',
                'Confirm.',
                'npm run schema:apply (with --dry-run unless --apply).',
                'Reads version stamp, applies any new migrations idempotently.',
            ];
        case 'all':
            return [
                'sm deploy functions (with its own preflight).',
                'If pass: sm deploy frontend.',
                'Bails on first failure — frontend is NOT pushed if functions fail.',
            ];
        default:
            return ['Pick a target: functions / frontend / schema / all.'];
    }
}

function sideEffectsForDeploy(target?: string): Explain['sideEffects'] {
    switch (target) {
        case 'functions':
            return [
                { kind: 'network', description: 'Firebase API calls (auth + deploy)' },
                { kind: 'deploy', description: 'Replaces LIVE production Functions + Firestore indexes' },
                { kind: 'disk', description: 'functions/.env symlink forced to .env.cloud' },
            ];
        case 'frontend':
            return [
                { kind: 'git', description: 'git push origin main' },
                { kind: 'deploy', description: 'Vercel watches the push and auto-deploys (async)' },
            ];
        case 'schema':
            return [
                { kind: 'network', description: 'WebSocket/HTTPS to SMARTCHATS_CLOUD_URL with root creds' },
                { kind: 'deploy', description: '--apply: idempotent DDL changes against LIVE Surreal (irreversible)' },
            ];
        case 'all':
            return [
                { kind: 'deploy', description: 'See deploy functions + deploy frontend' },
            ];
        default:
            return [{ kind: 'none', description: '(no target)' }];
    }
}

function gotchasForDeploy(target?: string): string[] {
    switch (target) {
        case 'functions': return [
            'bin/deploy-functions FORCES .env→.env.cloud — if you had it on .env.local-test for dev, you must re-symlink it back after deploy.',
            'firebase.json has a predeploy assertion as backstop; deploy refuses if .env isn\'t .env.cloud.',
            'Type-check failure in functions/src will abort BEFORE shipping (good — calculateCost NaN incident of 2026-06-09 motivated this).',
            'Vercel is NOT touched by this deploy. Use `sm deploy all` for both.',
        ];
        case 'frontend': return [
            'This is `git push`, not `vercel deploy` — Vercel watches the git source and deploys async.',
            'No way to dry-run; use `git push --dry-run` directly to preview.',
            'Functions are NOT touched. Use `sm deploy all` for both.',
        ];
        case 'schema': return [
            'No rollback. Schema migrations are idempotent only — `--apply` against the wrong DB is unrecoverable.',
            'Test on cloud_test_db first via `bin/devserve` (cloud_test_db applies schema on boot).',
            'Production: needs SMARTCHATS_CLOUD_URL/USER/PASSWORD + SMARTCHATS_CLOUD_USER_AUTH_SECRET — read packages/smartchats-cloud/.env.cloud for values.',
        ];
        case 'all': return [
            'Functions deploy first. If it fails, frontend is NOT pushed (avoids a half-deploy where Vercel ships against old Functions).',
            'If functions succeed but frontend push fails: Functions ARE LIVE — you can re-push or fix manually.',
        ];
        default: return [];
    }
}

function describeShip(): Explain {
    const repo = detectRepo();
    const context: ExplainContext[] = [];
    if (repo.kind === 'cloud' && repo.root) {
        context.push(cloudEnvContext(repo.root));
    }
    return {
        verb: 'ship',
        summary: 'Full deploy: sync → verify ci → deploy functions → deploy frontend.',
        audience: 'maintainer',
        repos: ['cloud'],
        toggles: [
            {
                label: '--quick-verify',
                current: 'off',
                impact: 'Off: verify ci (quick + unit + integration, ~2 min). On: verify quick (lint + build, ~30s).',
            },
            {
                label: '--skip-verify',
                current: 'off',
                impact: 'Off: verify runs. On: verify SKIPPED entirely (debugging only).',
            },
        ],
        context,
        steps: [
            'sm sync (rsync open → cloud)',
            'sm verify ci (or quick / skipped per flags)',
            'sm deploy functions (firebase deploy, with its own preflight)',
            'sm deploy frontend (git push origin main, Vercel auto-deploys)',
        ],
        sideEffects: [
            { kind: 'disk', description: 'sync writes vendored tree' },
            { kind: 'deploy', description: 'LIVE Functions + Vercel deploys' },
            { kind: 'git', description: 'git push origin main' },
        ],
        gotchas: [
            'Each downstream step preflights itself; bail-on-failure is automatic.',
            'If functions succeed but frontend push fails, Functions are LIVE — re-run `sm deploy frontend`.',
            '--skip-verify exists for emergencies; the default (ci) is what you want.',
        ],
        seeAlso: ['sm explain deploy', 'sm explain rollback'],
    };
}

function describeShipFull(): Explain {
    const repo = detectRepo();
    const context: ExplainContext[] = [];
    if (repo.kind === 'cloud' && repo.root) {
        context.push(cloudEnvContext(repo.root));
        const ports = probePorts([3000]);
        context.push({
            label: 'Port 3000 (e2e needs free)',
            current: ports[0].inUse ? 'in use — e2e will refuse' : 'free',
            impact: ports[0].inUse ? 'Step 4 (verify e2e) boots bin/test-bun-deploy on :3000. Stop the running stack first.' : 'OK for e2e to boot bun stack.',
            status: ports[0].inUse ? 'warn' : 'ok',
        });
    }
    return {
        verb: 'ship-full',
        summary: 'Comprehensive prod orchestrator: sync + verify ci + verify e2e + schema apply (if drift) + deploy functions + probe + push + Vercel wait + probe.',
        audience: 'maintainer',
        repos: ['cloud'],
        toggles: [
            { label: '--skip-e2e', current: 'off', impact: 'Off: verify e2e runs (~10 min). On: skipped — only when e2e infra is broken, not when code is suspect.' },
            { label: '--skip-schema', current: 'off', impact: 'Off: schema applies if drift detected. On: schema apply skipped — only if already applied manually.' },
        ],
        context,
        steps: [
            'Preflight: on main, clean tree, sync state, e2e infra ready, schema drift detected.',
            'Confirm (with --yes for CI).',
            'sm sync from open (SKIPPED if .synced-from already on open HEAD).',
            'sm verify ci — lint + build + unit + integration.',
            'sm verify e2e — full bun stack + Playwright simi suite. (--skip-e2e to bypass).',
            'Schema apply if drift detected: dry-run, then --apply. (--skip-schema to bypass).',
            'sm deploy functions — firebase deploy.',
            'Probe functions health URL ($SM_PROBE_FUNCTIONS_URL).',
            'sm deploy frontend — git push origin main.',
            'Poll production URL until healthy (up to 5 min, every 15s).',
            'Print summary with phase durations + live URLs to spot-check.',
        ],
        sideEffects: [
            { kind: 'process', description: 'Long-running: surreal + bun + Playwright workers spawn during e2e' },
            { kind: 'deploy', description: 'LIVE: Functions + (maybe) schema + Vercel frontend' },
            { kind: 'network', description: 'Firebase API + Vercel + production URLs probed' },
            { kind: 'git', description: 'git push origin main' },
        ],
        gotchas: [
            'Estimated wall time: 20-30 min when nothing is cached. Plan accordingly.',
            'If e2e fails: NOTHING is deployed. Investigate the failure first.',
            'If functions probe fails: Functions ARE LIVE but unreachable. Investigate before pushing frontend.',
            'If Vercel wait times out: deploy is async — check vercel.com/dashboard manually. Frontend may still go green after the 5-min budget.',
            'Schema apply has NO rollback — `--apply` against the wrong DB is unrecoverable. Use `sm ship` instead for non-schema deploys.',
            'Probe URLs default to https://us-central1-tidyscripts.cloudfunctions.net/testAuth and https://smartchats.ai/. Override via $SM_PROBE_FUNCTIONS_URL / $SM_PROBE_FRONTEND_URL.',
        ],
        seeAlso: ['sm explain ship', 'sm explain deploy', 'sm explain rollback'],
    };
}

function describeRollback(target?: string): Explain {
    return {
        verb: 'rollback' + (target ? ` ${target}` : ''),
        summary: 'Roll back a deployed target.',
        audience: 'maintainer',
        repos: ['cloud'],
        toggles: [
            {
                label: 'target',
                current: target ?? '(none — specify)',
                impact: target === 'functions'
                    ? 'Guided: lists recent commits touching functions/, you check out an earlier SHA and re-deploy.'
                    : target === 'frontend'
                        ? 'Delegates to `vercel rollback` (interactive list + prompt).'
                        : 'Pick: functions or frontend.',
                alternatives: [
                    { value: 'functions', impact: 'No single-command rollback; guided manual SHA-based redeploy.' },
                    { value: 'frontend', impact: 'Native `vercel rollback` — fast, supported.' },
                ],
            },
        ],
        context: [],
        steps: target === 'functions'
            ? [
                'Show last 10 commits touching packages/smartchats-cloud/functions/.',
                'Instruct: git checkout <sha> && sm deploy functions && git checkout main.',
            ]
            : target === 'frontend'
                ? [
                    'Delegate to `vercel rollback` (interactive).',
                ]
                : ['Pick a target.'],
        sideEffects: target === 'functions'
            ? [{ kind: 'none', description: 'Guided steps only; you run the deploy yourself.' }]
            : target === 'frontend'
                ? [{ kind: 'deploy', description: 'Promotes an earlier Vercel deployment to production.' }]
                : [],
        gotchas: target === 'functions'
            ? [
                'Firebase Functions has no atomic rollback — you re-deploy an earlier git state.',
                'After rollback, `git checkout main` and decide: fix forward, or commit a revert.',
            ]
            : target === 'frontend'
                ? ['Database / Functions stay as-is — only the Vercel frontend rolls back.']
                : [],
    };
}

function describeRelease(): Explain {
    return {
        verb: 'release',
        summary: 'Bump packages/smartchats-cli version + tag. Optionally push tags to trigger release.yml.',
        audience: 'maintainer',
        repos: ['open'],
        toggles: [
            { label: '--push-tags', current: 'off', impact: 'Off: bin/release just creates the tag locally. On: git push --follow-tags afterward — fires release.yml workflow.' },
            { label: '--npm', current: 'off', impact: 'Off: CI publishes via OIDC after tag push. On: publish to npm directly (manual / testing / hotfix).' },
        ],
        context: [],
        steps: [
            'Preflight: clean tree, on main.',
            'Confirm.',
            'bin/release <version>: validates semver, bumps packages/smartchats-cli/package.json, commits, tags.',
            '(if --push-tags) git push --follow-tags — fires .github/workflows/release.yml.',
        ],
        sideEffects: [
            { kind: 'git', description: 'Creates commit + annotated tag.' },
            { kind: 'deploy', description: '(if --push-tags) triggers GitHub Actions: 5-platform tarball matrix + npm publish' },
        ],
        gotchas: [
            'No `--push` from bin/release per project rule; sm release adds it explicitly behind --push-tags.',
            'Once tag is pushed, release.yml runs unattended — npm publish happens automatically.',
            'Use --npm for hotfix flows when you do not want to push the tag yet.',
        ],
        seeAlso: ['sm explain push-public'],
    };
}

function describePushPublic(): Explain {
    return {
        verb: 'push-public',
        summary: 'Routine git push origin main from the open repo.',
        audience: 'maintainer',
        repos: ['open'],
        toggles: [],
        context: [],
        steps: [
            'Preflight: on main, clean tree, ahead of origin.',
            'Confirm.',
            'git push origin main → github.com/sheunaluko/smartchats',
        ],
        sideEffects: [
            { kind: 'git', description: 'Publishes local commits to the public repo.' },
        ],
        gotchas: [
            'Not a force push. If origin has diverged, this errors — investigate before resolving.',
        ],
        seeAlso: ['sm explain release'],
    };
}

function describeTriage(): Explain {
    const repo = detectRepo();
    return {
        verb: 'triage',
        summary: 'End-to-end error session triage (local AIO or cloud Surreal).',
        audience: 'maintainer',
        repos: ['open', 'cloud'],
        toggles: [
            {
                label: 'target',
                current: repo.kind === 'open' ? 'local (default in open repo)' : repo.kind === 'cloud' ? 'cloud (default in cloud repo)' : '(specify local | cloud)',
                impact: 'local: bin/triage-local against local AIO DB. cloud: bin/triage-cloud against production Surreal.',
                alternatives: [
                    { value: 'local', impact: 'bin/triage-local — needs local AIO running.' },
                    { value: 'cloud', impact: 'bin/triage-cloud — needs cloud creds reachable.' },
                ],
            },
        ],
        context: [],
        steps: [
            'find-sessions --has-error --since <window> (default: 30d)',
            'Skip session_ids whose bundle is already on disk (--force re-pulls)',
            'save-session for each missing id',
            'triage:errors over the bundle dir (HTML report)',
        ],
        sideEffects: [
            { kind: 'network', description: 'Cloud target: WebSocket/HTTPS to production Surreal' },
            { kind: 'disk', description: 'Bundles written to ~/.smartchats/{session_bundles, cloud_sessions/cloud}' },
        ],
        gotchas: [
            'Cloud triage needs root creds resolvable by packages/smartchats-cloud (its .env).',
            'jq must be installed (used to read session_id from existing bundles).',
        ],
    };
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
        case 'status':       return describeStatus();
        case 'verify':       return describeVerify(sub);
        case 'dev':          return describeDev();
        case 'doctor':       return describeDoctor();
        case 'sync':         return describeSync();
        case 'deploy':       return describeDeploy(sub);
        case 'ship':         return describeShip();
        case 'ship-full':    return describeShipFull();
        case 'rollback':     return describeRollback(sub);
        case 'release':      return describeRelease();
        case 'push-public':  return describePushPublic();
        case 'triage':       return describeTriage();
        default:             return null;
    }
}

export function listVerbs(): Array<{ verb: string; summary: string }> {
    return [
        { verb: 'status',      summary: describeStatus().summary },
        { verb: 'verify',      summary: describeVerify().summary },
        { verb: 'dev',         summary: describeDev().summary },
        { verb: 'doctor',      summary: describeDoctor().summary },
        { verb: 'sync',        summary: describeSync().summary },
        { verb: 'deploy',      summary: describeDeploy().summary },
        { verb: 'ship',        summary: describeShip().summary },
        { verb: 'ship-full',   summary: describeShipFull().summary },
        { verb: 'rollback',    summary: describeRollback().summary },
        { verb: 'release',     summary: describeRelease().summary },
        { verb: 'push-public', summary: describePushPublic().summary },
        { verb: 'triage',      summary: describeTriage().summary },
    ];
}
