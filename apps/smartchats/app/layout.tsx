'use client';

import './globals.css';

import React, { useMemo } from 'react';

import ThemeContextProvider from "./ThemeContext";
import ThemeWrapper from "./ThemeWrapper";
import Toast from '@/components/Toast';
import LoginModal from '@/components/LoginModal';

import { AuthFacadeProvider } from '@/lib/auth';
import { BackendFacadeProvider } from '@/lib/backend_facade';
import { bootstrap } from '@/lib/bootstrap';

declare var window: any;

// Open-core RootLayout: constructs LocalAuthProvider + LocalBackend by
// default, talks to a local Express server (smartchats-local-server).
// Self-hostable end users get this — no Firebase, no cloud.
//
// The cloud-flavored variant lives in the closed smartchats-cloud repo
// (overlays/smartchats-app/app/layout.tsx) and is applied via
// bin/sync-from-open after this file is rsynced.
export default function RootLayout({ children }: { children: React.ReactNode }) {
    const { authProvider, backend } = useMemo(() => {
        const result = bootstrap();
        return { authProvider: result.auth, backend: result.backend };
    }, []);

    return (
        <html lang="en">
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
                <meta name="theme-color" content="#09090b" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                <meta name="apple-mobile-web-app-title" content="SmartChats" />
                <link rel="manifest" href="/manifest.json" />
                <title>SmartChats.ai</title>
            </head>
            <body className="min-h-screen overflow-x-hidden relative m-0">
                <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-sc-primary focus:text-white focus:rounded-sc-sm">
                    Skip to main content
                </a>
                <AuthFacadeProvider provider={authProvider}>
                    <BackendFacadeProvider backend={backend}>
                        <ThemeContextProvider>
                            <ThemeWrapper>
                                <main id="main-content" className="w-full flex-1">
                                    {children}
                                </main>
                                <LoginModal />
                                <Toast />
                            </ThemeWrapper>
                        </ThemeContextProvider>
                    </BackendFacadeProvider>
                </AuthFacadeProvider>
            </body>
        </html>
    );
}
