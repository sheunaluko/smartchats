'use client';

import dynamic from 'next/dynamic';

const HandmapApp = dynamic(() => import('./HandmapApp'), { ssr: false });

export default function HandmapPage() {
    return <HandmapApp />;
}
