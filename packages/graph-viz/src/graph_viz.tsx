'use client';

import React, { FC, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { SigmaContainer, useLoadGraph, useSigma, useRegisterEvents, useSetSettings } from '@react-sigma/core';
import { useWorkerLayoutForceAtlas2 } from '@react-sigma/layout-forceatlas2';
import "@react-sigma/core/lib/style.css";
import { inferSettings } from 'graphology-layout-forceatlas2';
import EdgeCurveProgram, { DEFAULT_EDGE_CURVATURE, indexParallelEdgesIndex } from '@sigma/edge-curve';
import { MultiDirectedGraph as MultiGraphConstructor } from 'graphology';
import { EdgeArrowProgram } from 'sigma/rendering';
import { Box } from '@mui/material';

import type { KGGraphData, KGNode, KGEdge, GraphMode, GraphVizProps } from './lib/types';
import { useGraphViz } from './lib/useGraphViz';
import { extractRelationKinds, filterByRelationKinds } from './lib/graph-utils';
import { SearchBar } from './SearchBar';
import { FilterPanel } from './FilterPanel';
import { NodeDetail } from './NodeDetail';
import { PhysicsPanel, DEFAULT_PHYSICS } from './PhysicsPanel';
import type { PhysicsSettings } from './PhysicsPanel';

// ─── Internal sub-components ────────────────────────────────────

const KGGraphLoader: FC<{ data: KGGraphData }> = ({ data }) => {
  const loadGraph = useLoadGraph();

  useEffect(() => {
    const graph = new MultiGraphConstructor();
    const nodeCount = data.nodes.length;
    // Arrange nodes in a circle for better initial layout
    data.nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / Math.max(nodeCount, 1);
      const radius = 5 + nodeCount * 0.5;
      graph.addNode(node.id, {
        label: node.label || node.id,
        size: node.size || 10,
        color: node.color || '#3498db',
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        metadata: { depth: node.depth, distance: node.distance, ...node.metadata },
      });
    });

    data.edges.forEach(edge => {
      try {
        graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
          size: edge.size || 2,
          color: edge.color || '#95a5a6',
          label: edge.label || edge.kind,
          metadata: { kind: edge.kind, distance: edge.distance, ...edge.metadata },
        });
      } catch {
        // Skip duplicate edges
      }
    });

    indexParallelEdgesIndex(graph, {
      edgeIndexAttribute: 'parallelIndex',
      edgeMaxIndexAttribute: 'parallelMaxIndex',
    });

    graph.forEachEdge((edge, attributes) => {
      const { parallelIndex, parallelMaxIndex } = attributes;
      if (typeof parallelIndex === 'number' && parallelMaxIndex > 0) {
        const curvature = DEFAULT_EDGE_CURVATURE + (0.2 * DEFAULT_EDGE_CURVATURE * parallelIndex) / (parallelMaxIndex || 1);
        graph.mergeEdgeAttributes(edge, { type: 'curved', curvature });
      } else {
        graph.setEdgeAttribute(edge, 'type', 'straight');
      }
    });

    loadGraph(graph);
  }, [loadGraph, data]);

  return null;
};

const KGForceAtlas2Layout: FC<{
  physics: PhysicsSettings;
  runCounter: number;
  onRunningChange: (running: boolean) => void;
}> = ({ physics, runCounter, onRunningChange }) => {
  const sigma = useSigma();
  const graph = sigma.getGraph();
  const inferredSettings = inferSettings(graph);

  // Keep physics in a ref so changing sliders doesn't trigger worker recreation
  const physicsRef = useRef(physics);
  physicsRef.current = physics;

  // Only pass initial physics to the worker hook — settings are baked at mount time.
  // "Run Layout" remounts the whole SigmaContainer (via graphKey), giving fresh settings.
  const [frozenSettings] = useState(() => ({
    ...inferredSettings,
    gravity: physics.gravity,
    scalingRatio: physics.scalingRatio,
    slowDown: physics.slowDown,
    barnesHutOptimize: physics.barnesHutOptimize,
    barnesHutTheta: physics.barnesHutTheta,
    edgeWeightInfluence: physics.edgeWeightInfluence,
    linLogMode: physics.linLogMode,
    strongGravityMode: physics.strongGravityMode,
    outboundAttractionDistribution: physics.outboundAttractionDistribution,
    adjustSizes: physics.adjustSizes,
  }));

  const { start, kill, isRunning } = useWorkerLayoutForceAtlas2({
    settings: frozenSettings,
  });

  // Track running state externally
  useEffect(() => {
    onRunningChange(isRunning);
  }, [isRunning, onRunningChange]);

  // Auto-zoom when layout stops
  useEffect(() => {
    if (!isRunning) {
      setTimeout(() => {
        const camera = sigma.getCamera();
        camera.animatedReset({ duration: 800 });
      }, 300);
    }
  }, [isRunning, sigma]);

  // Run layout on mount. Duration read from ref so it's not a dep.
  useEffect(() => {
    start();
    const timeout = setTimeout(() => kill(), physicsRef.current.duration);
    return () => {
      clearTimeout(timeout);
      kill();
    };
  }, [start, kill]);

  return null;
};

