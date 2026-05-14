# smartchats-test

Layered test runner for the smartchats monorepo. Each "level" is one stage of the pipeline; levels run in order with fail-fast semantics by default. Private — never published.

## Layers

| L# | Name | What it does | Cost |
|---|---|---|---|
| L0 | `lint`        | `turbo run lint --continue` across the workspace | seconds (cached) |
| L1 | `build`       | `turbo run build` — `tsc` emit type-checks every package | seconds-minutes |
| L2 | `unit`        | `npm run test:unit` in every package that defines it (typically vitest) | seconds-minutes |
| L3 | `integration` | infra-dependent tests (cloud_test_db, AIO). **Caller brings infra up first.** Currently stubbed. | minutes |
| L4 | `e2e`         | Playwright Simi suite (`apps/smartchats/tests/e2e/simi.spec.ts`) | ~10-15 min |

## Usage

```bash
# Default — non-infra levels (L0 + L1 + L2 if any test:unit scripts exist)
npx smartchats-test
# or
node packages/smartchats-test/bin.js

# Specific levels
npx smartchats-test build
npx smartchats-test build,unit

# All levels (including infra-dependent — bring up cloud_test_db + AIO first)
npx smartchats-test all

# Just type-check & build
npx smartchats-test quick

# Don't bail on first failure — run every selected level + report at end
npx smartchats-test --continue-on-failure

# List levels
npx smartchats-test --list
```

`--include-infra` flips the default selector to also run `requiresInfra` levels (L3, L4).

Exit code 0 if every selected level passes (or skips); 1 if any fails.

## Programmatic use

```ts
import { runLevels, ALL_LEVELS, findRepoRoot } from 'smartchats-test';

const outcome = await runLevels({
    repoRoot: findRepoRoot(),
    levels: ALL_LEVELS.filter((l) => !l.requiresInfra),
    continueOnFailure: false,
});
console.log(outcome.passed, outcome.duration_ms);
```

## Adding a level

1. Create `src/levels/your_level.ts` exporting a `Level`:
   ```ts
   export const yourLevel: Level = {
       id: 5,
       name: 'your_name',
       description: 'one-line summary',
       requiresInfra: false,   // true if caller must pre-stage running services
       async run(ctx) { ... return { status: 'PASS' }; }
   };
   ```
2. Register it in `src/levels/index.ts` (`ALL_LEVELS`).
3. Done. CLI picks it up automatically (visible via `--list`).

## Why a package, not a bash script?

The legacy tooling had `bin/test_all` (392 lines of bash) + `bin/verify_9_0g` (277 lines, migration-specific). The bash version had no types, no shared utilities (workspace introspection, exec helpers, status formatting were inlined per script), and was hard to compose.

`smartchats-test` is a TS package because:
- Levels are typed objects (`Level`), not function names in a global lookup
- Workspace introspection is shared (`findRepoRoot`, `listPackages`)
- Exec helper handles streaming + capture in one place
- Adding/removing levels is a 1-file edit, not a search across multiple bash scripts
- CI consumers can `import { runLevels }` programmatically

The bin/ pattern stays for orchestration shell scripts (Docker, env symlinks, process management) where bash IS the right tool.
