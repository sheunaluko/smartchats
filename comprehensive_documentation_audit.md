# Comprehensive Documentation Audit

**Repository:** `smartchats`  
**Audit date:** 2026-06-24  
**Baseline:** working tree at `225c41c` plus pre-existing local changes  
**Audit mode:** static, read-only inspection of documentation and implementation; no application build, test suite, installer, container, database, or cloud service was executed

## Executive summary

The repository has a strong documentation culture by volume and intent: 48 tracked Markdown/MDX files, roughly 12,000 lines, plus current untracked site/blog work. The strongest documents explain design rationale, operational constraints, event-time semantics, session analysis, and voice-pipeline behavior unusually well.

The principal problem is not a lack of documentation. It is that several generations of the product are documented simultaneously without a reliable authority hierarchy. Current native-install behavior, the older Docker-first CLI, the cloud/downstream app, the open local app, historical Cortex/`ts_common` layouts, and proposed UI work are intermixed. As a result, some polished public pages and agent-facing guides describe APIs, commands, licenses, files, and capabilities that no longer match the repository.

Four findings should be treated as release-blocking documentation defects:

1. **Licensing is materially ambiguous.** The root says MIT, many packages declare Apache-2.0, `smartchats-mcp` declares PolyForm Noncommercial, and `packages/tivi/src/LICENSE` is also PolyForm Noncommercial while the `tivi` manifest says Apache-2.0.
2. **The public `smartchats-database` quick-start examples do not match the current API and would not compile or run as written.**
3. **The public Cortex quick-start and sandbox examples do not match the current constructor, SCM, runner exports, or sandbox interface.** The same page also claims a shipped Node agent path that is not present in this repository.
4. **The MCP documentation describes 10 mostly read-only tools while the implementation registers 33 tools, including insert, update, and delete operations.** This is a capability and safety disclosure problem, not a cosmetic count error.

The next most important cluster concerns verification. There are at least four incompatible descriptions of the test runner, including references to a deleted `bin/test_all`, an L3 integration level called both “stubbed” and AIO-dependent even though it now provisions its own in-memory SurrealDB, and a default selector whose documentation differs from its implementation.

## Scope and methodology

### Documentation reviewed

- Root-facing documents: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `HISTORY.md`
- Public Nextra docs under `apps/site/pages/docs/`
- App-facing documents under `apps/smartchats/`
- Package READMEs and package-specific guides
- Embedded `ts_vad` documentation
- VM, release, MCP, CLI, session-analysis, Sail DSP, and Voicebench documentation
- Current untracked site/blog content was noted, but findings based solely on active uncommitted feature work are marked provisional or excluded

### Validation performed

- Compared commands with current command dispatchers and help strings
- Compared documented paths with the filesystem and tracked tree
- Compared package examples with current TypeScript interfaces and exports
- Compared tool/workflow/widget/provider counts with current registrations
- Compared architecture claims with imports and active bootstraps
- Compared licensing statements with manifests and license files
- Compared test documentation with `smartchats-test` implementation
- Checked internal documentation routes and obvious local links

### Validation not performed

- External URLs were not comprehensively HTTP-checked; search/open attempts were inconclusive for the project site and npm listing
- Code snippets were not compiled as a documentation test suite
- Runtime claims such as installation time, production readiness, latency, image size, and cloud behavior were not benchmarked
- Historical benchmark numbers in the untracked blog draft were not independently reproduced

### Existing worktree state

The worktree already contained modified and untracked files before this report was created, including provider/model work and site/blog additions. This audit does not modify or assess those changes as completed product behavior. The only file added by the audit is this report.

## Severity model

| Severity | Meaning |
|---|---|
| P0 — Critical | Creates legal ambiguity, unsafe capability assumptions, or copy/paste code that fundamentally cannot work |
| P1 — High | Sends users/contributors down a broken primary workflow or gives agents materially wrong architectural instructions |
| P2 — Medium | Stale counts, incomplete references, misleading status, or broken secondary links |
| P3 — Low | Editorial inconsistency, imprecise wording, or maintainability concern without immediate operational impact |

