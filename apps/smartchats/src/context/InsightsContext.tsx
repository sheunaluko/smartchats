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

    // ── Global error safety-net ──
    // Per-call instrumentation (tts_stream_error, agent_init_error, etc.)
    // misses any path that didn't think to catch + emit. These two listeners
    // catch the leftovers — sync errors via window 'error', unhandled
    // promise rejections via 'unhandledrejection' — and stamp them as
    // `runtime_error` events so triage sees them. They re-throw nothing,
    // observe-only, never block the browser's default handling.
    //
    // After emitting, we kick off a flush immediately so the event isn't
    // stranded in the in-memory batch if the page dies milliseconds later
    // (the classic crash-after-error pattern that left bundles ending
    // mid-turn). The flush goes through the same SDK path as normal emits;
    // best-effort against hard kills, reliable for soft ones.
    let onWindowError: ((ev: ErrorEvent) => void) | null = null;
    let onUnhandledRejection: ((ev: PromiseRejectionEvent) => void) | null = null;
    let onPageHide: (() => void) | null = null;
    let onVisibility: (() => void) | null = null;
    if (typeof window !== 'undefined') {
      const emitRuntimeError = (
        source: 'window_error' | 'unhandled_rejection',
        err: unknown,
        extra: Record<string, unknown>,
      ) => {
        const e = err as { message?: string; name?: string; stack?: string; code?: string; status?: number };
        const message = e?.message ?? (typeof err === 'string' ? err : String(err));
        const stack = e?.stack;
        // addEvent's sync portion pushes into the batch immediately, so the
        // event is queued by the time the promise resolves. Chain a flush
        // onto it to push the batch out the door before the next crash.
        clientRef.current?.addEvent?.('runtime_error', {
          source,
          error_message: message,
          error_name: e?.name,
          error_code: e?.code,
          error_status: e?.status,
          // Stack can be large; cap to keep the bundle reasonable.
          stack: typeof stack === 'string' ? stack.slice(0, 4000) : undefined,
          ...extra,
        })
          .then(() => clientRef.current?.flushBatch?.())
          .catch(() => {});
      };
      onWindowError = (ev) => {
        emitRuntimeError('window_error', ev.error ?? ev.message, {
          filename: ev.filename,
          lineno: ev.lineno,
          colno: ev.colno,
        });
      };
      onUnhandledRejection = (ev) => {
        emitRuntimeError('unhandled_rejection', ev.reason, {});
      };
      window.addEventListener('error', onWindowError);
      window.addEventListener('unhandledrejection', onUnhandledRejection);

      // ── Unload-time flush ──
      // pagehide fires on tab close, navigation away, and bfcache freeze.
      // visibilitychange='hidden' fires earlier (on tab switch, app
      // backgrounding) — gives us a chance to flush before pagehide on
      // mobile where the OS may kill the page outright. Both call the
      // same flushBatch; harmless if called twice in quick succession
      // (second pass finds an empty batch).
      onPageHide = () => {
        clientRef.current?.flushBatch?.().catch(() => {});
      };
      onVisibility = () => {
        if (document.visibilityState === 'hidden') onPageHide?.();
      };
      window.addEventListener('pagehide', onPageHide);
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      if (typeof window !== 'undefined') {
        if (onWindowError) window.removeEventListener('error', onWindowError);
        if (onUnhandledRejection) window.removeEventListener('unhandledrejection', onUnhandledRejection);
        if (onPageHide) window.removeEventListener('pagehide', onPageHide);
        if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
      }
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
