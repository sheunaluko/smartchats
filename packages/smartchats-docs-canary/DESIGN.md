# smartchats-docs-canary — DESIGN

Status: **Design draft, 2026-07-25.** Not yet implemented.

## Purpose

Catch silent regressions in the first-time-user experience by having automation follow the docs literally, on clean runners, for every commit that plausibly affects them — then file findings as GitHub issues in this repo.

The motivating class of bug: the quickstart page's asciinema embed silently broke on 2026-06-16 (v0.3.4 tag) due to CORS, and stayed broken until 2026-07-25 — over a month. No test failed. No exception was thrown. Every new user saw a degraded experience while everyone internal assumed docs were fine. The canary exists to make that failure mode loud.

## Package location — reversed decision

Earlier design put this in the `smartchats-cloud` (closed) monorepo, reasoning that it's ops/QA infra. **Reversed.** It lives in `smartchats/packages/smartchats-docs-canary/` (open, this repo) for one load-bearing reason: the GitHub Actions workflow that drives it lives in `smartchats/.github/workflows/docs-canary.yml`. If the canary package were private, the workflow would need a deploy key / GitHub App to check it out — extra secrets and friction for zero benefit. The canary code isn't sensitive (no auth logic, no billing, no PII); the only sensitive material is the burner LLM keys, which are GH Actions secrets scoped to the workflow, not to the package source.

## Non-goals (explicit MVP scope discipline)

- ❌ Testing voice / mic flows — needs virtual audio in headless, deferred
- ❌ Testing the SmartChats API (no such API exists yet — see [[UNLOCK_MCP_PATCH_THROUGH]] adjacent discussion for context)
- ❌ Full OS matrix — Ubuntu-only for MVP; macOS + WSL come with Phase 4
- ❌ LLM-agent "runs the docs" mode — that's Tier 3, deferred until Tiers 1+2 prove value
- ❌ Cross-project or cross-repo reporting — findings go to open repo issues only
- ❌ Human-vs-LLM authenticity closure — LLM canary catches mechanical breakage; hire humans separately for UX friction

## Architecture at a glance

```
                        ┌───────────────────────────────────────┐
    open repo push ───► │  .github/workflows/docs-canary.yml    │
    (main/master/       │  matrix: os × install_path × provider │
     preview / docs/**  │                                       │
     / weekly cron)     │  runs on GH-hosted runner:            │
                        │    - actions/checkout                 │
                        │    - cd packages/smartchats-docs-     │
                        │      canary && npm ci                 │
                        │    - node dist/cli.js run             │
                        │      --docs-path apps/site/pages/docs │
                        │      --install-path native-node       │
                        │      --provider openai                │
                        └───────────────────────────────────────┘
                                        │
                                        ▼
                    ┌──────────────────────────────────────────┐
                    │  packages/smartchats-docs-canary         │
                    │                                          │
                    │  1. mdx-parser         →  ordered command list │
                    │  2. runner             →  shell-exec each cmd  │
                    │  3. playwright-verify  →  browser evidence     │
                    │  4. asciinema-record   →  full-flow .cast      │
                    │  5. report-writer      →  structured JSON      │
                    │  6. issue-writer       →  gh CLI, dedup        │
                    └──────────────────────────────────────────┘
                                        │
                                        ▼
                    ┌──────────────────────────────────────────┐
                    │  Outputs:                                │
                    │    - workflow artifact: casts, screenshots, JSON report │
                    │    - GitHub issues (created / updated / auto-closed)    │
                    │    - meta-issue "Docs canary status" edited each run    │
                    └──────────────────────────────────────────┘
```

## Trigger set

Defined in `docs-canary.yml`:

```yaml
on:
  push:
    branches: [main, master, preview]
  pull_request:
    paths:
      - 'apps/site/pages/docs/**'
      - 'apps/site/pages/docs.mdx'
      - 'apps/site/theme.config.tsx'
  schedule:
    - cron: '17 4 * * 0'    # Sundays 04:17 UTC — weekly heartbeat
  workflow_dispatch:        # manual trigger for debugging
```

**Why weekly heartbeat matters even if code doesn't change:** catches upstream drift — a homebrew formula updates, an npm dep vanishes, Node LTS shifts, an OpenAI API surface changes. Doc doesn't have to move for the canary's semantics to break.

