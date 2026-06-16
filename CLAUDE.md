# smartchats — open-core monorepo

Public, MIT-licensed open-source voice AI agent. End users clone this repo and run the full self-hostable stack with `bin/aio` or `npm run dev` + their own SurrealDB.

**This is the only doc guaranteed to land in every agent's context.** Per-subtree CLAUDE.md files auto-load inside their directories.

## Prerequisites

Node 24+ (current Active LTS through April 2028 — bumped from `>=20` on 2026-05-29). Enforced via `engines.node` in every package; CI installs Node 24 in `.github/workflows/release.yml`. Verify locally with `node --version`.

## First port of call

| You're trying to… | Start here |
|---|---|
| Run the app stack locally | `smartchats launch` (CLI, canonical) or `bin/aio` / `bin/devserve` (legacy aliases) |
| Verify a running stack | `smartchats doctor` |
| Smoke-test the full launch flow | `smartchats launch --test` |
| Type-check + build everything | `bin/preflight` or `npx smartchats-test` |
| Export a session for analysis | `bin/save_session smartchats` |
| Triage errors across sessions | `cd packages/smartchats-sessions && npm run triage:errors` |
| Audit cost / errors / users / etc. against the live DB | `cd packages/smartchats-sessions && npm run audit:<concern>` (cost / errors / slow-calls / function-calls / function-args / users / context-growth / issues) |
| Watch any of the above live in a terminal | `cd packages/smartchats-sessions && npm run monitor -- <analyzer>` |
| Add a new `issue` kind the agent can file | call `report_issue` in `apps/smartchats/app/modules/issues.ts` — `kind` is free-form, no enum to update |
| Understand the agent runtime | `packages/cortex/` |
| Understand the voice pipeline | `packages/tivi/` |
| Understand the smartchats app | `apps/smartchats/CLAUDE.md` (auto-loads when entering subtree) |
| Add a new tool the agent can call | `apps/smartchats/app/modules/tool_creation_skill.md` |
| Understand the CLI | `packages/smartchats-cli/README.md` |
| Look up a past schema / contract / infra change | `HISTORY.md` (single source for "why was it changed?") |

## Dev workflow

```bash
# Canonical entry point — works for both end users and contributors:
smartchats launch          # interactive; builds + runs AIO docker container
smartchats launch --test   # detached + verify + exit with doctor exit code
smartchats doctor          # status check of a running stack

# Legacy aliases (still here while we migrate):
bin/aio                    # roughly equivalent to `smartchats launch --no-prompt`
bin/devserve               # hot-reload dev — smartchats-local-server + next dev (BYO SurrealDB)
```

No external services required for a basic boot — local-mode only. The CLI walks up from cwd to find `Dockerfile.aio`; override with `SMARTCHATS_HOME` if running from outside a clone.

## Architecture

| Layer | Package | Purpose |
|---|---|---|
| App | `apps/smartchats/` | Production Next.js app (local-mode). LocalAuthProvider + LocalBackend by default. |
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

## Default boot path

Default app uses `bootstrap()` → `LocalAuthProvider` + `LocalBackend`. No Firebase, no billing, no external auth required. This is the canonical path for self-hosted users.

## `bin/` tooling

| Script | What it does |
|---|---|
| `bin/aio` | Build + run the AIO Docker container (SurrealDB + Express + Next.js in one image) |
| `bin/devserve` | Foreground orchestrator: starts `smartchats-local-server` + `next dev` with prefixed output |
| `bin/preflight` | Workspace-wide build (which also type-checks via `tsc` emit) + lint |
| `bin/save_session` | Wrapper for `npm run save-session` in smartchats-sessions; defaults output to `apps/smartchats/.session_data/` |
| `bin/checkpoint` | `git add -A && git commit -m "checkpoint: <msg>"` — preferred over manual git for snapshots |
| `bin/pty-bridge.mjs` | Wraps claude/gemini/codex in a PTY + exposes a WebSocket on port 9100. Pairs with the `cli_agent` module in `apps/smartchats/app/modules/cli_agent.ts` — lets the voice agent drive a CLI agent remotely. |
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
- L3 integration — requires running infra (AIO); stub currently
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

DB-side complement: `packages/smartchats-sessions/src/analysis_db/` exposes the same monitoring questions (cost / errors / function calls / user activity / context growth / structured `issue` events filed by the agent's `report_issue` tool) as `audit:*` scripts that query the live `insights_events` table — no bundle round-trip. `npm run monitor` wraps any of them in a polling loop for live terminal-watch. See [`packages/smartchats-sessions/src/analysis_db/README.md`](packages/smartchats-sessions/src/analysis_db/README.md) for the module list + Issue event convention.

## Auto-loaded per-directory CLAUDE.md

- `apps/smartchats/CLAUDE.md` — agent runtime, store, hooks, voice, billing, telemetry. Most comprehensive doc in the repo.
- `apps/site/` — Nextra docs source (no CLAUDE.md needed)

## Known gotchas

- **TS pinned at 5.4.5** via root `package.json` overrides. TS 5.7+ tightens `Float32Array<ArrayBuffer>` generics and breaks tivi's audio code. Real fix is in tivi; until then, pin holds.
- **`apps/site/lint` script was dropped** — that app is Nextra docs, no need.
- **`apps/smartchats/lint` script was dropped** — eslint setup was a rabbit hole; left for a deliberate "set up lint properly" session later. Two real hook-order bugs were fixed during that pass (`LoginModal.tsx`, `app/settings/billing/page.tsx` — both moved early returns past all hooks).

## How to resume

```bash
cd ~/dev/smartchats
git log --oneline -10                  # what landed recently
git status                             # any uncommitted work?
npx smartchats-test                    # confirm build is green
```

## Project conventions

- **All commits go through `bin/checkpoint "msg"`** — prefixes with `checkpoint:`. Applies to snapshots AND targeted fixes; don't run `git commit` manually.
- **No Co-Authored-By trailers** — agent attribution doesn't go in commits.
- **TS 5.4.5 pin must stay** until tivi typing is fixed. Bumping breaks tivi.