const KGInteractions: FC<{
  enableHoverEffects: boolean;
  onNodeClick?: (nodeId: string) => void;
}> = ({ enableHoverEffects, onNodeClick }) => {
  const sigma = useSigma();
  const setSettings = useSetSettings();
  const registerEvents = useRegisterEvents();
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  useEffect(() => {
    if (!enableHoverEffects) return;

    if (hoveredNode) {
      const graph = sigma.getGraph();
      const neighbors = new Set(graph.neighbors(hoveredNode));
      neighbors.add(hoveredNode);

      setSettings({
        nodeReducer: (node: string, data: any) => {
          if (neighbors.has(node)) {
            return { ...data, highlighted: true, size: data.size * 1.3, zIndex: 1 };
          }
          return { ...data, color: '#ddd', size: data.size * 0.7, zIndex: 0 };
        },
        edgeReducer: (edge: string, data: any) => {
          const [source, target] = graph.extremities(edge);
          if (neighbors.has(source) && neighbors.has(target)) {
            return { ...data, color: '#e74c3c', size: data.size * 1.5, zIndex: 1 };
          }
          return { ...data, color: '#eee', size: data.size * 0.4, zIndex: 0 };
        },
      });
    } else {
      setSettings({ nodeReducer: null, edgeReducer: null });
    }
  }, [hoveredNode, enableHoverEffects, sigma, setSettings]);

  useEffect(() => {
    registerEvents({
      enterNode: (event: any) => {
        setHoveredNode(event.node);
        sigma.getContainer().style.cursor = 'pointer';
      },
      leaveNode: () => {
        setHoveredNode(null);
        sigma.getContainer().style.cursor = 'default';
      },
      clickNode: (event: any) => {
        onNodeClick?.(event.node);
      },
      clickStage: () => {
        setHoveredNode(null);
      },
    });
  }, [registerEvents, onNodeClick, sigma]);

  return null;
};

// ─── Main GraphViz component ─────────────────────────────────────