## Runner shape — reuses release.yml pattern

`.github/workflows/release.yml` already establishes: matrix of 4 platforms, asciinema install per OS, Bun+Node setup, artifact upload. **Steal it.** The canary is a sibling workflow, not an extension of release.yml (different trigger, different purpose, different lifecycle).

Skeleton (MVP scope):

```yaml
name: docs-canary

on: (see Trigger set above)

permissions:
  contents: read
  issues: write     # for gh CLI to create/update issues

jobs:
  canary:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: linux-x64
            runner: ubuntu-22.04
            install_path: native-node
            provider: openai
          - os: linux-x64
            runner: ubuntu-22.04
            install_path: docker
            provider: openai
          - os: darwin-arm64
            runner: macos-14
            install_path: native-node
            provider: openai
          - os: darwin-arm64
            runner: macos-14
            install_path: curl-install
            provider: openai

    runs-on: ${{ matrix.runner }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: '24' }

      - name: Install canary deps
        working-directory: packages/smartchats-docs-canary
        run: npm ci

      - name: Install asciinema (Linux)
        if: startsWith(matrix.runner, 'ubuntu')
        run: sudo apt-get update && sudo apt-get install -y asciinema

      - name: Install asciinema (macOS)
        if: startsWith(matrix.runner, 'macos')
        run: brew install asciinema

      - name: Install Playwright browsers
        working-directory: packages/smartchats-docs-canary
        run: npx playwright install --with-deps chromium

      - name: Run canary
        working-directory: packages/smartchats-docs-canary
        env:
          OPENAI_API_KEY:    ${{ secrets.CANARY_OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.CANARY_ANTHROPIC_API_KEY }}
          GEMINI_API_KEY:    ${{ secrets.CANARY_GEMINI_API_KEY }}
        run: |
          node dist/cli.js run \
            --docs-path ../../apps/site/pages/docs \
            --install-path ${{ matrix.install_path }} \
            --provider ${{ matrix.provider }} \
            --os ${{ matrix.os }} \
            --output-dir ./run-artifacts

      - name: Upload artifacts (always)
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: canary-${{ matrix.os }}-${{ matrix.install_path }}-${{ matrix.provider }}
          path: packages/smartchats-docs-canary/run-artifacts/
          retention-days: 30

      - name: Write findings to issues
        if: always()
        working-directory: packages/smartchats-docs-canary
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node dist/cli.js report --run-dir ./run-artifacts

  update-meta-issue:
    needs: canary
    if: always()
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - name: Update pinned meta-issue with matrix status
        working-directory: packages/smartchats-docs-canary
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node dist/cli.js update-meta-issue --run-id ${{ github.run_id }}
```

## MVP matrix — 4 runs per trigger

| OS | Install path | Provider |
|---|---|---|
| linux-x64 (ubuntu-22.04) | native-node (`npm install -g smartchats-ai`) | openai |
| linux-x64 (ubuntu-22.04) | docker (`docker run smartchats/smartchats-aio`) | openai |
| darwin-arm64 (macos-14) | native-node | openai |
| darwin-arm64 (macos-14) | curl-install (`curl -fsSL https://smartchats.ai/install | bash`) | openai |

Rationale:
- **native-node on both OSes** — most common contributor path; covers most of the "does npm install actually work" regressions
- **docker on Ubuntu** — where users self-host; catches image-pull, entrypoint, env-var wiring issues
- **curl-install on macOS** — the "magic install script" path; catches script rot + darwin-specific PATH/shell issues
- **openai only** — three-provider sweep triples spend + runtime for marginal coverage until anthropic/gemini paths show unique bugs; add in Phase 2

## Docs-as-spec parser

Input: `apps/site/pages/docs/quickstart.mdx` (and `self-host.mdx` in Phase 2).

Output: ordered list of `{ tag: string, kind: 'shell' | 'expect-url' | 'expect-ui', content: string }`.

Extraction rules:
1. Find all fenced `bash` / `sh` blocks
2. Skip blocks tagged `# skip-canary` (opt-out for illustrative snippets)
3. Filter by install-path tab context — quickstart uses Nextra `<Tabs>`; parser tracks which tab a block belongs to and only runs blocks matching the current run's `--install-path`
4. Extract Playwright expectations from `<Callout>` blocks and prose: "open http://localhost:3000" → `expect-url: http://localhost:3000`
5. Extract manual-step markers from prose: "start the container" → the block below it is inferred as "app-start step" (backgrounded, not blocking)

