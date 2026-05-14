'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type { VizMotif } from './types';
import { vizMotifs, defaultMotif } from './viz-motifs';

type VizMotifContextValue = {
  motifId: string;
  motif: VizMotif;
  setMotif: (id: string) => void;
  availableMotifs: string[];
};

const VizMotifContext = createContext<VizMotifContextValue | null>(null);

const STORAGE_KEY = 'smartchats-viz-motif';

export function VizMotifProvider({ children }: { children: React.ReactNode }) {
  const [motifId, setMotifId] = useState(defaultMotif.id);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && vizMotifs[saved]) {
      setMotifId(saved);
    }
  }, []);

  const setMotif = useCallback((id: string) => {
    if (vizMotifs[id]) {
      setMotifId(id);
      localStorage.setItem(STORAGE_KEY, id);
    }
  }, []);

  const value = useMemo(() => ({
    motifId,
    motif: vizMotifs[motifId] || defaultMotif,
    setMotif,
    availableMotifs: Object.keys(vizMotifs),
  }), [motifId, setMotif]);

  return (
    <VizMotifContext.Provider value={value}>
      {children}
    </VizMotifContext.Provider>
  );
}

export function useVizMotif(): VizMotifContextValue {
  const ctx = useContext(VizMotifContext);
  if (!ctx) {
    throw new Error('useVizMotif must be used within a VizMotifProvider');
  }
  return ctx;
}