## Findings register

### DOC-001 — Licensing statements and package declarations conflict

**Severity:** P0 — Critical  
**Surfaces:** `README.md`, `CLAUDE.md`, `apps/smartchats/README.md`, `apps/site/pages/docs/index.mdx`, `apps/site/pages/docs/architecture.mdx`, package manifests, nested license files

**Documented claims**

- Root `README.md` presents the release and repository as MIT-licensed.
- Root `CLAUDE.md` calls the monorepo “Public, MIT-licensed open-source.”
- `apps/smartchats/README.md` says Apache 2.0.
- Public docs say the core is MIT or that “all of it is open source.”

**Repository evidence**

- Root `LICENSE`: MIT.
- MIT manifests: `benchpress`, `sail-dsp`, `smartchats-cli`, `smartchats-database`, `smartchats-sessions`, `smartchats-test`, `voicebench`.
- Apache-2.0 manifests: `cortex`, `graph-viz`, `llm-service`, `simi`, `smartchats-backend`, `smartchats-backend-local`, `smartchats-cloud-client`, `smartchats-common`, `smartchats-local-server`, `tivi`.
- `smartchats-mcp/package.json`: `PolyForm-Noncommercial-1.0.0`.
- `packages/tivi/src/LICENSE`: PolyForm Noncommercial 1.0.0, conflicting with `packages/tivi/package.json` (`Apache-2.0`).
- Embedded `ts_vad/package.json`: ISC, while its README links to a nonexistent local `LICENSE`.

**Impact**

Users cannot determine which terms apply to the app, MCP server, Tivi source, or combined distributions. “Open source end-to-end” is especially problematic when a required component declares a noncommercial source-available license.

**Recommended resolution**

1. Make an explicit licensing decision package by package.
2. Add a root `LICENSING.md` matrix defining scope and precedence.
3. Ensure every publishable package includes the license file matching its manifest.
4. Remove or qualify blanket “MIT-licensed” and “open source end-to-end” claims.
5. Resolve the `tivi` Apache-vs-PolyForm conflict before another release.

### DOC-002 — `smartchats-database` public quick start uses an obsolete API

**Severity:** P0 — Critical  
**Surface:** `apps/site/pages/docs/packages/smartchats-database.mdx`

The Node example currently documents:

```ts
const client = await createClient({ url, ns, db, user, password });
const sessions = await client.query(queries.listSessions(...));
```

The current API instead:

- Accepts `namespace`, `database`, and nested `auth: { username, password }`.
- Returns a client synchronously.
- Requires `await client.connect()` for `createClient`.
- Exposes `runQuery(spec)` for a `QuerySpec`; `query()` accepts a query string and variables.

The operations example is also obsolete:

- `exportBundle` takes a `DataAPI`, not the raw `Client` shown in the page.
- Options require `source` and `userId`; `app` and `sessionId` are not valid `ExportOptions`.
- The return value is `ExportResult`, whose bundle is `result.bundle`.

The page also references removed `bin/cloud_test_db`.

**Recommended resolution**

- Replace examples with code copied from a compiled test fixture.
- Add a docs-snippet type-check job so these examples cannot silently drift again.
- Separate the `Client`, `DataAPI`, and `DataAPIHandle` examples instead of using “client” generically.

### DOC-003 — Cortex public API examples and platform claims are inaccurate

**Severity:** P0 — Critical  
**Surface:** `apps/site/pages/docs/packages/cortex.mdx`

The quick-start example does not match `CortexOps`:

- `model` and `name` are required but omitted.
- `llmService` and `contextManager` are not constructor properties.
- Current properties are `llmCallFn`, `scm`, `runner`, `sandbox`, and related options.
- `SystemContextManager` has no array constructor; modules are registered with `add_module()`.
- The example calls `cortex.run({ userInput: ... })`, which does not represent the currently documented app integration path.

