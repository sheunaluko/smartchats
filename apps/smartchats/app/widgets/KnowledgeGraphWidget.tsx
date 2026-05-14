'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import WidgetItem from '../WidgetItem';
import type { KGGraphData, KGNode, GraphMode } from 'graph-viz';
import { Switch } from '../ui/Switch';
import { SurfacePanel } from '../ui/recipes';

const GraphViz = dynamic(
  () => import('graph-viz').then(m => ({ default: m.GraphViz })),
  { ssr: false },
);

interface KnowledgeGraphWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  // KG state from store
  kgGraphData: KGGraphData;
  kgMode: GraphMode;
  kgDepth: number;
  kgVisibleRelationKinds: Set<string>;
  kgAvailableRelationKinds: string[];
  kgIsSearching: boolean;
  kgAutoDisplay: boolean;
  // Actions from store
  setKgGraphData: (data: KGGraphData) => void;
  updateKgSettings: (partial: { kgAutoDisplay?: boolean; kgMode?: GraphMode; kgDepth?: number }) => void;
  setKgVisibleRelationKinds: (kinds: Set<string>) => void;
  clearKgGraph: () => void;
  searchKnowledgeGraph: (query: string, depth: number) => Promise<KGGraphData | null>;
  onNodeClick?: (node: KGNode) => void;
}

const KnowledgeGraphWidget: React.FC<KnowledgeGraphWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  kgGraphData,
  kgMode,
  kgDepth,
  kgVisibleRelationKinds,
  kgAvailableRelationKinds,
  kgIsSearching,
  kgAutoDisplay,
  setKgGraphData,
  updateKgSettings,
  setKgVisibleRelationKinds,
  clearKgGraph,
  searchKnowledgeGraph,
  onNodeClick,
}) => {
  const controls = (
    <div className="mr-2 flex items-center gap-2">
      <span className="text-xs text-sc-text-muted">Auto</span>
      <Switch
        checked={kgAutoDisplay}
        onChange={(checked) => updateKgSettings({ kgAutoDisplay: checked })}
        size="sm"
        aria-label="Toggle automatic knowledge graph display"
      />
    </div>
  );

  return (
    <WidgetItem
      title="Knowledge Graph"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
      controls={controls}
    >
      <SurfacePanel variant="tertiary" className="h-full min-h-[300px] overflow-hidden">
        <GraphViz
          data={kgGraphData}
          onDataChange={setKgGraphData}
          onSearch={searchKnowledgeGraph}
          isSearching={kgIsSearching}
          mode={kgMode}
          onModeChange={(m) => updateKgSettings({ kgMode: m })}
          depth={kgDepth}
          onDepthChange={(d) => updateKgSettings({ kgDepth: d })}
          visibleRelationKinds={kgVisibleRelationKinds}
          onVisibleRelationKindsChange={setKgVisibleRelationKinds}
          availableRelationKinds={kgAvailableRelationKinds}
          onNodeClick={onNodeClick}
          enableAnimation={true}
          enableHoverEffects={true}
          showSearchBar={true}
          showFilterPanel={true}
        />
      </SurfacePanel>
    </WidgetItem>
  );
};

export default React.memo(KnowledgeGraphWidget);
