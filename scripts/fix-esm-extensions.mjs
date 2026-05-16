#!/usr/bin/env node
/**
 * Walk a tree of compiled `.js` files (e.g. a workspace package's `dist/`)
 * and rewrite extensionless relative imports to satisfy Node's strict ESM
 * resolver. Source files stay untouched; only the build output is modified.
 *
 * Without this, TypeScript compiles `import { x } from './foo'` verbatim,
 * but `node` (ESM mode) refuses to resolve it: ESM requires explicit
 * extensions for relative imports, with no fallback to directory
 * `index.js` lookup.
 *
 * Usage:
 *   node scripts/fix-esm-extensions.mjs <path1> [<path2> ...]
 *
 * For each .js file found, every relative `from '...'` / `import '...'`
 * is checked. If the specifier resolves to a real `.js` file or a
 * directory with `index.js`, the specifier is rewritten in place.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('usage: fix-esm-extensions.mjs <dir> [<dir> ...]');
    process.exit(1);
}

let totalFiles = 0;
let touchedFiles = 0;
let totalRewrites = 0;

function walk(dir, onFile) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p, onFile);
        else if (ent.isFile() && (p.endsWith('.js') || p.endsWith('.mjs'))) onFile(p);
    }
}

// Match `from "./..."`, `from '...'`, `import("./...")`. Captures the
// quote char and the specifier so we can preserve quoting.
const RE = /\b(from|import)(\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\3/g;

function resolveSpecifier(file, spec) {
    const dir = path.dirname(file);
    const target = path.resolve(dir, spec);

    // Already has a JS-ish extension? Leave alone.
    if (/\.(m?js|cjs|json|css|svg|png|jpg|jpeg|gif|wasm)$/.test(spec)) return null;

    // Pointing at a real .js file?
    if (fs.existsSync(target + '.js')) return spec + '.js';

    // Pointing at a directory with index.js?
    if (fs.existsSync(path.join(target, 'index.js'))) {
        return spec.replace(/\/?$/, '/index.js');
    }

    // Could be a TS-only path (`.d.ts`) or external-looking — leave it.
    return null;
}

function processFile(file) {
    totalFiles++;
    const before = fs.readFileSync(file, 'utf8');
    let rewrites = 0;

    const after = before.replace(RE, (full, kw, ws, q, spec) => {
        const fixed = resolveSpecifier(file, spec);
        if (!fixed || fixed === spec) return full;
        rewrites++;
        return `${kw}${ws}${q}${fixed}${q}`;
    });

    if (rewrites > 0) {
        fs.writeFileSync(file, after);
        touchedFiles++;
        totalRewrites += rewrites;
    }
}

for (const root of args) {
    if (!fs.existsSync(root)) {
        console.error(`skip: ${root} does not exist`);
        continue;
    }
    walk(root, processFile);
}

console.log(
    `[fix-esm-extensions] scanned ${totalFiles} .js files, ` +
    `rewrote ${totalRewrites} import(s) across ${touchedFiles} file(s)`,
);