Other mismatches:

- The page presents `SynchronousRunnerV2` as a public runner, but it is not re-exported from `packages/cortex/src/index.ts`.
- The sandbox example omits required `context`, `initializePersistent`, `reset`, and `destroy` members and uses a different `execute` signature.
- It says SmartChats ships a Node child-process sandbox used by CLI and MCP. No such implementation exists in this repository, and CLI/MCP do not host Cortex agent runs.
- It warns about a second `packages/ts_common/src/apis/cortex/` implementation, but `packages/ts_common` is absent.
- It simultaneously says the shipping target is browser-only and diagrams/describes a Node child implementation as shipped.

**Recommended resolution**

- Rewrite the page from current exported types, not historical architecture notes.
- Decide whether the page documents the reusable package API or only SmartChats’ browser integration; currently it mixes both.
- Add one minimal executable example under `packages/cortex/examples/` and embed or link that exact source.

### DOC-004 — MCP docs substantially understate write/delete capabilities

**Severity:** P0 — Critical  
**Surfaces:** `apps/site/pages/docs/mcp.mdx`, `packages/smartchats-mcp/README.md`, `apps/site/pages/docs/index.mdx`

**Documented state**

- Public docs say “10 tools.”
- Package README lists 8 read tools.
- Public docs say raw-query writes are a future capability and frame MCP primarily as read/search plus import/export.

**Current implementation**

`registerTools()` registers 33 tools, including:

- Semantic search for logs, entities, and relations.
- Log insert/update/delete/category preparation.
- Metric insert/update/delete/definition preparation.
- Todo insert/completion/status/reschedule/edit/delete/completion cleanup.
- Knowledge-graph entity/relation insert and delete operations.
- Import/export.

`run_query` remains SELECT-only, but that does not make the MCP surface read-only; dedicated mutation tools are already extensive.

**Impact**

An MCP client or administrator relying on the docs may grant access believing the server has far less mutation authority than it actually has. Delete semantics and non-cascading cleanup requirements are not visible in the public reference.

**Recommended resolution**

- Generate the tool reference from the registration schemas/descriptions.
- Group tools into read, create, update, delete, and data-movement sections.
- Add an explicit capability/safety section covering destructive tools, local/cloud auth, and filesystem-writing import/export tools.
- Update the package README architecture, which currently describes only Firebase/cloud even though `--target=local` exists.

### DOC-005 — Verification documentation describes multiple incompatible systems

**Severity:** P1 — High  
**Surfaces:** `apps/site/pages/docs/architecture.mdx`, `apps/site/pages/docs/index.mdx`, `CONTRIBUTING.md`, `CLAUDE.md`, `packages/smartchats-test/README.md`, `packages/smartchats-test/src/cli.ts`

Conflicts:

- Public architecture docs call deleted `bin/test_all` the canonical six-layer command.
- Public product docs also cite `bin/test_all` as reproducibility evidence.
- `smartchats-test` README calls L3 “currently stubbed” and caller-provisioned.
- `CONTRIBUTING.md` calls L3 an AIO integration level.
- Root `CLAUDE.md` calls L3 stubbed and AIO-dependent.
- Actual L3 starts an in-memory SurrealDB on a random port and runs `test:aggregation`; it has `requiresInfra: false`.
- CLI help says the default runs lint + build, while selection code includes every level with `requiresInfra !== true`: lint, build, unit, and integration.
- README says default non-infra levels are L0–L2, which also omits actual default L3.
- `--include-infra` is described as adding L3 and L4, but currently only L4 is marked `requiresInfra`.

**Recommended canonical description**

Document behavior from `ALL_LEVELS` and each level’s metadata:

