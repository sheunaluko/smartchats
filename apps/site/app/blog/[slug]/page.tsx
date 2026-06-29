/**
 * Blog post route. Server component — reads the post's markdown
 * at build time (next.config.js `output: 'export'` requires
 * everything be statically renderable) and passes it to the
 * client-side renderer.
 *
 * generateStaticParams enumerates all posts in the registry so
 * each gets a static HTML page at build time.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { POSTS, POSTS_BY_SLUG } from '../../../content/blog/_posts';
import BlogPostClient from './BlogPostClient';

interface Props {
    params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
    return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    const post = POSTS_BY_SLUG[slug];
    if (!post) return {};
    return {
        title: `${post.title} — SmartChats Blog`,
        description: post.description,
        openGraph: {
            title: post.title,
            description: post.description,
            type: 'article',
            publishedTime: post.date,
            authors: [post.author],
        },
        twitter: {
            card: 'summary_large_image',
            title: post.title,
            description: post.description,
        },
    };
}

export default async function BlogPostPage({ params }: Props) {
    const { slug } = await params;
    const post = POSTS_BY_SLUG[slug];
    if (!post) notFound();

    const filePath = path.join(process.cwd(), 'content', 'blog', post.file);
    const markdown = await fs.readFile(filePath, 'utf8');

    return <BlogPostClient post={post} markdown={markdown} />;
}
