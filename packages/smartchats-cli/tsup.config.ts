import { defineConfig } from 'tsup';

/**
 * Bundle config for the published `smartchats` npm package.
 *
 * Strategy:
 *   - Inline all workspace deps (smartchats-*) so the tarball is self-contained.
 *   - Leave third-party npm deps external — they resolve at install time
 *     against the consumer's npm registry.
 *
 * This is invoked by the `build:bundle` script (and via `prepack`) when
 * preparing for npm publish. The default `build` (tsc) stays the dev path:
 * it produces unbundled `dist/` that the workspace links against directly,
 * so editing source in any package shows up immediately in other workspace
 * consumers.
 */
export default defineConfig({
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    outDir: 'dist',
    sourcemap: true,
    clean: true,
    splitting: false,
    target: 'node20',
    platform: 'node',
    // Inline every workspace package; leave npm deps as-is.
    noExternal: [/^smartchats-/],
    // src/cli.ts has its own `#!/usr/bin/env node` — tsup preserves it.
    // Don't generate .d.ts — the CLI binary is invoked, not imported.
    dts: false,
});