- Default: L0 lint, L1 build, L2 unit, L3 managed-Surreal integration.
- `quick`: L0 + L1.
- `all`: L0–L4, with L4 requiring a running app/test environment.
- `--include-infra`: adds levels actually marked `requiresInfra` to the default selector—currently L4 only.

Prefer generating `--help`, README tables, and public verification tables from the same level registry.

### DOC-006 — `bin/preflight` is described as stronger than it is

**Severity:** P1 — High  
**Surfaces:** `apps/site/pages/docs/contributing.mdx`, `CONTRIBUTING.md`, `CLAUDE.md`, `bin/preflight`

Public contributor docs call `bin/preflight` a canonical “lint + workspace type-check + build” gate and instruct contributors to run it before every PR.

Actual behavior:

- Runs `turbo run build`.
- Runs lint, but converts lint failure into a warning and still succeeds.
- `--full` only prints that full mode is not wired.
- The script comments still say the `smartchats-test` package is forthcoming even though it exists.

**Impact**

“Preflight passed” does not establish that lint passed, and `--full` does not perform the implied full verification.

**Recommended resolution**

Either make it a strict wrapper around `smartchats-test quick`/`all`, or document it explicitly as build-required, lint-best-effort, with `--full` unsupported.

### DOC-007 — Public contributor guide references removed files and packages

**Severity:** P1 — High  
**Surface:** `apps/site/pages/docs/contributing.mdx`

Removed or absent references include:

- `bin/cloud_test_db`
- `packages/smartchats-backend-firebase`
- `data/ARCHITECTURE_NOTES.md`

The guide’s repo tree presents the Firebase adapter as part of this repository even though cloud behavior is described elsewhere as downstream/private.

It also tells users to run `npm install -g smartchats` in root `CONTRIBUTING.md`; the repository’s published package is `smartchats-ai`.

**Recommended resolution**

- Generate or validate documented tree entries against the tracked tree.
- Use `npm install -g smartchats-ai` consistently.
- Clearly label downstream/private packages instead of displaying them as local paths.

### DOC-008 — CLI documentation spans two generations and omits a current command

**Severity:** P1 — High  
**Surfaces:** root `README.md`, `CONTRIBUTING.md`, root `CLAUDE.md`, `packages/smartchats-cli/README.md`, public CLI docs

Current CLI source treats `setup` + native `start` as the preferred path and retains Docker `launch` for compatibility. However:

- Root `CLAUDE.md` calls `launch` canonical and `bin/aio`/`bin/devserve` legacy.
- Package CLI README is almost entirely Docker-`launch` oriented and labels itself Phase 1.
- `CONTRIBUTING.md` leads with `smartchats launch`.
- Public CLI docs correctly call `launch` legacy.
- Public quick start documents `smartchats upgrade`, but the supposedly complete CLI reference has no `upgrade` section.
- Quick start says npm users need Node 22+, while root and CLI manifests require Node 24+.

**Recommended resolution**

Make `apps/site/pages/docs/cli.mdx` the authority, update the package README from it, and mark Docker-launch material explicitly as compatibility documentation.

### DOC-009 — Public self-hosting prerequisites contradict each other

**Severity:** P1 — High  
**Surfaces:** `apps/site/pages/docs/quickstart.mdx`, `apps/site/pages/docs/self-host.mdx`, `apps/smartchats/README.md`, CLI implementation

Conflicts:

- Quick start and app README say OpenAI is required.
- Self-hosting later says any LLM provider key allows the agent to reply and calls OpenAI only “strongly recommended.”
- CLI implementation checks whether *any* configured provider exists.
- OpenAI may still be needed for embeddings and OpenAI TTS, but that is a feature-level dependency, not necessarily a chat requirement.
- Disk requirements vary: approximately 500 MB, 2 GB, and 3 GB. CLI setup/doctor enforces or reports 3 GB.
- `smartchats setup --no-prompt` is annotated “interactive” in the VPS guide, which is internally contradictory.

**Recommended resolution**

