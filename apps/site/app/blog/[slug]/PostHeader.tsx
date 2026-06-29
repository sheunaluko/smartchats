import type { BlogPost } from '../../../content/blog/_posts';
import type { Theme } from './PostRenderer';

function formatDate(iso: string): string {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    });
}

export default function PostHeader({ post, theme = 'light' }: { post: BlogPost; theme?: Theme }) {
    const isLight = theme === 'light';
    return (
        <header className={`mb-12 pb-8 border-b ${isLight ? 'border-gray-200' : 'border-white/10'}`}>
            <div className={`flex items-center gap-3 text-xs mb-4 font-mono uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-white/40'}`}>
                <time dateTime={post.date}>{formatDate(post.date)}</time>
                <span>·</span>
                <span>{post.readingMinutes} min read</span>
                <span>·</span>
                <span>by {post.author}</span>
            </div>
            <h1 className={`text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-tight ${isLight ? 'text-gray-900' : 'text-white'}`}>
                {post.title}
            </h1>
        </header>
    );
}
