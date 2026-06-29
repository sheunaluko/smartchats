'use client';

/**
 * Client-side markdown renderer with raw-HTML support and theme switching.
 *
 * react-markdown by default escapes raw HTML (security default for
 * user content). We use rehype-raw to allow it because the markdown
 * is FIRST-PARTY content (committed to this repo) — specifically so
 * the inlined SVG chart blocks and audio embeds render natively.
 * remark-gfm enables tables + strikethrough + task lists.
 *
 * Theme: 'light' is the default (engineering-doc aesthetic — white bg,
 * dark text, light-tinted cards). 'dark' preserves the original
 * smartchats.ai aesthetic for readers who prefer it. The toggle lives
 * in BlogPostClient; this component just renders the right class set.
 */

import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

export type Theme = 'light' | 'dark';

function buildComponents(theme: Theme): Components {
    const isLight = theme === 'light';
    const text = isLight ? 'text-gray-900' : 'text-white';
    const textMuted = isLight ? 'text-gray-700' : 'text-white/80';
    const linkClass = isLight
        ? 'text-blue-700 hover:text-blue-900 underline underline-offset-2 decoration-blue-700/40 hover:decoration-blue-900'
        : 'text-blue-300 hover:text-blue-200 underline underline-offset-2 decoration-blue-300/40 hover:decoration-blue-200';
    const codeInline = isLight
        ? 'px-1.5 py-0.5 rounded bg-gray-200 text-gray-900 font-mono text-[0.92em]'
        : 'px-1.5 py-0.5 rounded bg-white/10 text-white/90 font-mono text-[0.92em]';
    const preClass = isLight
        ? 'bg-gray-900 text-gray-100 rounded-lg p-4 mb-5 overflow-x-auto text-sm leading-relaxed'
        : 'bg-white/[0.04] border border-white/10 rounded-lg p-4 mb-5 overflow-x-auto text-sm leading-relaxed';
    const blockquoteClass = isLight
        ? 'border-l-4 border-blue-600 pl-5 py-2 mb-6 text-gray-700 italic bg-blue-50 rounded-r'
        : 'border-l-2 border-blue-400/60 pl-5 py-1 mb-6 text-white/75 italic bg-blue-400/[0.04] rounded-r';
    const tableTh = isLight
        ? 'px-3 py-2 text-left font-semibold text-gray-900 bg-gray-100'
        : 'px-3 py-2 text-left font-semibold text-white';
    const tableTd = isLight
        ? 'px-3 py-2 border-b border-gray-200 text-gray-700 align-top'
        : 'px-3 py-2 border-b border-white/10 text-white/75 align-top';
    const tableHead = isLight ? 'border-b border-gray-300' : 'border-b border-white/20';
    const hrClass = isLight ? 'my-12 border-gray-200' : 'my-12 border-white/15';
    const strongClass = isLight ? 'text-gray-900 font-semibold' : 'text-white font-semibold';
    const emClass = isLight ? 'italic text-gray-800' : 'italic text-white/85';
    const ulMarker = isLight ? 'marker:text-gray-400' : 'marker:text-white/40';

    return {
        h1: ({ children }) => (
            <h1 className={`text-3xl sm:text-4xl font-semibold tracking-tight mt-12 mb-6 ${text}`}>
                {children}
            </h1>
        ),
        h2: ({ children, id }) => (
            <h2 id={id} className={`text-2xl sm:text-3xl font-semibold tracking-tight mt-16 mb-5 scroll-mt-20 ${text}`}>
                {children}
            </h2>
        ),
        h3: ({ children, id }) => (
            <h3 id={id} className={`text-xl sm:text-2xl font-semibold tracking-tight mt-10 mb-3 scroll-mt-20 ${text}`}>
                {children}
            </h3>
        ),
        p: ({ children }) => (
            <p className={`text-base sm:text-[17px] leading-[1.7] mb-5 ${textMuted}`}>
                {children}
            </p>
        ),
        a: ({ children, href }) => (
            <a
                href={href}
                className={`${linkClass} transition-colors`}
                target={href?.startsWith('http') ? '_blank' : undefined}
                rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
            >
                {children}
            </a>
        ),
        ul: ({ children }) => (
            <ul className={`list-disc list-outside ml-6 mb-5 space-y-2 ${textMuted} ${ulMarker}`}>
                {children}
            </ul>
        ),
        ol: ({ children }) => (
            <ol className={`list-decimal list-outside ml-6 mb-5 space-y-2 ${textMuted} ${ulMarker}`}>
                {children}
            </ol>
        ),
        li: ({ children }) => (
            <li className="leading-[1.7] text-base sm:text-[17px]">{children}</li>
        ),
        blockquote: ({ children }) => (
            <blockquote className={blockquoteClass}>
                {children}
            </blockquote>
        ),
        code: ({ children, className }) => {
            const isInline = !className;
            if (isInline) {
                return <code className={codeInline}>{children}</code>;
            }
            return <code className={className}>{children}</code>;
        },
        pre: ({ children }) => (
            <pre className={preClass}>{children}</pre>
        ),
        table: ({ children }) => (
            <div className="overflow-x-auto mb-6 -mx-4 sm:mx-0">
                <table className="w-full text-sm border-collapse min-w-[480px] sm:min-w-0">
                    {children}
                </table>
            </div>
        ),
        thead: ({ children }) => (
            <thead className={tableHead}>{children}</thead>
        ),
        th: ({ children }) => (
            <th className={tableTh}>{children}</th>
        ),
        td: ({ children }) => (
            <td className={tableTd}>{children}</td>
        ),
        hr: () => <hr className={hrClass} />,
        strong: ({ children }) => (
            <strong className={strongClass}>{children}</strong>
        ),
        em: ({ children }) => (
            <em className={emClass}>{children}</em>
        ),
    };
}

export default function PostRenderer({ markdown, theme = 'light' }: { markdown: string; theme?: Theme }) {
    return (
        <article className={`blog-post blog-post-${theme}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={buildComponents(theme)}
            >
                {markdown}
            </ReactMarkdown>
        </article>
    );
}