Publish a capability matrix:

| Configuration | Chat | Embeddings | OpenAI TTS | Web search |
|---|---|---|---|---|
| Any supported LLM key | yes | depends | depends | no |
| OpenAI key | yes | yes | yes | no |
| Serper key | no effect | no effect | no effect | yes |

Use the CLI’s 3 GB check as the documented recommended minimum unless the check itself is changed.

### DOC-010 — Tivi public examples contain several API mismatches

**Severity:** P1 — High  
**Surface:** `apps/site/pages/docs/packages/tivi.mdx`

Confirmed mismatches:

- Documented `TiviSettings.mode` is `'responsive' | 'deliberate'`; actual type is `'guarded' | 'responsive' | 'continuous'`.
- The `CalibrationPanel` example supplies only `showTrigger`, but `tivi`, `vadParams`, and `updateVadParam` are required.
- The programmatic calibration example calls `useCalibration({ tivi })` and methods `start`, `next`, `apply`, `cancel`; actual signature takes three positional arguments and returns `startCalibration`, `finishPhase1`, `startPhase2`, `applyResults`, and `cancelCalibration`.
- The page first says audio cleanup occurs on unmount, then warns that the mic remains active unless `stopListening()` is called before unmount. One of these statements must be removed or qualified.
- The source link uses the repository’s old `master` branch.

The page’s threshold defaults are current, but comments in `packages/tivi/src/lib/types.ts` still state older defaults of 0.3/0.25, creating source-level documentation drift as well.

### DOC-011 — Embedded `ts_vad` documentation is internally inconsistent

**Severity:** P1 — High  
**Surfaces:** `packages/tivi/src/lib/ts_vad/README.md`, `QUICK_REFERENCE.md`, `docs/*`

The detailed API guide generally shows `start(audioContext, stream)`, while the quick reference repeatedly shows `start()` with internal `getUserMedia`. Constructor callback examples (`onSpeechStart`, `onSpeechEnd`) conflict with the event-emitter usage shown elsewhere and with the current options type. The README’s ISC badge links to a nonexistent `packages/tivi/src/lib/ts_vad/LICENSE`.

Because this subtree contains more than 3,700 documentation lines, hand-maintaining multiple overlapping references is producing divergent APIs.

**Recommended resolution**

- Choose one canonical API reference.
- Generate quick-reference signatures from TypeScript declarations.
- Move complete examples into compiled `.ts` files and link them.
- Add the correct ISC license file or change the package declaration and badge.

### DOC-012 — Agent-facing `CLAUDE.md` files describe removed architecture

**Severity:** P1 — High  
**Surfaces:** root `CLAUDE.md`, `apps/smartchats/CLAUDE.md`

These files are especially important because they are intended to steer coding agents automatically.

Root issues:

- Calls Docker `launch` canonical despite the current CLI’s native `setup`/`start` direction.
- Gives obsolete L3 test behavior.
- Says Node 24 is enforced in every package; only root and CLI manifests declare the engine.
- Says TypeScript 5.4.5 is pinned by root overrides. No root override exists; installed TypeScript is 5.9.3, and most manifests use a caret range.

App issues:

- Entry path `app/page.tsx` is absent; the app entry is under `app/app/page.tsx` with root routes serving the embedded site.
- Repeatedly describes Firebase/cloud billing as the active open-repo path, despite `app/layout.tsx` bootstrapping `LocalAuthProvider` and `LocalBackend`.
- References removed `ts_next_app` shared code and obsolete aliases.
- Claims 18 core + 4 billing workflows; there are 41 core workflow files plus generated benchmark workflows and four billing workflow definitions, while the Playwright partition currently schedules a different subset.
- Claims 13 widget types; `useWidgetConfig` currently defines 18.
- File-size annotations for `app3.tsx` and `useOrchestrator.ts` are stale.

**Recommended resolution**

