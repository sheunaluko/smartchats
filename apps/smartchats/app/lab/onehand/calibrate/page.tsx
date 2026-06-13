'use client';

import dynamic from 'next/dynamic';

const CalibrateView = dynamic(() => import('./CalibrateView'), { ssr: false });

export default function OnehandCalibratePage() {
    return <CalibrateView />;
}
