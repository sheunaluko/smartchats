'use client';

import { useState, useMemo, useCallback } from 'react';
import type { KGGraphData, KGNode, GraphMode, UseGraphVizReturn } from './types';
import { mergeGraphData as mergeUtil, extractRelationKinds, filterByRelationKinds } from './graph-utils';

const EMPTY_DATA: KGGraphData = { nodes: [], edges: [] };

/**
 * Core state management hook for uncontrolled GraphViz usage.
 * When using GraphViz as a controlled component (e.g. from Cortex store),
 * you can skip this hook and pass state directly as props.
 */
export function useGraphViz(
  onSearch?: (query: string, depth: number) => Promise<KGGraphData | null>,
): UseGraphVizReturn {
  const [graphData, setGraphData] = useState<KGGraphData>(EMPTY_DATA);
  const [mode, setMode] = useState<GraphMode>('replace');
  const [depth, setDepth] = useState(1);
  const [visibleRelationKinds, setVisibleRelationKinds] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [selectedNode, setSelectedNode] = useState<KGNode | null>(null);

  const mergeGraphData = useCallback((incoming: KGGraphData) => {
    setGraphData(prev => mergeUtil(prev, incoming));
  }, []);

  const clearGraph = useCallback(() => {
    setGraphData(EMPTY_DATA);
    setVisibleRelationKinds(new Set());
    setSelectedNode(null);
  }, []);

  const availableRelationKinds = useMemo(
    () => extractRelationKinds(graphData),
    [graphData],
  );

  const filteredData = useMemo(
    () => filterByRelationKinds(graphData, visibleRelationKinds),
    [graphData, visibleRelationKinds],
  );

  const toggleRelationKind = useCallback((kind: string) => {
    setVisibleRelationKinds(prev => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  }, []);

  const setAllRelationKinds = useCallback((visible: boolean) => {
    if (visible) {
      setVisibleRelationKinds(new Set(extractRelationKinds(graphData)));
    } else {
      setVisibleRelationKinds(new Set());
    }
  }, [graphData]);

  const search = useCallback(async (query: string) => {
    if (!onSearch) return;
    setIsSearching(true);
    try {
      const result = await onSearch(query, depth);
      if (result) {
        if (mode === 'replace') {
          setGraphData(result);
        } else {
          setGraphData(prev => mergeUtil(prev, result));
        }
      }
    } finally {
      setIsSearching(false);
    }
  }, [onSearch, depth, mode]);

  return {
    graphData,
    setGraphData,
    mergeGraphData,
    clearGraph,
    filteredData,
    mode,
    setMode,
    depth,
    setDepth,
    visibleRelationKinds,
    toggleRelationKind,
    setAllRelationKinds,
    availableRelationKinds,
    search,
    isSearching,
    selectedNode,
    setSelectedNode,
  };
}