Treat agent guidance as executable operational configuration: keep it short, current, and limited to durable invariants. Move volatile inventories and counts to generated references.

### DOC-013 — Simi package docs use a removed workflow path and stale telemetry names

**Severity:** P2 — Medium  
**Surface:** `apps/site/pages/docs/packages/simi.mdx`

- Documented workflow path is `apps/smartchats/src/simi/workflows/`; actual path is `apps/smartchats/app/simi/workflows/`.
- Documented telemetry names (`workflow_started`, `step_start`, `step_complete`, `workflow_completed`, `workflow_failed`) do not match current `simi_*` event names such as `simi_workflow_start`, `simi_resolve`, and `simi_workflow_complete`.
- Browser-console example uses a property name inconsistent with the demonstrated workflow registry convention.
- The page says there is no browser-driver overhead, but the repository’s E2E harness still uses Playwright to load and coordinate the browser; the workflow itself runs in-page. This should be phrased more precisely.

### DOC-014 — Workflow and widget inventories are stale across app docs

**Severity:** P2 — Medium  
**Surfaces:** `apps/smartchats/README.md`, `apps/smartchats/CLAUDE.md`, `smartchats_architecture_guide.md`, public architecture docs

Examples:

- App README says 26 workflows.
- Architecture guide and app CLAUDE say 22 workflows: 18 core + 4 billing.
- Current filesystem has 41 core workflow files, one of which generates additional benchmark workflows, plus four billing workflow definitions and an index.
- The current Playwright partition schedules 33 named workflows, which is a distinct concept from “all registered workflows.”
- App CLAUDE says 13 widgets; current configuration has 18.

**Recommended resolution**

Avoid hard-coded counts. If counts are valuable, generate them and distinguish:

- registered workflows,
- workflow source files,
- Playwright-scheduled workflows,
- local-backend-compatible workflows,
- billing workflows.

### DOC-015 — Public architecture names a package not present in the repository

**Severity:** P2 — Medium  
**Surfaces:** `apps/site/pages/docs/architecture.mdx`, public contributor guide

`smartchats-backend-firebase` is described as an open client adapter in this repository, but no such package exists here. If it lives only in the downstream cloud repository, the docs should say so explicitly and should not list it as part of the open tree.

### DOC-016 — “Single SurrealDB importer” invariant has undocumented exceptions

**Severity:** P2 — Medium  
**Surfaces:** `CONTRIBUTING.md`, public architecture/contributor docs, root CLAUDE, package comments

The invariant says only `packages/smartchats-database/src/client.ts` imports `surrealdb`. Two Benchpress scripts also import it directly:

- `packages/benchpress/scripts/verify_seed.ts`
- `packages/benchpress/scripts/measure_loaders.ts`

This may be an intentional admin/benchmark exception, but the documentation presents the rule as absolute and “load-bearing.” Either route these scripts through `Client` or document a tightly scoped exception for offline benchmark administration.

### DOC-017 — Root README links to a nonexistent documentation route

**Severity:** P2 — Medium  
**Surface:** `README.md`

The README links to `https://smartchats.ai/docs/install`, but no `/docs/install` source route exists. Installation is documented at `/docs/quickstart`. External behavior could not be conclusively checked, so this should be verified against the deployed site before changing, but the repository source does not define the advertised route.

### DOC-018 — GitHub source links use `master` while the repository branch is `main`

**Severity:** P2 — Medium  
**Surfaces:** public architecture, contributor, and Tivi docs

Several links use `github.com/sheunaluko/smartchats/blob/master/...`; the checked-out branch and tracked remote references use `main`. Replace hard-coded branch links with `main`, or use repository-relative links where possible.

### DOC-019 — App README documents a missing Docker Compose path

**Severity:** P2 — Medium  
**Surface:** `apps/smartchats/README.md`

The README says the repository ships `docker-compose.yml` and instructs users to copy `.env.example`. Neither file exists. The current supported container path is `Dockerfile.aio`/`bin/aio` or the published installer-built image.

