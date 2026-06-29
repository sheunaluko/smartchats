import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { POSTS } from '../../content/blog/_posts';

export const metadata: Metadata = {
    title: 'Blog — SmartChats',
    description: 'Engineering posts from the team building SmartChats.',
    openGraph: {
        title: 'SmartChats blog',
        description: 'Engineering posts from the team building SmartChats.',
        type: 'website',
    },
};

function formatDate(iso: string): string {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
}

export default function BlogIndexPage() {
    return (
        <main className="min-h-screen bg-black text-white">
            <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
                <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white/90 transition-colors mb-12"
                >
                    <ArrowLeft size={14} />
                    Back to smartchats.ai
                </Link>

                <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight mb-3">
                    Blog
                </h1>
                <p className="text-sm text-white/50 mb-16">
                    Engineering notes from the team building SmartChats.
                </p>

                <ul className="space-y-12">
                    {POSTS.map((post) => (
                        <li key={post.slug}>
                            <article>
                                <div className="flex items-center gap-3 text-xs text-white/40 mb-3 font-mono uppercase tracking-wider">
                                    <time dateTime={post.date}>{formatDate(post.date)}</time>
                                    <span>·</span>
                                    <span>{post.readingMinutes} min read</span>
                                </div>
                                <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3 leading-tight">
                                    <Link
                                        href={`/blog/${post.slug}/`}
                                        className="text-white hover:text-blue-300 transition-colors inline-flex items-start gap-2"
                                    >
                                        <span>{post.title}</span>
                                        <ArrowUpRight size={20} className="flex-shrink-0 mt-1 text-white/30" />
                                    </Link>
                                </h2>
                                <p className="text-base text-white/70 leading-relaxed mb-2">
                                    {post.description}
                                </p>
                                <p className="text-xs text-white/40">
                                    by {post.author}
                                </p>
                            </article>
                        </li>
                    ))}
                </ul>
            </div>
        </main>
    );
}
