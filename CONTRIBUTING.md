# Contributing to SmartChats

Welcome. This file is the single source of truth for contributing to SmartChats — covering both human contributors and AI coding agents (the project is built collaboratively with both, and the same rules apply).

If you're reading this for the first time, the ten minutes you spend on the [Quick Start](#quick-start) and [Architecture](#architecture) sections will save you hours of trial-and-error.

---

## Quick Start

You'll need: Node 24+, Docker, and ~2GB free disk for the all-in-one (AIO) container.

```bash
git clone https://github.com/sheunaluko/smartchats.git
cd smartchats
npm install                                  # workspaces install
npx smartchats-test                          # ~1 min: type-check + build everything
```

If the build is green, you have a working dev environment. From there:

```bash
# Spin up the local stack (SurrealDB + Express + Next.js, single container)
smartchats launch                            # interactive: prompts for API keys, runs container
smartchats doctor                            # verify it's actually up

# Or hot-reload dev with your own SurrealDB:
bin/devserve                                 # smartchats-local-server + next dev

# Full test suite
npx smartchats-test all
```

If you only want to *consume* SmartChats (not develop it), use the CLI directly:

```bash
npm install -g smartchats
smartchats launch
smartchats data export ~/backup.json
```

---

## Architecture

The stack is structured around three reusable layers, with the same contract reaching the Next.js app, the CLI, and the MCP server:

```
                   smartchats (CLI)         smartchats-mcp
                       │                          │
                       └────────┬─────────────────┘
                                ↓
         operations.importBundle / operations.exportBundle      ← multi-step ops
                                ↓
            smartchats-database/queries.X(args) → QuerySpec     ← pure builders (no I/O)
                                ↓
                           DataAPI.query                          ← contract from smartchats-backend
                          ╱            ╲
            makeCloudDataAPI         makeLocalDataAPI            ← factories in smartchats-database
                  │                       │
            cloud-client               createClient
            (talks to                  (talks to your
             smartchats.ai             local instance)
             cloud)
```

**Why this matters when you're contributing:**

- **Need to add a new query the agent can run?** Add a builder in `packages/smartchats-database/src/queries/`. It returns `{query: string, variables: Record<string, unknown>}`. Both the CLI and the MCP server pick it up automatically; you don't write the same SQL twice.

- **Need to expose that query as an MCP tool?** Add ~10 lines in `packages/smartchats-mcp/src/tools.ts`:
  ```ts
  server.tool(
    'name', 'description',
    { /* zod schema */ },
    async (args) => runAndFormat(queries.yourBuilder(args), handle),
  );
  ```

- **Need to expose it as a CLI subcommand?** Add a file in `packages/smartchats-cli/src/commands/`, parse argv, call the same builder. See `commands/data.ts` for the pattern.

- **Need a multi-step operation (loops, error aggregation, etc.)?** Put it in `packages/smartchats-database/src/operations/` and have it take a `DataAPI` parameter. Both CLI and MCP can then call it with no duplication. See `operations/import_bundle.ts` for the pattern.

### One credential store

`~/.smartchats-mcp/credentials.json` (mode 0600) — OAuth refresh token. The CLI and the MCP server share this file. `smartchats login` once and both surfaces are authenticated. Override the path with `SMARTCHATS_CREDENTIALS_FILE`.

### Single direct importer of `surrealdb`

Only `packages/smartchats-database/src/client.ts` imports the `surrealdb` npm package. Every other consumer goes through the `Client` interface (`createClient`, `createLazyClient`, `createUserClient`, `signupAsUser`, `signinAsUser`). If you find yourself wanting to add another `import {Surreal} from 'surrealdb'`, **stop** — extend the `Client` interface instead. This is a load-bearing invariant.

---

## Repo Layout

