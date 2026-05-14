# smartchats — open-core monorepo

Public, MIT-licensed open-source voice AI agent. End users clone this repo and run the full self-hostable stack with `bin/aio` or `npm run dev` + their own SurrealDB.

**This is the only doc guaranteed to land in every agent's context.** Per-subtree CLAUDE.md files auto-load inside their directories.

## First port of call

| You're trying to… | Start here |
|---|---|
| Run the app stack locally | `bin/aio` (Docker AIO container) or `bin/devserve` (BYO SurrealDB) |
| Type-check + build everything | `bin/preflight` or `npx smartchats-test` |
| Export a session for analysis | `bin/save_session smartchats` |
| Triage errors across sessions | `cd packages/smartchats-sessions && npm run triage:errors` |
| Understand the agent runtime | `packages/cortex/` |
| Understand the voice pipeline | `packages/tivi/` |
| Understand the smartchats app | `apps/smartchats/CLAUDE.md` (auto-loads when entering subtree) |
| Resume migration / architecture work | § Migration state below |

## Dev workflow

```bash
# Full stack (recommended for new clones): SurrealDB + Express + Next.js in one container
bin/aio                # http://localhost:3000

# Hot-reload dev with your own SurrealDB:
bin/devserve           # starts smartchats-local-server (Express) + Next.js
                       # assumes SurrealDB at localhost:8000 (or set SMARTCHATS_DB_URL)
```

No Firebase, no cloud, no env vars required for a basic boot.

## Architecture

| Layer | Package | Purpose |
|---|---|---|
| App | `apps/smartchats/` | Production Next.js app (local-mode only). LocalAuthProvider + LocalBackend by default. |
| App | `apps/site/` | smartchats.ai landing + Nextra docs |
| Agent runtime | `packages/cortex/` | LLM loop, function dispatch, sandboxed code execution, runners, ProcessManager |
| Voice | `packages/tivi/` | VAD (Silero ONNX), STT, TTS queue, calibration |
| Backend contract | `packages/smartchats-backend/` | Pure interface types (`SmartChatsBackend`, `DataAPI`, `AuthProvider`) |
| Local server | `packages/smartchats-local-server/` | Express server impl of the backend (BYO API keys, no billing) |
| Local backend adapter | `packages/smartchats-backend-local/` | HTTP client → smartchats-local-server |
| Database | `packages/smartchats-database/` | Pure SurrealQL builders + Client interface; only direct importer of `surrealdb` SDK |
| Session tooling | `packages/smartchats-sessions/` | Export + per-session analyzers + cross-session triage |
| Cloud client | `packages/smartchats-cloud-client/` | OAuth + cloud-API adapter (defaults to smartchats.ai SaaS; open by design) |
| CLI | `packages/smartchats-cli/` | `smartchats login`, `data import|export`, `launch` |
| MCP | `packages/smartchats-mcp/` | MCP server for Claude Desktop / other LLM clients |
| LLM service | `packages/llm-service/` | Multi-provider LLM streaming (OpenAI, Anthropic, Google) |
| Workflow framework | `packages/simi/` | In-browser E2E workflow harness |
| Shared util | `packages/smartchats-common/` | Logger, fp, debug, sounds, m2f, is_browser |
| Graph viz | `packages/graph-viz/` | sigma.js + graphology knowledge-graph rendering |
| Test runner | `packages/smartchats-test/` | Layered test runner (lint/build/unit/integration/e2e) |

## Open / closed boundary

**Open packages never import from any closed package.** Firebase code, cloud Functions, billing logic, admin dashboard — all live in the **closed** companion repo at `~/dev/smartchats-cloud/` (private GitHub, Vercel-deployed). That repo vendors copies of every open package; sync is via `bin/sync-from-open` there.

If you see Firebase, cloud-only imports, or anything billing-related in this repo, something has leaked. Default app uses `bootstrap()` → `LocalAuthProvider` + `LocalBackend`. Period.

## `bin/` tooling

| Script | What it does |
|---|---|
| `bin/aio` | Build + run the AIO Docker container (SurrealDB + Express + Next.js in one image) |
| `bin/devserve` | Foreground orchestrator: starts `smartchats-local-server` + `next dev` with prefixed output |
| `bin/preflight` | Workspace-wide build (which also type-checks via `tsc` emit) + lint |
| `bin/save_session` | Wrapper for `npm run save-session` in smartchats-sessions; defaults output to `apps/smartchats/.session_data/` |
| `bin/checkpoint` | `git add -A && git commit -m "checkpoint: <msg>"` — preferred over manual git for snapshots |
| `bin/_lib.sh` | Shared helpers (colors, REPO_ROOT). Source this in new scripts. |

## Test runner — `smartchats-test`

```bash
npx smartchats-test               # default: lint + build + unit (skips infra)
npx smartchats-test all           # everything including L3 (integration) + L4 (e2e)
npx smartchats-test build         # specific level
npx smartchats-test --list        # show levels
```

