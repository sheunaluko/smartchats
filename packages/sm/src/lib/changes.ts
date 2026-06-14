/**
 * Diff + path categorization.
 *
 * "What did you change since X?" is the question Phase 3 answers. Given a
 * git ref + a repo kind, return a categorized summary of changed paths so
 * `sm status` can say "you touched functions/ — run `sm deploy functions`."
 *
 * Categories are deliberately coarse-grained:
 *
 *   functions          — backend code that ships in a Firebase Functions deploy
 *   schema             — DDL / migrations; must be applied before functions
 *                        depend on them
 *   frontend           — apps/smartchats/ or apps/site/ or overlay — ships via
 *                        Vercel on git push
 *   vendored           — packages/* that originate in the open repo and got
 *                        rsynced in; touching these in the cloud repo is a
 *                        symptom (the canonical fix is to edit in open + sync)
 *   release-relevant   — open repo: changes that should trigger a version bump
 *   release-infra      — changes to bin/release / scripts/build-release.sh /
 *                        .github/workflows/release.yml
 *   docs               — *.md, docs/, README — usually safe to push without
 *                        verify regression
 *   tests              — *.test.* / __tests__/ / simi workflows / e2e specs
 *   sm                 — packages/sm/ self-changes (so we notice when the tool
 *                        itself changes; useful for hot-deploying sm changes)
 *   other              — uncategorized; surfaced as a count
 */

import { execSync } from 'node:child_process';
import type { RepoKind } from './context.js';

export type ChangeCategory =
    | 'functions'
    | 'schema'
    | 'frontend'
    | 'vendored'
    | 'release-relevant'
    | 'release-infra'
    | 'docs'
    | 'tests'
    | 'sm'
    | 'other';

export interface CategorizedChanges {
    /** Map category → array of file paths in that category. Empty arrays elided. */
    byCategory: Partial<Record<ChangeCategory, string[]>>;
    /** Total changed file count. */
    total: number;
    /** Raw file list, for display. */
    files: string[];
    /** Was the diff range empty (ref unreachable, no commits, etc)? */
    empty: boolean;
}

function gitDiffNameOnly(root: string, fromRef: string | null): string[] {
    try {
        const range = fromRef ? `${fromRef}...HEAD` : 'HEAD';
        const out = execSync(`git diff --name-only ${range}`, {
            cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        });
        return out.split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * Categorize a single path using repo-specific rules.
 */
function categorize(path: string, repo: RepoKind): ChangeCategory {
    // Tests come first because they cross-cut every other category.
    if (
        path.includes('/__tests__/') ||
        /\.(test|spec)\.[tj]sx?$/.test(path) ||
        path.includes('/tests/') ||
        path.includes('/test/') ||
        path.endsWith('.spec.ts') ||
        path.endsWith('.spec.tsx')
    ) {
        return 'tests';
    }
    // Docs.
    if (
        path.endsWith('.md') ||
        path.endsWith('.mdx') ||
        path.startsWith('docs/') ||
        path === 'README' ||
        path === 'README.md' ||
        path === 'CHANGELOG.md' ||
        path === 'CLAUDE.md'
    ) {
        return 'docs';
    }
    // sm self-changes.
    if (path.startsWith('packages/sm/')) return 'sm';

    if (repo === 'cloud') {
        if (path.startsWith('packages/smartchats-cloud/functions/')) return 'functions';
        if (path.startsWith('packages/smartchats-cloud/billing/')) return 'functions';
        if (path.startsWith('packages/smartchats-cloud/scripts/test_stripe')) return 'functions';
        if (path.startsWith('packages/smartchats-cloud/schema/')) return 'schema';
        if (path.startsWith('packages/smartchats-cloud/scripts/apply_cloud_schema')) return 'schema';
        if (path.startsWith('apps/smartchats/')) return 'frontend';
        if (path.startsWith('apps/site/')) return 'frontend';
        if (path.startsWith('overlays/')) return 'frontend';
        // packages/* that aren't smartchats-cloud are vendored from open.
        if (path.startsWith('packages/') && !path.startsWith('packages/smartchats-cloud/')) {
            return 'vendored';
        }
        return 'other';
    }

    if (repo === 'open') {
        if (path.startsWith('packages/smartchats-cli/')) return 'release-relevant';
        if (path === 'bin/release' || path.startsWith('scripts/build-release.') ||
            path === '.github/workflows/release.yml' || path === 'scripts/install.sh') {
            return 'release-infra';
        }
        if (path.startsWith('apps/smartchats/')) return 'frontend';
        if (path.startsWith('apps/site/')) return 'frontend';
        return 'other';
    }

    return 'other';
}

export function categorizeChanges(root: string, fromRef: string | null, repo: RepoKind): CategorizedChanges {
    const files = gitDiffNameOnly(root, fromRef);
    if (files.length === 0) {
        return { byCategory: {}, total: 0, files: [], empty: fromRef !== null && files.length === 0 };
    }
    const byCategory: Partial<Record<ChangeCategory, string[]>> = {};
    for (const f of files) {
        const cat = categorize(f, repo);
        (byCategory[cat] ??= []).push(f);
    }
    return { byCategory, total: files.length, files, empty: false };
}

/** Convenience: which deploy targets does this change set imply? */
export function impliedDeployTargets(c: CategorizedChanges): Array<'functions' | 'frontend' | 'schema'> {
    const out: Array<'functions' | 'frontend' | 'schema'> = [];
    if (c.byCategory.schema?.length) out.push('schema');
    if (c.byCategory.functions?.length) out.push('functions');
    if (c.byCategory.frontend?.length || c.byCategory.vendored?.length) out.push('frontend');
    return out;
}
