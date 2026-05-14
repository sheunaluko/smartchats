/**
 * Auth Check — detects logged-out state when cloud storage mode is active
 * (backend-agnostic; consumes the `AuthProvider` facade). When a user is
 * in cloud mode but unauthenticated, queries return empty results rather
 * than errors — this module detects that state and notifies the user.
 */

import { getCortexStore } from './storage';
import { toast_toast } from '@/components/Toast';
import { getAuthProvider } from '@/lib/auth';

declare var window: any;

// ─── Login helper (popup, no redirect) ──────────────────────────────

/**
 * Trigger a Google sign-in directly from the current page via the active
 * AuthProvider. On success, reloads data so the UI updates in place.
 * Falls back to the shared login modal if sign-in fails.
 */
async function signInAndReload(
  emitFn?: (type: string, payload: Record<string, any>) => void,
): Promise<void> {
  try {
    await getAuthProvider().signIn('google');

    if (emitFn) emitFn('cloud_auth_action', { action: 'logged_in_via_popup' });

    // Reload cloud data now that we're authenticated
    if (window.__smartchats__?.dispatch) {
      await window.__smartchats__.dispatch('loadSettings');
      await window.__smartchats__.dispatch('loadConversation');
    }

    toast_toast({
      title: 'Signed in successfully',
      description: 'Cloud data loaded',
      status: 'success',
      duration: 3000,
    });
  } catch (err: any) {
    if (emitFn) emitFn('cloud_auth_action', { action: 'login_popup_failed', error: err?.message });
    if (typeof window !== 'undefined' && window.openLoginModal) {
      window.openLoginModal();
    } else {
      toast_toast({
        title: 'Sign-in popup blocked',
        description: 'Please allow popups or try again.',
        status: 'warning',
        duration: 5000,
      });
    }
  }
}

// ─── Auth checks ────────────────────────────────────────────────────

/**
 * Synchronous check against the active AuthProvider's current user.
 * May return false transiently at page load if the provider hasn't finished
 * loading persisted state — use `waitForAuthReady` for first-query guards.
 */
export function isAuthenticated(): boolean {
  try {
    return getAuthProvider().getCurrentUser() !== null;
  } catch {
    return false;
  }
}

/**
 * Wait for the active AuthProvider to resolve its persisted auth state.
 * For providers that require auth (e.g. cloud), this listens for an
 * `onAuthChange` callback with a timeout so callers can wait before
 * making authenticated requests. For no-auth deployments, resolves
 * true immediately (trusted context always "authenticated").
 */
export function waitForAuthReady(timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    let provider: ReturnType<typeof getAuthProvider>;
    try {
      provider = getAuthProvider();
    } catch {
      resolve(false);
      return;
    }
    // No-auth deployments: always ready, always "authenticated."
    if (!provider.capabilities.required) {
      resolve(true);
      return;
    }
    if (provider.getCurrentUser()) {
      resolve(true);
      return;
    }
    let settled = false;
    const unsubscribe = provider.onAuthChange((user) => {
      if (!settled) {
        settled = true;
        unsubscribe();
        clearTimeout(timer);
        resolve(!!user);
      }
    });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        unsubscribe();
        resolve(false);
      }
    }, timeoutMs);
  });
}

/**
 * Combined check: is the app in cloud storage mode but lacking authentication?
 */
export function checkCloudAuth(): {
  isCloudMode: boolean;
  isAuthenticated: boolean;
  needsAttention: boolean;
} {
  const store = getCortexStore();
  const isCloudMode = store.getMode() === 'cloud';
  const authed = isAuthenticated();
  return {
    isCloudMode,
    isAuthenticated: authed,
    needsAttention: isCloudMode && !authed,
  };
}

// ─── Shared toast buttons ───────────────────────────────────────────

/**
 * Returns the 3 action buttons used in all auth toasts:
 * LOG IN (popup), USE LOCAL, Dismiss
 */
function authToastButtons(
  emitFn: ((type: string, payload: Record<string, any>) => void) | undefined,
  onClose: () => void,
) {
  const React = require('react');
  return [
    React.createElement('button', {
      key: 'login',
      onClick: () => {
        onClose();
        if (typeof window !== 'undefined' && window.openLoginModal) {
          window.openLoginModal();
        } else {
          signInAndReload(emitFn);
        }
      },
      style: {
        background: '#4299E1',
        color: 'white',
        border: 'none',
        padding: '6px 16px',
        borderRadius: '4px',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: '14px',
      },
    }, 'LOG IN'),
    React.createElement('button', {
      key: 'local',
      onClick: () => {
        if (typeof window !== 'undefined' && window.__smartchats__?.dispatch) {
          window.__smartchats__.dispatch('switchStorageMode', 'local');
        }
        if (emitFn) {
          emitFn('cloud_auth_action', { action: 'switch_to_local' });
        }
        onClose();
      },
      style: {
        background: '#48BB78',
        color: 'white',
        border: 'none',
        padding: '6px 16px',
        borderRadius: '4px',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: '14px',
      },
    }, 'USE LOCAL'),
    React.createElement('button', {
      key: 'dismiss',
      onClick: () => {
        if (emitFn) {
          emitFn('cloud_auth_action', { action: 'dismissed' });
        }
        onClose();
      },
      style: {
        background: 'transparent',
        color: '#A0AEC0',
        border: '1px solid #4A5568',
        padding: '6px 12px',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '14px',
      },
    }, 'Dismiss'),
  ];
}

// ─── Debounced toast notification ───────────────────────────────────

let _lastNotifyTime = 0;
const DEBOUNCE_MS = 30_000; // 30 seconds

/**
 * Show a warning toast when cloud mode is active but user is not authenticated.
 * Debounced to avoid spamming the user.
 *
 * Returns true if the toast was shown, false if debounced.
 */
export function notifyCloudAuthRequired(
  context: string,
  emitFn?: (type: string, payload: Record<string, any>) => void,
): boolean {
  const now = Date.now();
  if (now - _lastNotifyTime < DEBOUNCE_MS) {
    return false;
  }
  _lastNotifyTime = now;

  // Emit telemetry
  if (emitFn) {
    emitFn('cloud_auth_required', { context });
  }

  const React = require('react');

  toast_toast({
    status: 'warning',
    duration: 15000,
    isClosable: true,
    render: ({ onClose }: { onClose: () => void }) => {
      return React.createElement('div', {
        style: {
          background: '#2D3748',
          color: 'white',
          padding: '16px',
          borderRadius: '8px',
          maxWidth: '420px',
        },
      },
        React.createElement('div', {
          style: { fontWeight: 600, marginBottom: '8px', fontSize: '15px' },
        }, 'Welcome to SmartChats'),
        React.createElement('div', {
          style: { marginBottom: '12px', fontSize: '14px', lineHeight: '1.5' },
        },
          'Log in to sync your conversations and settings across devices, or switch to local storage to use SmartChats without an account.'
        ),
        React.createElement('div', { style: { display: 'flex', gap: '8px' } },
          ...authToastButtons(emitFn, onClose),
        ),
      );
    },
  } as any);

  return true;
}
