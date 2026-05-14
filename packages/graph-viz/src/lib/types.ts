export interface KGNode {
  id: string;
  label: string;
  size?: number;
  color?: string;
  distance?: number;
  depth?: number;
  metadata?: Record<string, any>;
}

export interface KGEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  label: string;
  distance?: number;
  color?: string;
  size?: number;
  metadata?: Record<string, any>;
}

export interface KGGraphData {
  nodes: KGNode[];
  edges: KGEdge[];
}

export type GraphMode = 'replace' | 'accumulate';

export interface GraphVizProps {
  // Data (controlled or uncontrolled)
  data?: KGGraphData;
  onDataChange?: (data: KGGraphData) => void;

  // Search
  onSearch?: (query: string, depth: number) => Promise<KGGraphData | null>;
  isSearching?: boolean;

  // Settings (controlled or uncontrolled)
  mode?: GraphMode;
  onModeChange?: (mode: GraphMode) => void;
  depth?: number;
  onDepthChange?: (depth: number) => void;
  visibleRelationKinds?: Set<string>;
  onVisibleRelationKindsChange?: (kinds: Set<string>) => void;
  availableRelationKinds?: string[];

  // Callbacks
  onNodeClick?: (node: KGNode) => void;
  onEdgeClick?: (edge: KGEdge) => void;

  // Display config
  enableAnimation?: boolean;
  enableHoverEffects?: boolean;
  showSearchBar?: boolean;
  showFilterPanel?: boolean;
  height?: string | number;
  width?: string | number;
}

export interface UseGraphVizReturn {
  graphData: KGGraphData;
  setGraphData: (data: KGGraphData) => void;
  mergeGraphData: (data: KGGraphData) => void;
  clearGraph: () => void;
  filteredData: KGGraphData;
  mode: GraphMode;
  setMode: (mode: GraphMode) => void;
  depth: number;
  setDepth: (depth: number) => void;
  visibleRelationKinds: Set<string>;
  toggleRelationKind: (kind: string) => void;
  setAllRelationKinds: (visible: boolean) => void;
  availableRelationKinds: string[];
  search: (query: string) => Promise<void>;
  isSearching: boolean;
  selectedNode: KGNode | null;
  setSelectedNode: (node: KGNode | null) => void;
}

export interface DeepSearchResult {
  query: string;
  seeds: {
    entities: any[];
    relations: any[];
  };
  expanded: {
    entities: Map<string, { name: string; depth: number; distance?: number }>;
    relations: any[];
  };
  depth: number;
  totalEntities: number;
  totalRelations: number;
}
