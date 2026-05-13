# tests/ — scaffolding for smartchats-sessions tests

Tests are not yet wired (v0.1 ships pure functions; the integration surface is the CLI). When you add tests:

- Use `vitest` (consistent with `smartchats-database`).
- For pure functions (queries, summary, analysis modules), test with synthesized bundles — no DB connection needed.
- For end-to-end export, follow the pattern from `smartchats-database/tests/local_crud.test.ts`: pre-condition is a running AIO, dispatcher abstraction, refuse-on-populated-DB pattern.
- For analysis modules, the test pattern is `expect(analyzeFoo(fixtureBundle)).toEqual(expectedShape)` — keep fixtures tiny and committed.

Add `"test": "vitest run"` to `package.json` scripts when the first test file lands.
