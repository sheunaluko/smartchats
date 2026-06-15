/**
 * `sm release vX.Y.Z` (open) — wraps bin/release with optional auto-push.
 * `sm push-public` (open) — git push origin main from the open repo.
 *
 * bin/release: bumps packages/smartchats-cli/package.json, commits, tags.
 * It does NOT push (per project rule). sm release adds an optional
 * --push-tags step that follows up with `git push --follow-tags`, since
 * that is what fires the release.yml workflow on GitHub.
 *
 * sm push-public is the routine `git push origin main` from open — used to
 * keep the public repo (github.com/sheunaluko/smartchats) in sync after a
 * cluster of local commits. It is NOT a force push.
 */

import { spawn, execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import consola from 'consola';

import { detectRepo, readGitState } from '../lib/context.js';
import { preflight, parseCommonFlags, type PreflightCheck } from '../lib/preflight.js';
import { getExplain } from '../lib/descriptors.js';

export const releaseHelp = `sm release [version] [--patch|--minor|--major] [--npm] [--push-tags] [--yes] [--explain]  (open repo only)

Wraps bin/release. Validates version, bumps smartchats-cli, commits, tags.

Version selection:
  Defaults to a PATCH bump from packages/smartchats-cli/package.json's
  current version. So if package.json is at 0.3.2, \`sm release\` cuts v0.3.3.
  Override with --minor / --major for those bumps, or pass an explicit
  vX.Y.Z as a positional arg.

  Unpushed-tag detection: if the latest local tag isn't on origin (e.g.
  you ran \`sm release\` earlier and never pushed), \`sm release\`
  switches to "push existing" mode — no bump, no new tag. With
  --push-tags it publishes the existing tag instead of creating a new
  one. Without --push-tags it prints a hint and exits. To force a new
  release on top, pass an explicit vX.Y.Z.

Flags:
  --patch       (default) bump the patch component (0.3.2 → 0.3.3)
  --minor       bump minor, reset patch (0.3.2 → 0.4.0)
  --major       bump major, reset minor+patch (0.3.2 → 1.0.0)
  --npm         publish smartchats-ai to npm now (default: let CI do it)
  --push-tags   git push --follow-tags afterward (fires release.yml workflow)
  --yes         skip preflight prompt
  --explain     print descriptor + checks then exit

Examples:
  sm release                       # auto: patch bump from package.json
  sm release --minor               # auto: minor bump
  sm release v0.5.0                # explicit version (overrides auto)
  sm release --push-tags           # auto + push
`;

export const pushPublicHelp = `sm push-public  (open repo only)

Routine \`git push origin main\` from the open repo to github.com/sheunaluko/smartchats.

Refuses if: not on main, working tree dirty, no commits ahead of origin.

Flags:
  --yes         skip preflight prompt
  --explain     print descriptor + checks then exit
`;

function spawnInherit(cmd: string, args: string[], cwd: string): Promise<number> {
    return new Promise(resolve => {
        const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
        child.on('exit', code => resolve(code ?? 1));
        const fwd = (sig: NodeJS.Signals) => child.kill(sig);
        process.on('SIGINT', fwd);
        process.on('SIGTERM', fwd);
    });
}

// ---------------------------------------------------------------------------
// sm release
// ---------------------------------------------------------------------------

/**
 * Read `packages/smartchats-cli/package.json` and return its current
 * version string (without a leading `v`). Throws if the file or field
 * is missing — that would be a real repo problem, not something we
 * should paper over.
 */
function readCliVersion(repoRoot: string): string {
    const pkgPath = path.join(repoRoot, 'packages/smartchats-cli/package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    if (!pkg.version || typeof pkg.version !== 'string') {
        throw new Error(`packages/smartchats-cli/package.json missing 'version' field`);
    }
    return pkg.version;
}

/**
 * Compute the next version given a current X.Y.Z and a bump kind.
 * Returns the new version WITH a leading `v` (matches the tag format).
 * Pre-release suffixes on the current version (e.g. `0.3.2-beta.1`) are
 * stripped before bumping — releasing from a beta means moving to the
 * next stable.
 */
function computeNextVersion(current: string, bump: 'patch' | 'minor' | 'major'): string {
    const m = current.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) throw new Error(`Unparseable version in smartchats-cli/package.json: ${current}`);
    let [, majS, minS, patS] = m;
    let maj = Number(majS), min = Number(minS), pat = Number(patS);
    if (bump === 'patch') pat += 1;
    else if (bump === 'minor') { min += 1; pat = 0; }
    else if (bump === 'major') { maj += 1; min = 0; pat = 0; }
    return `v${maj}.${min}.${pat}`;
}

