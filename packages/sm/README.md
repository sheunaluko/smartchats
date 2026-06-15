# sm — maintainer CLI

One verb grammar, shared across the open (`smartchats`) and cloud
(`smartchats-cloud`) repos. `sm` walks up from cwd to detect which repo it's
in, then dispatches to the right implementation.

**Audience:** maintainer. The end-user CLI is `smartchats` (in `packages/smartchats-cli`).
They live side-by-side and don't overlap.

```bash
sm                  # status + recommended next verbs (default; bare invocation)
sm -h               # categorized verb list
sm explain          # flat list with one-line summaries
sm explain <verb>   # verbose state-aware description of one verb
```

## Why this exists

Before `sm`, the same intent had 5–7 different entry points across the two
repos (e.g. `bin/aio` vs `bin/devserve` vs `bin/test-bun-deploy` vs `smartchats start`
vs `smartchats dev`). Each took different flags, had different audience
assumptions, and lived in different naming conventions. `sm` is the unified
surface that hides those distinctions behind one grammar.

`sm` doesn't replace the underlying scripts — `bin/aio`, `bin/devserve`,
`bin/deploy-functions`, etc. all stay in place. `sm` is the discoverable
front door that knows when to call which.

## Verbs

| Verb | Repos | What it does |
|---|---|---|
| `status` | both | Read-only snapshot + recommended next verbs. Bare `sm` is an alias. |
| `verify [level]` | both | Run tests. Levels: `quick`/`lint`/`build`/`unit`/`integration`/`e2e`/`install`/`stripe`/`all`/`ci` |
| `dev` | both | Start the dev environment for this repo (open → `bin/devserve --target=surreal`; cloud → `bin/devserve --target=local-test`) |
| `doctor` | both | Environment health check |
| `explain <verb>` | both | Verbose state-aware description of a verb |
| `triage [local\|cloud]` | both | End-to-end error session triage (wraps `bin/triage-local` / `bin/triage-cloud`) |
| `sync` | cloud | rsync open packages + app into cloud vendored tree (`bin/sync-from-open`) |
| `deploy <target>` | cloud | Deploy `functions` / `frontend` / `schema` / `all`. Each preflights + confirms. |
| `ship` | cloud | Standard chain: sync + verify ci + deploy functions + push frontend (~5 min) |
| `ship-full` | cloud | Comprehensive chain: + verify e2e + schema apply (if drift) + post-deploy probes (~25 min) |
| `rollback <target>` | cloud | `functions` (guided SHA-based redeploy) or `frontend` (vercel rollback) |
| `release [vX.Y.Z]` | open | Bump `smartchats-cli` + tag. Auto-detects next version (patch bump from `package.json`); `--minor` / `--major` / explicit `vX.Y.Z` to override. `--push-tags` fires `release.yml`. |
| `push-public` | open | Routine `git push origin main` (publishes to public repo) |

## Examples

```bash
# Awareness
sm                                # what's the state? what should I do next?
sm explain ship-full              # comprehensive ship — what does it actually do here?
sm explain deploy schema          # this one's irreversible; show me everything

# Verify (level controls scope)
sm verify                         # all — full pre-ship gate (quick + unit + integration + e2e, ~12 min)
sm verify quick                   # lint + build only (~30s) — fast pre-commit gate
sm verify ci                      # quick + unit + integration (~2 min) — CI default
sm verify e2e                     # full bun stack + Playwright simi suite (~10 min)
sm verify stripe                  # cloud-repo Stripe lifecycle (opt-in; needs prereq terminals)

# Cloud deploys (all preflight + confirm)
sm sync                           # rsync from open
sm deploy functions               # firebase deploy
sm deploy schema                  # dry-run (default)
sm deploy schema --apply --yes    # commit schema (irreversible; --yes skips prompt)

# Single-command ship
sm ship                           # routine — sync + verify ci + deploy + push
sm ship-full                      # heavy — adds e2e + schema apply + post-deploy probes
sm ship-full --skip-e2e           # only when e2e infra is broken, not when code is suspect

# Open release
sm release --push-tags            # auto-detect next patch version + bump + tag + push
sm release v0.3.3 --push-tags     # explicit version override + push (fires release.yml workflow)
```

## The `explain` feature (maintainer memory)

Every verb has a structured `Explain` descriptor in `src/lib/descriptors.ts`
with: summary, audience, active toggles, detected context, ordered steps,
side effects, gotchas, see-also. `sm explain <verb>` renders it against the
**current detected state**, surfacing which mode is active right now:

- cloud vs local
- Firebase emulator vs live production
- Docker AIO vs native binaries vs Bun dev
- which `.env` is symlinked (`.env.local-test` vs `.env.cloud`)
- which Surreal version (3.0.5 in AIO/dev vs 3.1.2 in cloud production)
- which target the `bin/devserve` flag picks (`--target=local-test` vs `cloud`)
- which Stripe key (`sk_test_` vs `sk_live_`)
- whether the `cloud_test_db` container is running
- whether prerequisite terminals (`stripe listen` etc.) are detected
- which ports are in use

This is the answer to "I forgot which mode I was in" — `sm explain dev` (cloud)
will tell you, with detected context, whether you're about to run against
sandbox or live production.

The same descriptor also powers the **preflight summary** that every
destructive verb (`sm deploy *`, `sm ship*`, `sm release`, `sm push-public`)
prints before doing anything. The preflight also runs typed checks (clean
tree, on main, last verify fresh, env symlink correct, env vars set, etc.)
and refuses with a fix suggestion if any are `block`.

