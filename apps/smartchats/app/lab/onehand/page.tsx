'use client';

import dynamic from 'next/dynamic';

const OnehandApp = dynamic(() => import('./OnehandApp'), { ssr: false });

export default function OnehandPage() {
    return <OnehandApp />;
}
