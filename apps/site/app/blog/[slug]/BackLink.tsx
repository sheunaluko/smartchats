'use client';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { Theme } from './PostRenderer';

export default function BackLink({ theme = 'light' }: { theme?: Theme }) {
    const isLight = theme === 'light';
    return (
        <Link
            href="/blog/"
            className={`inline-flex items-center gap-1.5 text-sm transition-colors mb-10 ${
                isLight ? 'text-gray-500 hover:text-gray-900' : 'text-white/50 hover:text-white/90'
            }`}
        >
            <ArrowLeft size={14} />
            All posts
        </Link>
    );
}
