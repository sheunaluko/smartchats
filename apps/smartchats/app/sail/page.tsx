'use client';

/**
 * /sail — SmartChats Audio Intelligence Lab.
 *
 * Maintainer surface for diagnosing audio pipeline behavior. Mounts the
 * same app3 host as /app (same agent, same orchestrator, same insights
 * pipeline) but with `forceShell="sail"` so the route lands in the
 * SailShell layout (spectrogram + event trace + audio context inspector)
 * instead of the production chrome.
 *
 * Events fired from /sail land in the same insights stream as /app —
 * the SailShell adds the session tag 'sail' on mount so `bin/find-sessions
 * --tag sail` can isolate them when triaging audio bugs.
 */

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { InsightsProvider } from '@/context/InsightsContext';

// Cast the dynamic import to a component that accepts forceShell —
// app3's exported Component reads it off props (untyped pass-through).
const App3 = dynamic(() => import('../app3'), { ssr: false }) as ComponentType<{ forceShell?: string }>;

export default function SailPage() {
    return (
        <InsightsProvider appName="smartchats" appVersion="1.0.0">
            <App3 forceShell="sail" />
        </InsightsProvider>
    );
}