Nextra tab syntax:

```mdx
<Tabs items={['macOS & Linux', 'Windows', 'Package Managers', 'Docker']}>
  <Tabs.Tab>```bash \n curl -fsSL https://smartchats.ai/install | bash \n``` </Tabs.Tab>
  <Tabs.Tab>...</Tabs.Tab>
</Tabs>
```

Mapping: `curl-install` = tab 0, `native-node` = tab 2 (Package Managers), `docker` = tab 3. Explicit `--install-path` flag picks which tab's blocks to execute.

## Secrets model

**Canary-secrets are separate from production secrets.** Rationale: the canary executes shell blocks scraped from docs on runners with network egress; if a doc example ever exfiltrated env vars (hypothetical, but not paranoid), the blast radius should be "canary keys need rotation" not "prod compromised."

GitHub Actions secrets (open repo):

| Secret | Value | Hard cap |
|---|---|---|
| `CANARY_OPENAI_API_KEY` | Burner OpenAI key | $10/mo hard cap set in OpenAI dashboard |
| `CANARY_ANTHROPIC_API_KEY` | Burner Anthropic key | $10/mo usage limit in Anthropic console |
| `CANARY_GEMINI_API_KEY` | Burner Gemini key | Quota limit via Google Cloud console |

Hard caps are the primary cost defense — if a canary run somehow burns credit unexpectedly, the key stops working, canary reports failure, no infinite spend. No code-level accounting needed for MVP.

## Playwright evidence rig

Per install-path, after the "start the app" step:

```typescript
const browser = await chromium.launch();
const page = await browser.newPage();

// 1. Assert app loads
await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30_000 });
await page.screenshot({ path: 'evidence/01-loaded.png', fullPage: true });

// 2. Assert app renders (has expected element)
await page.waitForSelector('[data-testid="agent-input"]', { timeout: 10_000 });
await page.screenshot({ path: 'evidence/02-agent-ready.png' });

// 3. Send a message
await page.fill('[data-testid="agent-input"]', 'Hello, respond with the word "canary".');
await page.keyboard.press('Enter');

// 4. Wait for response
await page.waitForFunction(
  () => document.body.innerText.toLowerCase().includes('canary'),
  { timeout: 60_000 }
);
await page.screenshot({ path: 'evidence/03-response.png' });

await browser.close();
```

**Requires `data-testid` attributes** on the agent input + response area. Adding those is Phase 1 prerequisite work in `apps/smartchats/`. Small change (5–10 lines), unblocks the canary from brittle CSS-selector reliance.

Additionally: full session recorded as asciinema `.cast` alongside screenshots. The `.cast` is the audit trail — when a report says "step 4 failed on macos-14/curl-install," reviewer plays the tape to see the exact terminal state.

## Report schema (JSON, one per run)

```json
{
  "run_id": "16512345678",
  "trigger": {
    "event": "push",
    "sha": "abc123...",
    "branch": "main"
  },
  "matrix": {
    "os": "darwin-arm64",
    "install_path": "curl-install",
    "provider": "openai"
  },
  "started_at": "2026-07-25T04:17:00Z",
  "duration_seconds": 847,
  "verdict": "fail",
  "steps": [
    {
      "index": 0,
      "tag": "install",
      "kind": "shell",
      "cmd": "curl -fsSL https://smartchats.ai/install | bash",
      "exit_code": 0,
      "duration_seconds": 42,
      "stdout_tail": "...",
      "stderr_tail": ""
    },
    {
      "index": 1,
      "tag": "verify-version",
      "kind": "shell",
      "cmd": "smartchats --version",
      "exit_code": 127,
      "duration_seconds": 1,
      "stdout_tail": "",
      "stderr_tail": "smartchats: command not found"
    }
  ],
  "playwright_verdict": "not-reached",
  "artifacts": {
    "cast": "canary-darwin-arm64-curl-install-openai/full.cast",
    "screenshots": []
  },
  "findings": [
    {
      "symptom_hash": "9f2a1b...",
      "severity": "blocker",
      "title": "curl-install: smartchats command not on PATH after install on darwin-arm64",
      "description": "Install script exited 0 but `smartchats --version` returned 127. Likely PATH not updated in the same shell session; needs an explicit `source ~/.zshrc` or a new shell.",
      "evidence": {
        "step_index": 1,
        "cast_offset_ms": 42500
      }
    }
  ]
}
```

## Finding dedup — dependabot-style

Every finding gets a **symptom_hash** = SHA-256 of `(install_path, os, first_failing_step_tag, error_signature_normalized)`. Error signatures are normalized by stripping paths, timestamps, PIDs, temp-dir names.

Issue writer flow:

1. Query open issues with label `docs-canary` + custom field `symptom-hash:<hash>`
2. If found → post a comment: "Still failing as of run #N ({trigger sha}, {timestamp})"
3. If not found → open a new issue, label `docs-canary`, embed the symptom hash in the body (also as a hidden HTML comment for querying)
4. After N consecutive passing runs on the same matrix cell, auto-close the issue with comment "Resolved as of run #M"

Issue title format: `[canary] <os>/<install_path>: <human summary>`

Issue body includes:
- Symptom hash (both as visible metadata and as HTML comment `<!-- symptom-hash: 9f2a1b... -->` for reliable regex query)
- Link to the failing workflow run
- Link to the asciinema `.cast` artifact (workflow artifact URL — not linkable inline in issue markdown, but downloadable via `gh run download`)
- Suggested fix / affected doc section
- History section auto-updated per recurrence

## Meta-issue — pinned dashboard

One always-open issue titled `Docs canary — status dashboard`, pinned to the repo. Contents edited by every canary run:

```markdown
# Docs canary — status dashboard