## Status — live state block

`sm status` (and bare `sm`) prints a **Live state** block fetched from real
APIs in parallel and cached for 60s on disk. From either repo it shows:

```
Live state (cached 4s ago — sm status --refresh)
  Cloud origin    ec05548  ⚠ origin/main behind local (ec05548 vs d630b74)
  Vercel          ✓ READY · 071e93a · 2d ago · https://smartchats.ai
                  matches origin/main
  Functions       22 live · last deploy 6d ago · all ACTIVE
  Open public     8fbc921  ⚠ open local ahead of public
  npm             smartchats-ai@0.3.2  ✓ matches open package.json
```

The chain answers in one glance:
- Did my push reach cloud origin? (local cloud HEAD vs `git ls-remote origin main`)
- Did Vercel pick it up? (cloud origin SHA vs Vercel deployment SHA)
- Are functions in sync with frontend? (Vercel SHA vs functions deploy)
- Is the CLI version on npm in sync with the open repo's package.json?

Cache TTL is 60s. `sm status --refresh` busts it. `sm status --no-remote`
skips all live fetches (instant; local-only).

## Environment

| Env var | Required for | Notes |
|---|---|---|
| `VERCEL_TOKEN` | Vercel live state | Get at https://vercel.com/account/tokens |
| `VERCEL_PROJECT_ID` | (optional) | Filter Vercel API to one project |
| `VERCEL_TEAM_ID` | (optional) | Filter to a team |
| `FIREBASE_PROJECT` | (optional) | Defaults to `tidyscripts` |
| `SMARTCHATS_PATH` | Cross-repo state from cloud | Path to open repo clone; defaults to `~/dev/smartchats` |
| `SM_PROBE_FUNCTIONS_URL` | `sm ship-full` post-deploy probe | Defaults to `cloudfunctions.net/testAuth` |
| `SM_PROBE_FRONTEND_URL` | `sm ship-full` post-deploy probe | Defaults to `https://smartchats.ai/` |
| `NO_COLOR` | Suppress color output | Standard convention |

## Caches

| Path | Purpose | TTL |
|---|---|---|
| `~/.smartchats/sm/last-verify-<repo>.json` | Most recent `sm verify` per repo (level, ok, head, timestamp) | none — overwritten each verify |
| `~/.smartchats/sm/last-deploy-<repo>-<target>.json` | Most recent `sm deploy <target>` per repo | none — overwritten each deploy |
| `~/.smartchats/sm/remote-cache.json` | Live remote bundle | 60s |

## Architecture

```
packages/sm/
├── src/
│   ├── cli.ts                 # Entry; verb router
│   ├── commands/              # One file per verb
│   │   ├── status.ts
│   │   ├── verify.ts          # wraps smartchats-test + bin/test-e2e
│   │   ├── dev.ts             # wraps bin/devserve
│   │   ├── doctor.ts
│   │   ├── explain.ts
│   │   ├── sync.ts            # wraps bin/sync-from-open
│   │   ├── deploy.ts          # wraps bin/deploy-functions / git push / npm run schema:apply
│   │   ├── ship.ts            # chains sync → verify → deploy
│   │   ├── ship-full.ts       # adds e2e + schema + probes
│   │   ├── rollback.ts
│   │   ├── release.ts         # release + push-public
│   │   └── triage.ts
│   └── lib/
│       ├── context.ts         # repo detection, git state, last-verify cache
│       ├── changes.ts         # diff + path categorization
│       ├── recommend.ts       # rule engine for `sm status`
│       ├── descriptors.ts     # Explain descriptors per verb
│       ├── explain.ts         # Explain types + renderer
│       ├── preflight.ts       # checks + confirm prompt for destructive verbs
│       ├── last-deploy.ts     # per-target deploy record cache
│       ├── remote.ts          # Vercel / Firebase / npm / git ls-remote fetchers
│       ├── remote-cache.ts    # 60s TTL on-disk cache
│       └── probe.ts           # HTTP probe helper (used by ship-full)
└── package.json
```

## Build + install

The package is a workspace member of the root monorepo. After `npm install`
at the repo root, `sm` is symlinked at `node_modules/.bin/sm`.

```bash
cd packages/sm
npm run build            # tsc → dist/
npm run dev <args>       # tsx src/cli.ts (no rebuild needed during dev)
npm run type-check       # tsc --noEmit
```

To make `sm` directly invocable, either run from inside the repo (npm
workspaces puts it on PATH via `node_modules/.bin/`) or add
`packages/sm/dist/cli.js` to your own PATH.

## Phase history

Phases landed in order; each is incremental and doesn't break the previous:

| Phase | Scope | Verbs added |
|---|---|---|
| 1 | Skeleton + awareness | `status`, `verify`, `dev`, `doctor`, `explain`, `help` |
| 2 | Action verbs + preflight runner | `sync`, `deploy`, `ship`, `rollback`, `release`, `push-public`, `triage` |
| 3 | Diff-aware intelligence | (extended `status` recommendations; new `lib/changes.ts`, `lib/recommend.ts`, `lib/last-deploy.ts`) |
| 3.5 | Comprehensive prod orchestrator | `ship-full` (+ `lib/probe.ts`) |
| 4 | Live remote state | (extended `status` Live block; new `lib/remote.ts`, `lib/remote-cache.ts`) |
| 5 | Docs | this README + root CLAUDE.md entry |