```
smartchats/
├── apps/
│   ├── smartchats/               # The Next.js app (chat UI, voice, KG)
│   └── site/                     # smartchats.ai landing + Nextra docs
├── packages/
│   ├── smartchats-backend/       # The DataAPI contract (types only)
│   ├── smartchats-backend-local/ # Local-target backend adapter
│   ├── smartchats-cloud-client/  # Open client for the hosted cloud SaaS
│   ├── smartchats-cli/           # `smartchats` command (launch, doctor, data, login, ...)
│   ├── smartchats-common/        # Shared utilities (logger, insights client, ...)
│   ├── smartchats-database/      # SurrealDB queries + operations + DataAPI factories + SDK client
│   ├── smartchats-local-server/  # Local Express server backing the local stack
│   ├── smartchats-mcp/           # Model Context Protocol server
│   ├── smartchats-sessions/      # Session export + per-session analyzers + cross-session triage
│   ├── smartchats-test/          # Layered test runner (lint / build / unit / integration / e2e)
│   ├── cortex/                   # Agent runtime (LLM loop, function dispatch, sandbox)
│   ├── tivi/                     # Voice interface (VAD, ASR, TTS)
│   ├── simi/                     # In-browser E2E workflow framework
│   ├── llm-service/              # Multi-provider LLM streaming
│   └── graph-viz/                # Knowledge-graph rendering (sigma.js)
├── bin/
│   ├── aio                       # Build + run the all-in-one container
│   ├── devserve                  # Local hot-reload dev (Express + next dev)
│   ├── checkpoint                # Git checkpoint commits
│   ├── preflight                 # Pre-commit validator
│   └── save_session              # Export a session for offline analysis
└── data/
    └── triage/handled.json       # Force-tracked triage state (parent dir is gitignored)
```

---

## Verification Workflow

Run the right level for the change you made. Don't rely on CI alone — local verification is fast and catches things before they get reviewed.

