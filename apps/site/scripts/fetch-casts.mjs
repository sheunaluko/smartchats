#!/usr/bin/env node
/**
 * Downloads latest release's .cast files into public/casts/ at docs build time.
 *
 * Why server-side download: GitHub release-asset URLs redirect to a signed
 * backend that doesn't send Access-Control-Allow-Origin. Client-side fetch()
 * from the docs site to a github.com release URL is blocked by CORS, which
 * silently broke the AsciinemaCast embed on the quickstart page for over a
 * month before anyone noticed. Fetching server-side at build time and serving
 * from same-origin sidesteps the issue entirely.
 *
 * Runs as `prebuild`. Failures are non-fatal — if GH is unreachable or the
 * latest release has no .cast assets, docs still build. The AsciinemaCast
 * component has a "cast missing" fallback state that renders a download link.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = 'sheunaluko';
const REPO = 'smartchats';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'casts');

async function main() {
    const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
    const headers = { accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) {
        headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    let res;
    try {
        res = await fetch(apiUrl, { headers });
    } catch (err) {
        console.warn(`[fetch-casts] Network error contacting GitHub — skipping (${err.message})`);
        return;
    }
    if (!res.ok) {
        console.warn(`[fetch-casts] GH API returned ${res.status} — skipping cast download`);
        return;
    }
    const release = await res.json();
    const casts = (release.assets ?? []).filter((a) => a.name.endsWith('.cast'));
    if (casts.length === 0) {
        console.warn(`[fetch-casts] Latest release ${release.tag_name} has no .cast assets — skipping`);
        return;
    }

    await mkdir(OUT_DIR, { recursive: true });
    let downloaded = 0;
    for (const asset of casts) {
        try {
            const dl = await fetch(asset.browser_download_url, { redirect: 'follow' });
            if (!dl.ok) {
                console.warn(`[fetch-casts] ${asset.name}: HTTP ${dl.status}`);
                continue;
            }
            const buf = Buffer.from(await dl.arrayBuffer());
            await writeFile(join(OUT_DIR, asset.name), buf);
            console.log(`[fetch-casts] ${asset.name} (${buf.length} bytes) from ${release.tag_name}`);
            downloaded++;
        } catch (err) {
            console.warn(`[fetch-casts] ${asset.name}: ${err.message}`);
        }
    }
    console.log(`[fetch-casts] Downloaded ${downloaded}/${casts.length} casts to public/casts/`);
}

main().catch((err) => {
    console.warn(`[fetch-casts] Unexpected error: ${err.message} — continuing build`);
});
