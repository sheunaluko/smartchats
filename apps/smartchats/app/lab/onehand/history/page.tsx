'use client';

import dynamic from 'next/dynamic';

const HistoryView = dynamic(() => import('./HistoryView'), { ssr: false });

export default function OnehandHistoryPage() {
    return <HistoryView />;
}
