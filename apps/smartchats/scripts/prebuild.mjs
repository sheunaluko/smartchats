#!/usr/bin/env node
// Cross-platform prebuild for apps/smartchats. Pure Node — no shell, no
// Bash-isms — so it runs identically on macOS, Linux, and Windows (where
// the previous `cp -r` / `rm -rf` / `[ -d ... ]` flavored npm scripts
// broke under cmd.exe).
//
// Subcommands:
//   site         build apps/site if needed, then copy ../site/out → public/_site
//   assets       copy onnxruntime-web + vad-web + graphology + sigma into public/
//   cleanup-onnx prune unused onnxruntime-web variants from public/onnx
//   all          run site → assets → cleanup-onnx in order
//
// Run via: `node scripts/prebuild.mjs <subcommand>` (the npm scripts in
// apps/smartchats/package.json shell out to this).

import { existsSync, mkdirSync, rmSync, cpSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '..');                  // apps/smartchats
const REPO_ROOT = join(APP_DIR, '..', '..');            // repo root
const SITE_DIR = join(APP_DIR, '..', 'site');           // apps/site
const NODE_MODULES = join(REPO_ROOT, 'node_modules');

function step(msg) { console.log(`> prebuild: ${msg}`); }
function ensureDir(p) { mkdirSync(p, { recursive: true }); }
function rmTree(p) { rmSync(p, { recursive: true, force: true }); }

function copyMatching(srcDir, destDir, predicate) {
    ensureDir(destDir);
    for (const entry of readdirSync(srcDir)) {
        if (!predicate(entry)) continue;
        const src = join(srcDir, entry);
        if (!statSync(src).isFile()) continue;
        copyFileSync(src, join(destDir, basename(entry)));
    }
}

function prebuildSite() {
    const siteOut = join(SITE_DIR, 'out');
    if (!existsSync(siteOut)) {
        step('apps/site/out missing — building apps/site');
        execSync('npm run build', { cwd: SITE_DIR, stdio: 'inherit' });
    } else {
        step('reusing existing apps/site/out');
    }
    const target = join(APP_DIR, 'public', '_site');
    step(`syncing apps/site/out → ${target}`);
    rmTree(target);
    cpSync(siteOut, target, { recursive: true });
}

function prebuildAssets() {
    const onnxDest = join(APP_DIR, 'public', 'onnx');
    const libDest = join(APP_DIR, 'public', 'lib');

    const onnxSrc = join(NODE_MODULES, 'onnxruntime-web', 'dist');
    step(`copying onnxruntime-web *.{wasm,mjs} → ${onnxDest}`);
    copyMatching(onnxSrc, onnxDest, (n) => n.endsWith('.wasm') || n.endsWith('.mjs'));

    const vadSrc = join(NODE_MODULES, '@ricky0123', 'vad-web', 'dist', 'silero_vad_v5.onnx');
    step(`copying vad-web/silero_vad_v5.onnx → ${onnxDest}`);
    copyFileSync(vadSrc, join(onnxDest, 'silero_vad_v5.onnx'));

    ensureDir(libDest);
    step(`copying graphology + sigma → ${libDest}`);
    copyFileSync(
        join(NODE_MODULES, 'graphology', 'dist', 'graphology.umd.min.js'),
        join(libDest, 'graphology.umd.min.js'),
    );
    copyFileSync(
        join(NODE_MODULES, 'sigma', 'dist', 'sigma.min.js'),
        join(libDest, 'sigma.min.js'),
    );
}

// Mirrors the original cleanup-onnx Bash glob list. The onnxruntime-web
// dist ships many runtime variants (webgl, webgpu, node, asyncify, jsep,
// debug bundles, sourcemaps) we don't use. Pruning them saves ~few MB
// in the deployed bundle. Anything matched here is removed *after* the
// asset copy step.
function cleanupOnnx() {
    const onnxDir = join(APP_DIR, 'public', 'onnx');
    if (!existsSync(onnxDir)) {
        step('public/onnx absent — nothing to clean');
        return;
    }
    const exactNames = new Set([
        'ort.all.mjs', 'ort.mjs', 'ort.min.mjs', 'silero_vad_legacy.onnx',
    ]);
    const prefixDeletes = ['ort.all.bundle.', 'ort.bundle.', 'ort.webgl.', 'ort.webgpu.', 'ort.node.'];
    const substringDeletes = ['asyncify', 'jsep'];
    const extDeletes = ['.js', '.map'];

    let removed = 0;
    for (const entry of readdirSync(onnxDir)) {
        const full = join(onnxDir, entry);
        const isCpuDir = entry === 'cpu' && statSync(full).isDirectory();
        if (isCpuDir) { rmTree(full); removed++; continue; }
        const shouldDelete =
            exactNames.has(entry) ||
            prefixDeletes.some((p) => entry.startsWith(p)) ||
            substringDeletes.some((s) => entry.includes(s)) ||
            extDeletes.some((e) => entry.endsWith(e));
        if (shouldDelete) { rmSync(full, { force: true }); removed++; }
    }
    step(`cleanup-onnx removed ${removed} entr${removed === 1 ? 'y' : 'ies'}`);
}

const cmd = process.argv[2];
switch (cmd) {
    case 'site':         prebuildSite(); break;
    case 'assets':       prebuildAssets(); cleanupOnnx(); break;
    case 'cleanup-onnx': cleanupOnnx(); break;
    case 'all':          prebuildSite(); prebuildAssets(); cleanupOnnx(); break;
    default:
        console.error('Usage: node scripts/prebuild.mjs <site|assets|cleanup-onnx|all>');
        process.exit(1);
}
