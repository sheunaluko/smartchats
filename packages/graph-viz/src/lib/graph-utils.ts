import type { KGGraphData, KGNode, KGEdge } from './types';

/**
 * Merge two KGGraphData objects. Dedup by node.id / edge.id.
 * Incoming overwrites on collision.
 */
export function mergeGraphData(existing: KGGraphData, incoming: KGGraphData): KGGraphData {
  const nodeMap = new Map<string, KGNode>();
  const edgeMap = new Map<string, KGEdge>();

  for (const node of existing.nodes) {
    nodeMap.set(node.id, node);
  }
  for (const node of incoming.nodes) {
    nodeMap.set(node.id, node); // incoming overwrites
  }

  for (const edge of existing.edges) {
    edgeMap.set(edge.id, edge);
  }
  for (const edge of incoming.edges) {
    edgeMap.set(edge.id, edge); // incoming overwrites
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
  };
}

/**
 * Extract unique sorted list of edge kind values from graph data.
 */
export function extractRelationKinds(data: KGGraphData): string[] {
  const kinds = new Set<string>();
  for (const edge of data.edges) {
    kinds.add(edge.kind);
  }
  return Array.from(kinds).sort();
}

/**
 * Filter edges by visible kinds. Remove orphan nodes (nodes with no remaining edges).
 * If visibleKinds is empty, return data as-is (show all).
 */
export function filterByRelationKinds(data: KGGraphData, visibleKinds: Set<string>): KGGraphData {
  if (visibleKinds.size === 0) return data;

  const filteredEdges = data.edges.filter(edge => visibleKinds.has(edge.kind));

  // Collect node ids referenced by remaining edges
  const referencedNodes = new Set<string>();
  for (const edge of filteredEdges) {
    referencedNodes.add(edge.source);
    referencedNodes.add(edge.target);
  }

  const filteredNodes = data.nodes.filter(node => referencedNodes.has(node.id));

  return { nodes: filteredNodes, edges: filteredEdges };
}
