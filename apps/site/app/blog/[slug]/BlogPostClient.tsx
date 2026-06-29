'use client';

/**
 * Client wrapper around a blog post that owns the theme toggle.
 *
 * Theme is persisted to localStorage under `smartchats.blog.theme` so a
 * reader's choice sticks across reloads and across posts. SSR-safe:
 * initial render is the default theme (light); the persisted value is
 * applied on mount.
 *
 * CSS variables are set on the root <main> so first-party markdown
 * embeds (audio cards, custom callouts) can reference them via
 * `style="background: var(--card-bg)"` and restyle with the theme
 * without duplicating HTML for each variant.
 */

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import PostRenderer, { type Theme } from './PostRenderer';
import PostHeader from './PostHeader';
import BackLink from './BackLink';
import type { BlogPost } from '../../../content/blog/_posts';

const THEME_STORAGE_KEY = 'smartchats.blog.theme';

interface Props {
    post: BlogPost;
    markdown: string;
}

export default function BlogPostClient({ post, markdown }: Props) {
    const [theme, setTheme] = useState<Theme>('light');

    useEffect(() => {
        try {
            const saved = localStorage.getItem(THEME_STORAGE_KEY);
            if (saved === 'dark' || saved === 'light') setTheme(saved);
        } catch { /* localStorage blocked — fine, stick with default */ }
    }, []);

    const setAndPersist = (next: Theme) => {
        setTheme(next);
        try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* noop */ }
    };

    const isLight = theme === 'light';

    // CSS variables consumed by inline-styled markdown HTML (audio cards,
    // colored callouts) so they restyle with the theme. Keep the names
    // stable — they appear in the markdown source.
    const themeVars = isLight
        ? {
              '--blog-card-bg': '#fafafa',
              '--blog-card-border': '#e5e7eb',
              '--blog-card-shadow': '0 1px 2px rgba(0,0,0,0.05)',
              '--blog-card-row-bg': 'rgba(0,0,0,0.03)',
              '--blog-card-label-bad': '#dc2626',
              '--blog-card-label-good': '#16a34a',
              '--blog-card-label-neutral': '#6b7280',
              '--blog-card-meta': '#6b7280',
              '--blog-card-text': '#374151',
              '--blog-card-bad-bg': '#fef2f2',
              '--blog-card-good-bg': '#f0fdf4',
              '--blog-card-neutral-bg': '#fafafa',
              '--blog-callout-text': '#4b5563',
          }
        : {
              '--blog-card-bg': '#1f1f1f',
              '--blog-card-border': '#333333',
              '--blog-card-shadow': 'none',
              '--blog-card-row-bg': 'rgba(255,255,255,0.05)',
              '--blog-card-label-bad': '#f87171',
              '--blog-card-label-good': '#4ade80',
              '--blog-card-label-neutral': '#9ca3af',
              '--blog-card-meta': '#888888',
              '--blog-card-text': '#cccccc',
              '--blog-card-bad-bg': '#1f1f1f',
              '--blog-card-good-bg': '#1f1f1f',
              '--blog-card-neutral-bg': '#1f1f1f',
              '--blog-callout-text': '#aaaaaa',
          };

    return (
        <main
            className={`min-h-screen transition-colors ${isLight ? 'bg-white' : 'bg-black'}`}
            style={themeVars as React.CSSProperties}
        >
            {/* Theme toggle — fixed top right, unobtrusive */}
            <button
                type="button"
                onClick={() => setAndPersist(isLight ? 'dark' : 'light')}
                aria-label={`Switch to ${isLight ? 'dark' : 'light'} theme`}
                className={`fixed top-4 right-4 z-50 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    isLight
                        ? 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 shadow-sm'
                        : 'bg-black border-white/30 text-white/80 hover:bg-white/10'
                }`}
            >
                {isLight ? <Moon size={13} /> : <Sun size={13} />}
                <span>{isLight ? 'Dark theme' : 'Light theme'}</span>
            </button>

            <div className="mx-auto max-w-3xl px-6 py-12 sm:py-20">
                <BackLink theme={theme} />
                <PostHeader post={post} theme={theme} />
                <PostRenderer markdown={markdown} theme={theme} />
            </div>
        </main>
    );
}