### DOC-020 — Voicebench README reflects its initial scaffold, not current implementation

**Severity:** P2 — Medium  
**Surface:** `packages/voicebench/README.md`

The provider table lists OpenAI as done and xAI/GCP/Gemini Live as planned. Current code includes OpenAI, GCP streaming, xAI WebSocket, Gemini Live, Gemini TTS, and Azure providers. The command examples omit newer providers, and the “known imprecisions” section may no longer match the benchmark/blog conclusions.

The README also points to a private/downstream production file path. That is acceptable if labeled as downstream integration guidance, but it currently reads like a local path.

### DOC-021 — Historical and proposed app documents are not labeled consistently

**Severity:** P2 — Medium  
**Surfaces:** `smartchats_architecture_guide.md`, `app_system_architecture_documentation.md`, `ui_architecture.md`, `onboarding_considerations.md`, `pulse_stream_plan.md`

These documents serve different purposes but appear equally authoritative:

- `smartchats_architecture_guide.md` largely documents a cloud/Firebase-era variant and removed `ts_next_app` sharing.
- `app_system_architecture_documentation.md` contains current concepts plus removed `ts_common` paths.
- `onboarding_considerations.md` says onboarding is completely broken as of 2026-04-05, while current workflows and app modules include onboarding behavior.
- `pulse_stream_plan.md` is clearly a proposal but uses present-tense architecture around files that do not exist.
- `ui_architecture.md` appears closer to current state but includes volatile counts and exact host details.

**Recommended resolution**

Add a status banner to every design document:

```text
Status: CURRENT | HISTORICAL | PROPOSAL | SUPERSEDED
Last verified: YYYY-MM-DD
Authority: <current source or replacement document>
```

Move superseded material under `docs/archive/` or rename with `_historical`/`_proposal` suffixes.

### DOC-022 — `LocalBackend` source header still calls the implementation a scaffold

**Severity:** P3 — Low  
**Surface:** `packages/smartchats-backend-local/src/backend.ts`

The source header says “Phase 3 scaffold” and implies concerns remain stubbed, but the class wires LLM, TTS, embeddings, data, usage, keys, billing, tools, insights, and health implementations. This is source documentation rather than user documentation, but it can misdirect maintainers.

### DOC-023 — Package index overstates package independence

**Severity:** P3 — Low  
**Surface:** `apps/site/pages/docs/packages/index.mdx`

The page says packages such as Tivi or Cortex can be adopted independently and presents the app as a thin shell. In practice:

- Tivi depends on SmartChats-specific shared utilities and has asset-copy requirements.
- Cortex’s public quick start is not currently valid and requires substantial dependency injection.
- The app itself contains major domain modules, orchestration, stores, shells, and sandbox implementation.

The architectural direction is valid, but wording should distinguish “designed for reuse” from “published, supported, drop-in standalone package.”

### DOC-024 — Package README and manifest freshness varies significantly

**Severity:** P3 — Low

- `smartchats-cli/README.md` documents the legacy Docker-first phase.
- `smartchats-mcp/README.md` omits most tools and local targeting.
- `smartchats-sessions` docs are comparatively current but omit newer TTS timing modules in some module inventories.
- Several packages have no README at all despite being named as reusable public packages.

This is best addressed through explicit support tiers rather than requiring equal documentation for every internal package.

## Documents that are comparatively strong

The following surfaces are useful foundations and should be preserved while correcting drift:

- `HISTORY.md`: concise rationale and migration history with concrete evidence.
- `apps/smartchats/startup_reference.md`: focused timeline and “where to change X” mapping; it should receive a verification date.
- `packages/smartchats-sessions/src/analysis_db/README.md`: detailed contract and operational reasoning, though `sm` references need qualification because `packages/sm` is not in this repo.
- `packages/smartchats-database/src/client.ts` comments: unusually clear about lifecycle and SDK boundaries.
- `packages/smartchats-backend/src/types.ts`: strong contract documentation.
- `Dockerfile.aio` comments and current native-start source comments: coherent description of the release path.
- `apps/smartchats/app/lib/greeting/README.md` and focused subsystem docs generally age better than broad inventories.