Last run: 2026-07-25 04:17 UTC ([workflow #16512345678](...))

## Matrix

| OS × Install × Provider          | Verdict | Duration | Cast |
|---|---|---|---|
| ubuntu-22.04 / native-node / openai | ✅ pass | 12m 3s  | [play](...) |
| ubuntu-22.04 / docker / openai      | ✅ pass | 15m 41s | [play](...) |
| macos-14 / native-node / openai     | ✅ pass | 11m 22s | [play](...) |
| macos-14 / curl-install / openai    | ❌ fail | 8m 12s  | [play](...) |

## Open findings (3)

- [#412](...) `[canary] macos-14/curl-install: smartchats command not on PATH after install`
- [#398](...) `[canary] Linux casts missing from release.yml artifacts`
- [#397](...) `[canary] quickstart asciinema title claims 'smartchats setup' but recording is help/home/status`

## Recent runs

- 2026-07-25 04:17 UTC — 3/4 pass ([workflow](...))
- 2026-07-24 04:17 UTC — 3/4 pass ([workflow](...))
- 2026-07-23 12:31 UTC — 4/4 pass ([workflow](...))
```

**Silent passes are silent** except for updating this issue. No new-issue spam.

## Cost model — first-order estimate

Per run:
- GH Actions minutes: 15 min × Ubuntu ($0.008/min) = $0.12; 15 min × macOS ($0.08/min) = $1.20
- LLM API: ~$0.05 per run (one Hello-canary roundtrip is trivial spend)
- Storage: workflow artifacts free within retention window

Per trigger (4 runs): ~$2.60 (dominated by macOS runners)

Per month (assuming 5 push triggers/week + 4 heartbeat runs): ~$60/mo. If that becomes annoying, reduce macOS to weekly-only and keep Ubuntu on every push.

**Free** for public repos on GitHub Actions Linux minutes. macOS minutes are not free even on public repos. If cost pinches, drop macOS from per-push and keep it in the weekly cron only.

## Phase roadmap

**Phase 1 — MVP (Ubuntu native-node + darwin-arm64 native-node + Ubuntu docker + darwin-arm64 curl-install, openai only).**
- Package scaffold + MDX parser + Playwright rig + report writer + issue dedup + meta-issue
- 4-run matrix per trigger
- Ships when canary catches its own first regression on a real commit
- **Prereq**: add `data-testid` attributes to the agent input + response area in `apps/smartchats/`

**Phase 2 — Provider matrix.** Add anthropic + gemini. 12 runs/trigger. Report catches provider-specific docs gaps.

**Phase 3 — WSL runner.** Windows-latest with WSL2 install of Ubuntu. Tests the "Windows users use WSL2" path the docs recommend. Adds 3 runs (WSL × 3 install paths).

**Phase 4 — Tier 2 LLM UX critic.** Separate job (no runner needed, just an API call). Reads docs cold, grades clarity. Uses weaker models (Haiku, gpt-4o-mini) to mimic intermediate-skill new user. Aggregates findings from 3–4 model votes.

**Phase 5 — Tier 3 constrained agent.** LLM agent that actually tries to follow docs, with network airplane-moded to smartchats.ai + github.com only. Every escape attempt (Google, source-diving) logged as a docs gap.

**Phase 6 (roadmap only, no timeline).** Extension: publish findings to a hosted dashboard behind Cloudflare Access if issue-count outgrows GH's UI.

## Known asymmetries + open questions

1. **Docs at HEAD vs release version.** Docs deploy from HEAD of main. Install script (`curl -fsSL ...`) fetches latest release, which lags main. Canary running at HEAD may reference features that only exist in main but not in latest release. This is a REAL user-facing bug class (docs claim X, latest release doesn't have X), and the canary correctly catches it. Not a bug in the canary; a bug in release-cadence-vs-docs-cadence discipline.

2. **What counts as "the app works"?** MVP: text roundtrip through the SPA. Doesn't cover voice, MCP, plugins, agent tools, knowledge graph. Adding those to the canary is exponentially more work per marginal coverage — leaving to Phase 5+ or dropping entirely.

3. **What if docs change during the run?** Canary reads MDX at the triggering SHA (not `main` HEAD). Immutable input, reproducible run.

4. **LLM output nondeterminism.** Response text varies per run. Canary asserts a specific word ("canary") in the response, so the model has to actually respond coherently. Ambiguous failure mode: model returns a refusal or hedge without the word — canary reports fail. Acceptable false-positive rate; alternative (semantic match) is more infra.

5. **Docs updates mid-flight from a release.** If a docs PR merges while a canary run is in-flight for a previous SHA, no interference — each run pins to its own SHA. Multiple concurrent runs OK.

## Two demo findings — already surveyed, waiting for canary birthday

The following two issues were found by hand during design and would be the canary's first real opened issues (dogfooding proof):

**Demo finding 1 — asciinema title mismatch.**
Quickstart.mdx captions the video as *"`smartchats setup` — the install + first-run flow"* but release.yml records `smartchats help && smartchats home && smartchats status`. Silent since v0.3.0. Either the recording arguments or the caption is wrong.

**Demo finding 2 — Linux casts missing from release assets.**
release.yml runs asciinema on Linux runners but only `smartchats-darwin-arm64.cast` shows up in v0.3.4 assets. The record step has `|| true` at the end swallowing failures; likely a PTY-allocation issue on ubuntu-22.04 GH runners. macOS quickstart embed works after today's CORS fix; Linux embed would silently 404 if we ever added one.

Both stay handwritten in this DESIGN.md for now, opened as real issues on canary's first green run (proof-of-value).

## Implementation punch list (deferred; open questions first)

Rough sequence when we commit to build:

1. Scaffold `packages/smartchats-docs-canary/`: `package.json`, `tsconfig.json`, `src/cli.ts`, `dist/` build config
2. `src/mdx-parser.ts` — Nextra MDX → command sequence per install-path tab
3. `src/runner.ts` — spawn shell blocks with timeout + stdout/stderr capture
4. `src/playwright-verify.ts` — browser evidence rig
5. `src/report-writer.ts` — assemble JSON report + finding extraction
6. `src/issue-writer.ts` — gh CLI wrapper for dedup + meta-issue update
7. `src/symptom-hash.ts` — normalize error signatures for dedup
8. Add `data-testid` attributes to `apps/smartchats/` (prereq for Playwright)
9. `.github/workflows/docs-canary.yml` — full workflow per spec above
10. Create `CANARY_OPENAI_API_KEY` etc. secrets in repo settings; set hard caps at provider consoles
11. First `workflow_dispatch` run against `main` to verify end-to-end
12. Merge, watch first real push trigger, celebrate first opened issue

Estimate: 1–2 weeks solo work, gated by the `data-testid` prereq if the app team is slow to accept the small PR.
