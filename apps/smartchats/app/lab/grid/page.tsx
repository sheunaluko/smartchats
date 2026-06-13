'use client';

import dynamic from 'next/dynamic';

const GridApp = dynamic(() => import('./GridApp'), { ssr: false });

export default function OnehandGridPage() {
    return <GridApp />;
}
