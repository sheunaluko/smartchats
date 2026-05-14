'use client';

/**
 * AppContainer — renders an active app's sandbox iframe.
 *
 * The iframe is mounted directly in this component's container div.
 * On unmount (e.g. fullscreen toggle), the iframe is destroyed but the sandbox
 * snapshots app.state beforehand. On remount, the sandbox detects the iframe is
 * gone and creates a fresh one, restoring state from the snapshot.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useSmartChatsStore } from '../store/useSmartChatsStore';

export function AppContainer({ sandbox }: { sandbox: any }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!sandbox || !containerRef.current || mountedRef.current) return;
    mountedRef.current = true;
    sandbox.mount(containerRef.current);

    return () => {
      mountedRef.current = false;
    };
  }, [sandbox]);

  const handleClose = useCallback(() => {
    useSmartChatsStore.getState().sendMessageSync('Deactivate the app');
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={handleClose}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 30,
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: 'none',
          background: 'color-mix(in srgb, var(--sc-surface, #161b22) 80%, transparent)',
          backdropFilter: 'blur(8px)',
          color: 'var(--sc-text-muted, #8b949e)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.15s, color 0.15s',
        }}
        aria-label="Close app"
      >
        <X size={14} />
      </button>
      <div
        ref={containerRef}
        style={{ position: 'absolute', inset: 0 }}
      />
    </div>
  );
}
