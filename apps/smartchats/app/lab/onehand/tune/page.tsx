'use client';

import dynamic from 'next/dynamic';

const TuneView = dynamic(() => import('./TuneView'), { ssr: false });

export default function OnehandTunePage() {
    return <TuneView />;
}
