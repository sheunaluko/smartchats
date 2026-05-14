/**
 * InsightsContext — Provides InsightsClient to SmartChats components
 */

import React, { createContext, useContext, useRef, useEffect, useState } from 'react';
import { logger, insights } from 'smartchats-common';
import { getAuthProvider } from '@/lib/auth';
import { getBackend } from '@/lib/backend';

const log = logger.get_logger({ id: 'smartchats_insights' });

interface InsightsContextValue {
  client: any | null;
  sessionId: string;
  isReady: boolean;
}

const InsightsContext = createContext<InsightsContextValue>({
  client: null,
  sessionId: '',
  isReady: false,
});

export function useInsights(): InsightsContextValue {
  return useContext(InsightsContext);
}

interface InsightsProviderProps {
  children: React.ReactNode;
  appName?: string;
  appVersion?: string;
}

export function InsightsProvider({
  children,
  appName = 'smartchats',
  appVersion = '1.0.0',
}: InsightsProviderProps): React.ReactElement {
  const clientRef = useRef<any>(null);
  const [sessionId, setSessionId] = useState('');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const sid = insights.generateSessionId();
    setSessionId(sid);

    let userId = 'smartchats_user';
    try {
      const user = getAuthProvider().getCurrentUser();
      if (user) {
        userId = `${user.uid}|${user.email}|${user.displayName}`;
      }
    } catch {
      // AuthProvider not yet mounted — use default.
    }

    clientRef.current = new insights.InsightsClient({
      app_name: appName,
      app_version: appVersion,
      user_id: userId,
      session_id: sid,
      manual_flush: true,
      // Route emits through the SmartChatsBackend so future LocalBackend
      // can redirect insights without touching the client.
      emit: async (events) => {
        const { stored, errors } = await getBackend().insights.emit(events);
        return { success: true, events_received: events.length, events_stored: stored, errors };
      },
    });

    if (typeof window !== 'undefined') {
      (window as any).smartchatsInsights = clientRef.current;
    }

    log(`InsightsClient initialized with session ${sid}`);
    setIsReady(true);

    return () => {
      if (clientRef.current) {
        clientRef.current.shutdown?.();
      }
    };
  }, [appName, appVersion]);

  const value: InsightsContextValue = {
    client: clientRef.current,
    sessionId,
    isReady,
  };

  return (
    <InsightsContext.Provider value={value}>
      {children}
    </InsightsContext.Provider>
  );
}

export default InsightsContext;