/** Local annotated tags matching the vX.Y.Z shape. */
function listLocalTags(root: string): string[] {
    try {
        const out = execFileSync('git', ['tag', '-l'], { cwd: root, encoding: 'utf8' });
        return out.split('\n').map(s => s.trim()).filter(s => /^v\d+\.\d+\.\d+/.test(s));
    } catch {
        return [];
    }
}

/**
 * Tags on `origin` — one network roundtrip via `git ls-remote --tags`.
 * Parses lines like `<sha>\trefs/tags/v0.3.2` (and the dereferenced
 * `^{}` variant for annotated tags). Timeout is 30s so a flaky network
 * doesn't hang the command indefinitely.
 */
function listOriginTags(root: string): Set<string> {
    try {
        const out = execFileSync('git', ['ls-remote', '--tags', 'origin'], {
            cwd: root, encoding: 'utf8', timeout: 30000,
        });
        const tags = new Set<string>();
        for (const line of out.split('\n')) {
            const m = line.match(/refs\/tags\/(v\d+\.\d+\.\d+[^\s^]*?)(\^\{\})?$/);
            if (m && m[1]) tags.add(m[1]);
        }
        return tags;
    } catch {
        return new Set();
    }
}

/** Semver-ish sort key (major, minor, patch). Pre-release suffixes ignored. */
function semverKey(tag: string): [number, number, number] {
    const m = tag.match(/^v(\d+)\.(\d+)\.(\d+)/);
    if (!m) return [-1, -1, -1];
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * The most recent local tag that isn't on origin. Returns null if every
 * local tag is already pushed (the happy state).
 */
function findLatestUnpushedTag(root: string): string | null {
    const local = listLocalTags(root);
    if (local.length === 0) return null;
    const origin = listOriginTags(root);
    const unpushed = local.filter(t => !origin.has(t));
    if (unpushed.length === 0) return null;
    unpushed.sort((a, b) => {
        const A = semverKey(a), B = semverKey(b);
        if (A[0] !== B[0]) return B[0] - A[0];
        if (A[1] !== B[1]) return B[1] - A[1];
        return B[2] - A[2];
    });
    return unpushed[0] ?? null;
}

export async function runRelease(argv: string[]): Promise<number> {
    if (argv.includes('-h') || argv.includes('--help')) {
        console.log(releaseHelp);
        return 0;
    }
    const repo = detectRepo();
    if (repo.kind !== 'open' || !repo.root) {
        consola.error('sm release is open-repo only.');
        return 1;
    }
    const flags = parseCommonFlags(argv);

    // Bump-type flags. Default is patch. Mutually exclusive.
    const bumpFlags = [
        argv.includes('--major') ? 'major' : null,
        argv.includes('--minor') ? 'minor' : null,
        argv.includes('--patch') ? 'patch' : null,
    ].filter(Boolean) as ('major' | 'minor' | 'patch')[];
    if (bumpFlags.length > 1) {
        consola.error(`--major / --minor / --patch are mutually exclusive (got: ${bumpFlags.join(', ')})`);
        return 1;
    }
    const bumpKind: 'major' | 'minor' | 'patch' = bumpFlags[0] ?? 'patch';

    // Explicit positional version (e.g. `v0.5.0`) overrides the auto path
    // AND the unpushed-tag detection — user is opting in to cutting that
    // specific tag.
    const explicitVersion = flags.positional.find(p => !p.startsWith('--'));

    const npmPublish = argv.includes('--npm');
    const pushTags = argv.includes('--push-tags');

    // Mode selection:
    //   create        — run bin/release to bump + tag + commit, optionally push
    //   push-existing — most recent local tag isn't on origin; skip bin/release
    //                   entirely and just push HEAD + that tag. Triggered only
    //                   when no explicit version was passed.
    let mode: 'create' | 'push-existing';
    let version: string;
    let versionSource: string;

    if (explicitVersion) {
        mode = 'create';
        version = explicitVersion;
        versionSource = `explicit (${explicitVersion})`;
    } else {
        const unpushed = findLatestUnpushedTag(repo.root);
        if (unpushed) {
            mode = 'push-existing';
            version = unpushed;
            versionSource = `push existing — already tagged locally, not on origin`;
        } else {
            mode = 'create';
            try {
                const current = readCliVersion(repo.root);
                version = computeNextVersion(current, bumpKind);
                versionSource = `auto: ${bumpKind} bump from package.json (${current} → ${version.replace(/^v/, '')})`;
            } catch (err) {
                consola.error((err as Error).message);
                return 1;
            }
        }
    }

    const git = readGitState(repo.root);
    const checks: PreflightCheck[] = [
        {
            label: 'mode',
            severity: 'pass',
            detail: mode === 'create' ? 'create new release (bump + tag + commit)' : 'push existing tag (no bump)',
        },
        {
            label: 'version',
            severity: 'pass',
            detail: `${version}  (${versionSource})`,
        },
        {
            label: 'on main branch',
            severity: git.branch === 'main' ? 'pass' : 'warn',
            detail: `current: ${git.branch}`,
            fix: git.branch === 'main' ? undefined : 'Release from feature branches is allowed but unusual.',
        },
        // Working tree cleanliness only matters in 'create' mode — bin/release
        // makes a commit. In 'push-existing' mode we're not modifying anything
        // locally, so a dirty tree is fine.
        {
            label: 'working tree clean',
            severity: mode === 'create' && git.dirty ? 'block' : 'pass',
            detail: git.dirty ? 'uncommitted changes' : 'clean',
            fix: mode === 'create' && git.dirty ? 'Commit or stash first.' : undefined,
        },
        {
            label: 'npm publish',
            severity: npmPublish && mode === 'push-existing' ? 'warn' : npmPublish ? 'warn' : 'pass',
            detail: mode === 'push-existing' && npmPublish
                ? '--npm has no effect in push-existing mode (no new package version)'
                : npmPublish
                    ? '--npm: will publish to npm directly (bypassing CI)'
                    : 'will let CI publish after tag push',
        },
        {
            label: 'push tags',
            severity: pushTags ? 'warn' : 'pass',
            detail: pushTags
                ? `--push-tags: will git push --follow-tags (publishes ${version}, fires release.yml)`
                : mode === 'push-existing'
                    ? `${version} is tagged locally but not on origin — re-run with --push-tags to publish`
                    : 'will NOT push (run `git push --follow-tags` yourself when ready)',
        },
    ];

    const descriptor = getExplain('release')!;
    const r = await preflight({ descriptor, checks, autoConfirm: flags.yes, explainOnly: flags.explain });
    if (!r.proceed) return r.reason === 'explain-only' ? 0 : 1;

    if (mode === 'push-existing') {
        if (!pushTags) {
            consola.info(`${version} is tagged locally but not on origin.`);
            consola.info(`Run with --push-tags to publish, or pass an explicit vX.Y.Z to cut a new one.`);
            return 0;
        }
        consola.start(`git push --follow-tags  (publishing existing tag ${version})`);
        return await spawnInherit('git', ['push', '--follow-tags'], repo.root);
    }

    // mode === 'create'
    const releaseBin = path.join(repo.root, 'bin/release');
    const releaseArgs = [version];
    if (npmPublish) releaseArgs.push('--npm');
    const releaseExit = await spawnInherit(releaseBin, releaseArgs, repo.root);
    if (releaseExit !== 0) return releaseExit;

    if (pushTags) {
        consola.start('git push --follow-tags');
        return await spawnInherit('git', ['push', '--follow-tags'], repo.root);
    }
    return 0;
}

// ---------------------------------------------------------------------------
// sm push-public
// ---------------------------------------------------------------------------

export async function runPushPublic(argv: string[]): Promise<number> {
    if (argv.includes('-h') || argv.includes('--help')) {
        console.log(pushPublicHelp);
        return 0;
    }
    const repo = detectRepo();
    if (repo.kind !== 'open' || !repo.root) {
        consola.error('sm push-public is open-repo only.');
        return 1;
    }
    const flags = parseCommonFlags(argv);
    const git = readGitState(repo.root);

    const checks: PreflightCheck[] = [
        {
            label: 'on main',
            severity: git.branch === 'main' ? 'pass' : 'block',
            detail: `current: ${git.branch}`,
            fix: 'git checkout main',
        },
        {
            label: 'working tree clean',
            severity: git.dirty ? 'block' : 'pass',
            detail: git.dirty ? 'uncommitted changes' : 'clean',
            fix: 'Commit or stash first.',
        },
        {
            label: 'commits to push',
            severity: git.ahead > 0 ? 'pass' : 'block',
            detail: git.ahead > 0 ? `${git.ahead} ahead of origin/main` : 'nothing to push',
            fix: git.ahead > 0 ? undefined : 'Make a commit first.',
        },
    ];

    const descriptor = getExplain('push-public')!;
    const r = await preflight({ descriptor, checks, autoConfirm: flags.yes, explainOnly: flags.explain });
    if (!r.proceed) return r.reason === 'explain-only' ? 0 : 1;

    return await spawnInherit('git', ['push', 'origin', 'main'], repo.root);
}
