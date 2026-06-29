/**
 * Blog post registry.
 *
 * Each post has a slug (URL path under /blog/), a markdown filename
 * under content/blog/, plus metadata for the index page and OpenGraph.
 * Add new posts here; the dynamic [slug] route picks them up
 * automatically.
 */

export interface BlogPost {
    slug: string;
    title: string;
    description: string;
    date: string;             // ISO yyyy-mm-dd
    author: string;
    readingMinutes: number;
    file: string;             // filename under content/blog/
}

export const POSTS: BlogPost[] = [
    {
        slug: 'voice-stutter-tts-benchmark',
        title: 'We Tracked a Voice-Agent Stutter to OpenAI. Then We Benchmarked 7 TTS Providers.',
        description:
            'A debugging story: from a user-reported audible silence to a falsifiable test (Pearson r = 0.878) that proved the gap was in OpenAI\'s TTS, then a 105-trial benchmark across 7 providers. Azure wins by a wide margin. Open source.',
        date: '2026-06-23',
        author: 'Sheun Aluko',
        readingMinutes: 14,
        file: 'voice-stutter-tts-benchmark.md',
    },
];

export const POSTS_BY_SLUG: Record<string, BlogPost> = Object.fromEntries(
    POSTS.map((p) => [p.slug, p]),
);
