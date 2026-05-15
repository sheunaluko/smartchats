# Publishing the `smartchats` CLI

Maintainer notes for cutting a new npm release. Not user-facing.

## How the package is built

Two build paths share the same `src/`:

| Script | Output | When |
|---|---|---|
| `npm run build` (`tsc`) | Per-file `dist/*.js` matching the source tree. References workspace deps via npm symlinks. | Dev — what other workspace packages link against. |
| `npm run build:bundle` (`tsup`) | A single self-contained `dist/cli.js` (~60 KB) with all `smartchats-*` workspace deps inlined. Npm deps (`consola`, `@inquirer/prompts`, `open`, `surrealdb`) stay external and resolve at install time. | Publish — what gets shipped to npm. |

`prepack` automatically runs `build:bundle`, so `npm publish` always ships the bundled artifact.

## Local smoke test before publishing

From the repo root:

```bash
# Produce the tarball (also runs build:bundle via prepack)
npm pack --workspace=packages/smartchats-cli

# Install it as a dep in a clean throwaway dir
mkdir -p /tmp/sc-smoke && cd /tmp/sc-smoke
npm init -y > /dev/null
npm install /path/to/smartchats-0.1.0.tgz

# Verify the binary works
node_modules/.bin/smartchats --help
node_modules/.bin/smartchats doctor          # should exit 0
node_modules/.bin/smartchats launch          # should fail with the friendly "no repo found" message
```

The `launch` failure is the expected Phase 1 behavior — Phase 3 will ship a prebuilt
Docker image so it works without a local clone.

## Publish steps

1. Bump version in `packages/smartchats-cli/package.json` (`npm version <patch|minor|major>` from inside the package).
2. From repo root: `npm publish --workspace=packages/smartchats-cli --access=public`.
3. Tag the release: `git tag smartchats-cli-vX.Y.Z && git push --tags`.
4. Verify on npm: <https://www.npmjs.com/package/smartchats-ai>.

## Things to watch on each release

- **Workspace dep drift**: if you add an `import` from a new workspace package, add it to `devDependencies` (so tsup can bundle it) and the `noExternal` pattern in `tsup.config.ts` already catches `^smartchats-*` so it's auto-inlined. Verify by checking the bundled `dist/cli.js` size after build.
- **New npm runtime deps**: add to `dependencies` so they're declared in the published package.json.
- **Shebang on `src/cli.ts`**: tsup preserves the source `#!/usr/bin/env node`; if you remove it from source, the bin entry breaks.
- **`files:` allowlist**: only `dist/`, `README.md`, `LICENSE` ship. `src/`, `tsup.config.ts`, `tsconfig.json` are excluded.
