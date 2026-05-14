'use client';
import dynamic from 'next/dynamic';
import { InsightsProvider } from '@/context/InsightsContext';

const App3 = dynamic(() => import('./app3'), { ssr: false });

// Auth + Backend facades are provided by the root layout (`app/layout.tsx`)
// so they cover Toast / LoginModal / every page under `/`.
export default function SmartChatsPage() {
    return (
        <InsightsProvider appName="smartchats" appVersion="1.0.0">
            <App3 />
        </InsightsProvider>
    );
}