Levels:
- L0 lint — skipped if no packages define a `lint` script (currently the state)
- L1 build — `turbo run build` (tsc emit = type-check)
- L2 unit — vitest in packages that define `test:unit`
- L3 integration — requires running infra (cloud_test_db, AIO); stub currently
- L4 e2e — Playwright Simi suite

## Session triage

Built day-to-day debugging workflow. Pull session bundles, analyze, triage cross-session, mark fixed/wontfix/investigating:

```bash
bin/save_session smartchats                              # one session → JSON bundle
cd packages/smartchats-sessions
npm run find-sessions -- --has-error --since 7d           # discovery (local AIO)
npm run analyze:summary  -- <bundle.json>                  # per-session
npm run analyze:errors   -- <bundle.json>
npm run triage:errors                                      # cross-session, deduped by signature
npm run triage:mark -- <report-path> --status fixed --commit <sha>
```

Triage state lives at `data/triage/handled.json`. See `packages/smartchats-sessions/README.md` § Cross-session error triage for full workflow.

## Auto-loaded per-directory CLAUDE.md

- `apps/smartchats/CLAUDE.md` — agent runtime, store, hooks, voice, billing, telemetry. Most comprehensive doc in the repo.
- `apps/site/` — Nextra docs source (no CLAUDE.md needed)

## Known gotchas

- **TS pinned at 5.4.5** via root `package.json` overrides. TS 5.7+ tightens `Float32Array<ArrayBuffer>` generics and breaks tivi's audio code. Real fix is in tivi; until then, pin holds.
- **Some files still mention "tidyscripts"** in comments. Historical refs from when this code lived in the dev monorepo. Functional impact: zero. Cosmetic cleanup deferred.
- **`apps/site/lint` script was dropped** — that app is Nextra docs, no need.
- **`apps/smartchats/lint` script was dropped** — eslint setup was a rabbit hole; left for a deliberate "set up lint properly" session later. Two real hook-order bugs were fixed during that pass (`LoginModal.tsx`, `app/settings/billing/page.tsx` — both moved early returns past all hooks).

## Migration state (read if continuing this work)

**This monorepo was extracted from `~/dev/tidyscripts/` over 2026-05-13 → 2026-05-14.** Tidyscripts is now legacy — it retains some non-smartchats packages (`tidyscripts_{common,node,web,web_umd}`, `apps/ts_next_app/` with rai/cortex_0) but the smartchats stack lives here.

### Sister repo
`~/dev/smartchats-cloud/` — private. Closed-only packages (Firebase Functions, billing, admin UI, Firebase backend adapter). Vendors a copy of this entire monorepo's `packages/` + `apps/smartchats/` via its own `bin/sync-from-open`. Production Vercel deploys from there.

### What's done
- ✅ All 15 open packages copied + tested green
- ✅ `apps/smartchats/` extracted (local-mode only)
- ✅ `apps/site/` (docs + landing) wired as workspace member
- ✅ Firebase fully stripped from open (no imports, no deps, no env vars; verified by grep + build)
- ✅ `bin/` tooling adapted (aio, devserve, save_session, preflight, checkpoint, _lib.sh)
- ✅ `packages/smartchats-test/` layered runner shipped
- ✅ Closed repo at `~/dev/smartchats-cloud/` set up, vendoring + sync working, builds clean
- ✅ Production Firebase Functions never committed to this repo's history (verified)

### Known followups (not blocking)
1. **Tidyscripts mention scrub** — ~20 files have comments referencing "tidyscripts." Cosmetic. The Firebase project name itself is `tidyscripts` (production constant in `smartchats-cloud-client/src/config.ts`) — that's a real config, not a comment.
2. **Tivi `Float32Array<ArrayBuffer>` typing** — fix in `packages/tivi/src/lib/tsw/web_audio.ts` so we can drop the TS 5.4.5 pin.
3. **Production Vercel verification** — push closed repo, watch first Vercel build, confirm.
4. **Tidyscripts retirement** — once production deploys cleanly from `~/dev/smartchats-cloud/`, the parallel copies in tidyscripts can be deleted. Tidyscripts keeps `tidyscripts_*` legacy + `ts_next_app` (laboratory) only.
5. **Pre-push validation** — `bin/preflight` exists but isn't wired as a git pre-commit hook. Could add husky later.

### How to resume

```bash
cd ~/dev/smartchats
git log --oneline -10                  # what landed recently
git status                             # any uncommitted work?
npx smartchats-test                    # confirm build is green
```

For the closed sister repo:
```bash
cd ~/dev/smartchats-cloud
git log --oneline -5
npm run build                          # confirm full build
```

To pull recent open changes into closed: `cd ~/dev/smartchats-cloud && bin/sync-from-open`.

## Project conventions

- **Commits via `bin/checkpoint "msg"`** — prefixes with `checkpoint:`. Used for snapshot commits during dev. Don't use it for targeted fixes (use plain git for those).
- **No Co-Authored-By trailers** — agent attribution doesn't go in commits.
- **Don't mention "tidyscripts" in this repo's content** — historical bath we cleaned out. The closed repo is `smartchats-cloud`, not "the cloud half of tidyscripts."
- **TS 5.4.5 pin must stay** until tivi typing is fixed. Bumping breaks tivi.