| You changed | Run |
|---|---|
| Types only (rename, refactor that doesn't change runtime) | `npx smartchats-test build` (~1 min) |
| Query builder, operation, schema, or anything in `smartchats-database` | `npx smartchats-test` (build + unit, when wired) |
| CLI subcommand or MCP tool | `npx smartchats-test` plus a manual smoke test |
| App code (`apps/smartchats`) | `npx smartchats-test all` (full, including e2e — needs running stack) |
| The CLI itself | `npx smartchats-test build` then test the published tarball locally (see `packages/smartchats-cli/PUBLISHING.md`) |

Levels:

- **L0 lint** — workspace-wide ESLint (currently skipped; no packages define a `lint` script)
- **L1 build** — `turbo run build` — type-checks via `tsc` emit
- **L2 unit** — vitest in packages that define `test:unit` (currently sparse)
- **L3 integration** — tests against running infra (AIO container)
- **L4 e2e** — Playwright Simi suite in `apps/smartchats/tests/e2e/`

`npx smartchats-test --list` shows the levels and their status.

### What if a test fails?

Don't blame "flakiness" or "pre-existing issues." Every failure has a reason. Workflow:

1. Read the failing level's output.
2. Reproduce the specific failing case (single Simi flow with `--grep`, single vitest spec, etc.).
3. Add diagnostic output if the message is opaque.
4. Fix the root cause; never bypass.

---

## Conventions

### Code

- **No defensive programming for impossible cases.** Trust internal code and framework guarantees. Validate at system boundaries (user input, external APIs) only.
- **No half-finished implementations.** Don't add stubs, TODO comments, or "for now" placeholders. Either implement it or don't.
- **No backward-compat shims** unless explicitly migrating. If you can change the code, change the code.
- **Comments explain WHY, not WHAT.** Well-named identifiers cover the what. Reserve comments for non-obvious constraints, hidden invariants, or workarounds for specific bugs.
- **Per-package READMEs and `CLAUDE.md` files describe local conventions.** Read them when working in a package for the first time.

### Architecture

- **Single direct importer of `surrealdb`** — see [Architecture](#architecture).
- **One credential store at `~/.smartchats-mcp/credentials.json`.** Don't invent a parallel auth file.
- **The `DataAPI` contract is the read/write boundary.** Don't add alternative dispatcher abstractions. If you need a new write semantic, add a method to `DataAPI` (in `smartchats-backend`) and implement it in both factories.
- **Per-statement errors must surface.** No silent `[]` on `status: ERR`.

### Schema

- **Dual-field timestamps**: `created_at` / `updated_at` (DB-stamped, READONLY, never migrated) vs `lts` (logical timestamp, app-stamped, preserved across export/import). UI sorts/filters by `lts`.
- **Snake_case audit fields with `VALUE time::now()`** — auto-bumps on update, not just insert.
- **Bumping schema version requires a migration block** in the corresponding `LOCAL_SCHEMA_MIGRATIONS` array. Migrations must be idempotent (`IF EXISTS`, `WHERE field IS NONE`, etc.).

### Git

- **All commits go through `bin/checkpoint "<msg>"`** — prefixes with `checkpoint:`. Applies to snapshots AND targeted fixes; don't run `git commit` manually.
- **No `Co-Authored-By` trailers.** Agent attribution doesn't go in commits.

---

## PR Workflow

Small, focused PRs are easier to review and ship cleanly. A single PR should ideally do one thing — even if "one thing" spans a few packages because of the layered architecture (e.g., a query builder + an MCP tool + a CLI command for the same feature is one PR).

When in doubt: ship smaller. Two well-scoped PRs beat one sprawling one every time.

---

## For AI Agents

SmartChats is built collaboratively by humans and AI coding agents. The same conventions apply to both — same quality bar, same review process, same guide. Re-read this section at the start of every session; it's the fastest way to load project conventions.

### How to make a good contribution

1. **Read existing code before writing new code.** Most patterns you'll reach for already exist somewhere. Search first, then write. The layered architecture (queries → operations → DataAPI → factories) means nearly every "I need to add X" maps to exactly one place. When in doubt, grep for similar concepts under different names before introducing a new abstraction.

2. **Make small, surgical changes.** A typical feature touches one builder, one tool wrapper, and one CLI command — three files, ~20 lines. When the diff sprawls across five+ files, you're working against the architecture; step back and find the layer you missed.

3. **Read the per-package conventions.** Each package has a `CLAUDE.md` or `README.md` describing its local contracts. Read it deliberately the first time you work in a package.

4. **Run the right test level** before declaring done. See the [Verification Workflow](#verification-workflow) table. Don't rely on CI alone for your own change.

### How to avoid the most common failure modes

- **For destructive actions** (deleting data, force-pushing, killing shared processes), confirm with the user first. Reversibility is a one-way valve — measure twice, cut once.

- **When tests fail, investigate root cause.** Never blame "flaky environment" or "pre-existing issues." Read the log, reproduce the failure, fix the actual problem.

- **Match the existing tone.** Doc edits should sound like the surrounding text. Code edits should match the surrounding style. Comment density should match the file's norm. Tonal mismatches make reviewers slower because every PR feels like a stranger wrote it.

- **Don't introduce dual-history conditional code.** If the codebase has moved off pattern X, don't write code that supports both X and the new pattern "for backward-compat" unless explicitly asked. Migrations are clean cuts, not gradual.

### Useful starting points

- This file (`CONTRIBUTING.md`) — full guide; you're already here.
- `CLAUDE.md` (root) — first-port-of-call routing for any task.
- `apps/smartchats/CLAUDE.md` — Next.js app conventions.
- `packages/smartchats-cli/README.md` — CLI usage.
- `packages/smartchats-cli/PUBLISHING.md` — npm release process.

**Your superpower:** the codebase has been deliberately refactored so that adding a new feature usually means one small change in one place — a builder in `queries/`, a tool in `tools.ts`, a subcommand in `commands/`. If a feature seems to require five files, you're probably going in the wrong direction — look for the existing layer that already does what you need.

---

## Help / Issues

- **GitHub issues**: <https://github.com/sheunaluko/smartchats/issues>

Thanks for contributing.