export const GraphViz: FC<GraphVizProps> = ({
  data: controlledData,
  onDataChange,
  onSearch,
  isSearching: controlledIsSearching,
  mode: controlledMode,
  onModeChange,
  depth: controlledDepth,
  onDepthChange,
  visibleRelationKinds: controlledVisibleKinds,
  onVisibleRelationKindsChange,
  availableRelationKinds: controlledAvailableKinds,
  onNodeClick,
  onEdgeClick,
  enableAnimation = true,
  enableHoverEffects = true,
  showSearchBar = true,
  showFilterPanel = true,
  height = '100%',
  width = '100%',
}) => {
  // Internal state for uncontrolled mode
  const internal = useGraphViz(onSearch);

  // Resolve controlled vs uncontrolled
  const graphData = controlledData ?? internal.graphData;
  const isSearching = controlledIsSearching ?? internal.isSearching;
  const mode = controlledMode ?? internal.mode;
  const depth = controlledDepth ?? internal.depth;
  const visibleKinds = controlledVisibleKinds ?? internal.visibleRelationKinds;
  const availableKinds = controlledAvailableKinds ?? internal.availableRelationKinds;

  // Physics state
  const [physics, setPhysics] = useState<PhysicsSettings>(DEFAULT_PHYSICS);
  const [runCounter, setRunCounter] = useState(0);
  const [layoutRunning, setLayoutRunning] = useState(false);

  const handleRunLayout = useCallback(() => {
    setRunCounter(c => c + 1);
  }, []);

  const handleStopLayout = useCallback(() => {
    // Incrementing runCounter triggers a new useEffect cycle which kills the old one
    // But we need a way to stop without restarting — use a ref trick
    setRunCounter(c => c + 0.001); // triggers cleanup without meaningful restart
  }, []);

  const handleModeChange = useCallback((m: GraphMode) => {
    onModeChange ? onModeChange(m) : internal.setMode(m);
  }, [onModeChange, internal]);

  const handleDepthChange = useCallback((d: number) => {
    onDepthChange ? onDepthChange(d) : internal.setDepth(d);
  }, [onDepthChange, internal]);

  const handleSearch = useCallback((query: string) => {
    internal.search(query);
  }, [internal]);

  const handleClear = useCallback(() => {
    if (onDataChange) {
      onDataChange({ nodes: [], edges: [] });
    } else {
      internal.clearGraph();
    }
  }, [onDataChange, internal]);

  const handleToggleKind = useCallback((kind: string) => {
    if (onVisibleRelationKindsChange) {
      const next = new Set(visibleKinds);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      onVisibleRelationKindsChange(next);
    } else {
      internal.toggleRelationKind(kind);
    }
  }, [onVisibleRelationKindsChange, visibleKinds, internal]);

  const handleShowAll = useCallback(() => {
    if (onVisibleRelationKindsChange) {
      onVisibleRelationKindsChange(new Set(availableKinds));
    } else {
      internal.setAllRelationKinds(true);
    }
  }, [onVisibleRelationKindsChange, availableKinds, internal]);

  const handleShowNone = useCallback(() => {
    if (onVisibleRelationKindsChange) {
      onVisibleRelationKindsChange(new Set());
    } else {
      internal.setAllRelationKinds(false);
    }
  }, [onVisibleRelationKindsChange, internal]);

  // Filtered data for rendering
  const displayData = useMemo(
    () => filterByRelationKinds(graphData, visibleKinds),
    [graphData, visibleKinds],
  );

  const resolvedAvailableKinds = controlledAvailableKinds ?? extractRelationKinds(graphData);

  // Node selection
  const [selectedNode, setSelectedNode] = useState<KGNode | null>(null);

  const handleNodeClick = useCallback((nodeId: string) => {
    const node = graphData.nodes.find(n => n.id === nodeId);
    if (node) {
      setSelectedNode(node);
      onNodeClick?.(node);
    }
  }, [graphData, onNodeClick]);

  // Graph key — includes runCounter so "Run Layout" re-mounts the Sigma container
  // which re-randomizes positions and restarts the physics
  const graphKey = useMemo(() => {
    const nodeIds = displayData.nodes.map(n => n.id).sort().join(',');
    const edgeCount = displayData.edges.length;
    return `${displayData.nodes.length}-${edgeCount}-${nodeIds.slice(0, 100)}-${Math.floor(runCounter)}`;
  }, [displayData, runCounter]);

  const hasData = displayData.nodes.length > 0;

  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      width: typeof width === 'number' ? `${width}px` : width,
      height: typeof height === 'number' ? `${height}px` : height,
    }}>
      {showSearchBar && (
        <SearchBar
          onSearch={handleSearch}
          onClear={handleClear}
          isSearching={isSearching}
          mode={mode}
          onModeChange={handleModeChange}
          depth={depth}
          onDepthChange={handleDepthChange}
        />
      )}

      {showFilterPanel && resolvedAvailableKinds.length > 0 && (
        <FilterPanel
          availableKinds={resolvedAvailableKinds}
          visibleKinds={visibleKinds}
          onToggle={handleToggleKind}
          onShowAll={handleShowAll}
          onShowNone={handleShowNone}
        />
      )}

      {/* Sigma canvas */}
      <Box sx={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {/* Physics overlay — inside the relative container */}
        {hasData && (
          <PhysicsPanel
            settings={physics}
            onChange={setPhysics}
            onRun={handleRunLayout}
            onStop={handleStopLayout}
            isRunning={layoutRunning}
          />
        )}

        {hasData ? (
          <SigmaContainer
            key={graphKey}
            graph={MultiGraphConstructor}
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '8px',
              backgroundColor: '#fafafa',
            }}
            settings={{
              defaultNodeColor: '#3498db',
              defaultEdgeColor: '#95a5a6',
              defaultEdgeType: 'straight',
              enableEdgeEvents: true,
              renderEdgeLabels: true,
              edgeLabelFont: 'Arial, sans-serif',
              edgeLabelSize: 11,
              edgeLabelWeight: 'normal',
              edgeLabelColor: { color: '#666' },
              labelFont: 'Arial, sans-serif',
              labelSize: 13,
              labelWeight: 'bold',
              allowInvalidContainer: true,
              edgeProgramClasses: {
                straight: EdgeArrowProgram,
                curved: EdgeCurveProgram,
              },
            }}
          >
            <KGGraphLoader data={displayData} />
            <KGForceAtlas2Layout
              physics={physics}
              runCounter={runCounter}
              onRunningChange={setLayoutRunning}
            />
            <KGInteractions
              enableHoverEffects={enableHoverEffects}
              onNodeClick={handleNodeClick}
            />
          </SigmaContainer>
        ) : (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'text.secondary',
              fontSize: '0.875rem',
            }}
          >
            {showSearchBar
              ? 'Search the knowledge graph to visualize results'
              : 'No graph data to display'}
          </Box>
        )}

        {/* Node detail overlay */}
        {selectedNode && (
          <NodeDetail
            node={selectedNode}
            graphData={graphData}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </Box>
    </Box>
  );
};