## Recommended remediation sequence

### Phase 1 — Release and safety correctness

1. Resolve and publish the license matrix.
2. Rewrite MCP capability documentation to disclose all 33 tools and mutation authority.
3. Fix or remove non-working Cortex and database quick starts.
4. Fix Tivi examples that cannot compile.
5. Replace deleted primary commands and paths in public docs.

### Phase 2 — Establish authorities

1. Declare one authority for each volatile surface:
   - CLI: command help/source.
   - Tests: `ALL_LEVELS` registry.
   - MCP: tool registration metadata.
   - Models: `MODEL_REGISTRY`.
   - App workflows: workflow registry/partitions.
   - Packages/licenses: manifests plus `LICENSING.md`.
2. Reduce root and app `CLAUDE.md` files to durable navigation and invariants.
3. Label current, historical, proposed, and downstream-only architecture documents.

### Phase 3 — Automate drift prevention

Add a documentation verification job that:

- Fails on references to absent local paths unless explicitly allowlisted as examples/proposals/downstream paths.
- Type-checks examples for public TypeScript packages.
- Generates CLI command tables from help metadata.
- Generates MCP tool reference from registrations or a shared tool manifest.
- Generates test-level tables from `ALL_LEVELS`.
- Checks internal site routes and Markdown links.
- Checks that GitHub branch links use the configured default branch.
- Checks package license declarations against included license files.
- Avoids hard-coded counts, or regenerates them from source.

### Phase 4 — Information architecture cleanup

Suggested structure:

```text
README.md                         product overview + supported install
CONTRIBUTING.md                   canonical contributor workflow
LICENSING.md                      package/license matrix
docs/current/                     current architecture and operations
docs/reference/                   generated CLI/MCP/package references
docs/proposals/                   active design proposals
docs/archive/                     historical/superseded designs
apps/*/CLAUDE.md                  short agent navigation + durable invariants
```

## Suggested ownership and freshness policy

Every non-generated operational document should include:

- **Owner**
- **Status**
- **Last verified date**
- **Source of truth**
- **Scope**: open repo, downstream cloud, or both

Suggested review triggers:

| Code change | Documentation that must be reviewed |
|---|---|
| CLI command/flag | CLI reference, quick start, package README |
| Test level metadata | test README, contributing guide, architecture verification section |
| MCP tool registration | generated tool reference and capability summary |
| Public package type/export | package page and compiled examples |
| Bootstrap/backend behavior | self-hosting and architecture docs |
| Workflow/widget registry | generated inventory only |
| License field/file | root licensing matrix and release package check |

## Proposed acceptance criteria after cleanup

Documentation can be considered consistent when:

1. A new user has one supported installation path and every prerequisite agrees.
2. Every documented command exists and `--help` agrees with the page.
3. Public package examples type-check against the repository.
4. MCP documentation discloses every mutation category and destructive operation.
5. The test command described as canonical executes exactly the documented levels.
6. No current guide references removed local paths.
7. Every package’s declared license matches an included license file and the root matrix.
8. Agent guidance contains no removed packages, aliases, or boot paths.
9. Historical/proposal documents cannot be mistaken for current operational truth.
10. CI enforces the mechanically checkable parts of this list.

## Conclusion

SmartChats does not need more prose. It needs fewer competing authorities and stronger coupling between reference documentation and executable metadata. The highest-value work is to make the already-good architectural narrative trustworthy: resolve licensing, disclose the actual MCP authority, repair public API examples, and generate volatile command/tool/test inventories from source. Once those are corrected, the remaining drift is straightforward cleanup rather than an architectural documentation rewrite.
