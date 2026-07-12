'use client';

import { useDesignPack } from '../../core/DesignPackContext';

/**
 * BuildStamp — subtle bottom-right badge showing when this bundle was built.
 *
 * Values injected at build time via `env` in next.config.mjs:
 *   NEXT_PUBLIC_BUILD_DATE — ISO datetime of the build
 *   NEXT_PUBLIC_BUILD_SHA  — short SHA (7 chars) of the deploy commit
 *                            (empty locally; Vercel injects VERCEL_GIT_COMMIT_SHA)
 *
 * Positioned fixed so it survives shell swaps and any grid layout. Kept
 * behind pointer-events so it doesn't intercept clicks. Rendered only
 * when the build metadata is available (so `next dev` doesn't show a
 * misleading empty tag).
 *
 * Color adapts to the active theme via DesignPackContext.mode — reads
 * darker on light backgrounds, lighter on dark backgrounds, either way
 * kept at low opacity so it stays out of the way.
 */

function fmtBuildDate(iso: string): string {
    try {
        const d = new Date(iso);
        // e.g. "Jul 12, 2026" — calendar date only, no time.
        return d.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    } catch {
        return iso.slice(0, 10);
    }
}

export function BuildStamp(): JSX.Element | null {
    const date = process.env.NEXT_PUBLIC_BUILD_DATE;
    const sha = process.env.NEXT_PUBLIC_BUILD_SHA;
    const { mode } = useDesignPack();
    if (!date) return null;

    const label = fmtBuildDate(date);
    const color = mode === 'dark' ? 'rgba(220, 220, 220, 0.55)' : 'rgba(60, 60, 60, 0.55)';
    return (
        <div
            aria-label="build info"
            style={{
                position: 'fixed',
                bottom: 6,
                right: 10,
                fontSize: 10,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                color,
                letterSpacing: 0.25,
                pointerEvents: 'none',
                userSelect: 'none',
                zIndex: 1,
            }}
        >
            built {label}{sha ? ` · ${sha}` : ''}
        </div>
    );
}
