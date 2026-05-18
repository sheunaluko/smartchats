'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type { DesignPack, PairedDesignPack } from './types';
import { designPacks, defaultPack } from './theme-packs';

type DesignPackContextValue = {
  /** Currently active design pack (resolved to dark or light variant) */
  pack: DesignPack;
  /** The paired pack (both dark and light variants) */
  pairedPack: PairedDesignPack;
  /** Current color mode */
  mode: 'dark' | 'light';
  /** Switch to a different design pack by ID */
  setDesignPack: (id: string) => void;
  /** Toggle between dark and light mode */
  toggleMode: () => void;
  /** Set mode explicitly */
  setMode: (mode: 'dark' | 'light') => void;
  /** List of available pack IDs */
  availablePacks: string[];
};

const DesignPackContext = createContext<DesignPackContextValue | null>(null);

const PACK_STORAGE_KEY = 'smartchats-design-pack';
const MODE_STORAGE_KEY = 'smartchats-theme-preference';

export function DesignPackProvider({ children }: { children: React.ReactNode }) {
  const [packId, setPackId] = useState('default');
  const [mode, setModeState] = useState<'dark' | 'light'>('light');

  // Load persisted preferences
  useEffect(() => {
    const savedPack = localStorage.getItem(PACK_STORAGE_KEY);
    if (savedPack && designPacks[savedPack]) {
      setPackId(savedPack);
    }
    const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
    if (savedMode === 'light' || savedMode === 'dark') {
      setModeState(savedMode);
    }
  }, []);

  const setDesignPack = useCallback((id: string) => {
    if (designPacks[id]) {
      setPackId(id);
      localStorage.setItem(PACK_STORAGE_KEY, id);
    }
  }, []);

  const setMode = useCallback((m: 'dark' | 'light') => {
    setModeState(m);
    localStorage.setItem(MODE_STORAGE_KEY, m);
  }, []);

  const toggleMode = useCallback(() => {
    setModeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem(MODE_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo(() => {
    const pairedPack = designPacks[packId] || defaultPack;
    const pack = mode === 'dark' ? pairedPack.dark : pairedPack.light;
    return {
      pack,
      pairedPack,
      mode,
      setDesignPack,
      toggleMode,
      setMode,
      availablePacks: Object.keys(designPacks),
    };
  }, [packId, mode, setDesignPack, toggleMode, setMode]);

  return (
    <DesignPackContext.Provider value={value}>
      {children}
    </DesignPackContext.Provider>
  );
}

export function useDesignPack(): DesignPackContextValue {
  const ctx = useContext(DesignPackContext);
  if (!ctx) {
    throw new Error('useDesignPack must be used within a DesignPackProvider');
  }
  return ctx;
}
