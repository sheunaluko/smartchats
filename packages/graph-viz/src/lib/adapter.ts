import type { KGGraphData, KGNode, KGEdge, DeepSearchResult } from './types';
import { getDepthColor, getRelationColor, mapDistanceToSize, SEED_NODE_COLOR, DEFAULT_EDGE_COLOR } from './constants';

/**
 * Convert a DeepSearchResult (from search_knowledge_deep) into KGGraphData.
 * Entities → nodes (colored by depth, sized by distance).
 * Relations → edges (colored by kind).
 */
export function searchResultToGraphData(result: DeepSearchResult): KGGraphData {
  const nodes: KGNode[] = [];
  const edges: KGEdge[] = [];
  const nodeSet = new Set<string>();

  // Seed entities (depth 0)
  for (const entity of result.seeds.entities) {
    const id = entity.name || entity.id;
    if (!id || nodeSet.has(id)) continue;
    nodeSet.add(id);
    nodes.push({
      id,
      label: id.replace(/_/g, ' '),
      depth: 0,
      distance: entity.distance,
      size: entity.distance != null ? mapDistanceToSize(entity.distance) : 14,
      color: SEED_NODE_COLOR,
    });
  }

  // Expanded entities (depth 1+)
  for (const [name, info] of result.expanded.entities) {
    if (nodeSet.has(name)) continue;
    nodeSet.add(name);
    nodes.push({
      id: name,
      label: name.replace(/_/g, ' '),
      depth: info.depth,
      distance: info.distance,
      size: info.distance != null ? mapDistanceToSize(info.distance) : 10,
      color: getDepthColor(info.depth),
    });
  }

  // Seed relations
  for (const rel of result.seeds.relations) {
    const source = rel.sourceName;
    const target = rel.targetName;
    const kind = rel.kind || 'related';
    const edgeId = `${source}_${kind}_${target}`;

    // Ensure both endpoints exist as nodes
    if (!nodeSet.has(source)) {
      nodeSet.add(source);
      nodes.push({ id: source, label: source.replace(/_/g, ' '), depth: 0, size: 10, color: SEED_NODE_COLOR });
    }
    if (!nodeSet.has(target)) {
      nodeSet.add(target);
      nodes.push({ id: target, label: target.replace(/_/g, ' '), depth: 0, size: 10, color: SEED_NODE_COLOR });
    }

    edges.push({
      id: edgeId,
      source,
      target,
      kind,
      label: kind.replace(/_/g, ' '),
      distance: rel.distance,
      color: getRelationColor(kind),
      size: 2,
    });
  }

  // Expanded relations
  for (const rel of result.expanded.relations) {
    const source = rel.sourceName;
    const target = rel.targetName;
    const kind = rel.kind || 'related';
    const edgeId = `${source}_${kind}_${target}`;

    if (!nodeSet.has(source)) {
      nodeSet.add(source);
      nodes.push({ id: source, label: source.replace(/_/g, ' '), depth: result.depth, size: 8, color: getDepthColor(result.depth) });
    }
    if (!nodeSet.has(target)) {
      nodeSet.add(target);
      nodes.push({ id: target, label: target.replace(/_/g, ' '), depth: result.depth, size: 8, color: getDepthColor(result.depth) });
    }

    edges.push({
      id: edgeId,
      source,
      target,
      kind,
      label: kind.replace(/_/g, ' '),
      color: getRelationColor(kind),
      size: 2,
    });
  }

  return { nodes, edges };
}

/**
 * Convert existing SearchKnowledgeResult (from search_knowledge()) to KGGraphData.
 * All items treated as depth 0.
 */
export function flatSearchResultToGraphData(result: {
  query: string;
  entities: any[];
  relations: any[];
}): KGGraphData {
  const nodes: KGNode[] = [];
  const edges: KGEdge[] = [];
  const nodeSet = new Set<string>();

  for (const entity of result.entities) {
    const id = entity.name || entity.id;
    if (!id || nodeSet.has(id)) continue;
    nodeSet.add(id);
    nodes.push({
      id,
      label: id.replace(/_/g, ' '),
      depth: 0,
      distance: entity.distance,
      size: entity.distance != null ? mapDistanceToSize(entity.distance) : 12,
      color: SEED_NODE_COLOR,
    });
  }

  for (const rel of result.relations) {
    const source = rel.sourceName;
    const target = rel.targetName;
    const kind = rel.kind || 'related';
    const edgeId = `${source}_${kind}_${target}`;

    if (!nodeSet.has(source)) {
      nodeSet.add(source);
      nodes.push({ id: source, label: source.replace(/_/g, ' '), depth: 0, size: 10, color: SEED_NODE_COLOR });
    }
    if (!nodeSet.has(target)) {
      nodeSet.add(target);
      nodes.push({ id: target, label: target.replace(/_/g, ' '), depth: 0, size: 10, color: SEED_NODE_COLOR });
    }

    edges.push({
      id: edgeId,
      source,
      target,
      kind,
      label: kind.replace(/_/g, ' '),
      distance: rel.distance,
      color: getRelationColor(kind),
      size: 2,
    });
  }

  return { nodes, edges };
}

/**
 * Convert raw triples [subject, relation, object][] to KGGraphData.
 * Used for showing just-stored triples from store_knowledge events.
 */
export function triplesToGraphData(triples: [string, string, string][]): KGGraphData {
  const nodes: KGNode[] = [];
  const edges: KGEdge[] = [];
  const nodeSet = new Set<string>();

  for (const [subject, relation, object] of triples) {
    const sourceId = subject.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const targetId = object.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const kind = relation.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    if (!nodeSet.has(sourceId)) {
      nodeSet.add(sourceId);
      nodes.push({
        id: sourceId,
        label: subject.trim(),
        depth: 0,
        size: 14,
        color: SEED_NODE_COLOR,
      });
    }

    if (!nodeSet.has(targetId)) {
      nodeSet.add(targetId);
      nodes.push({
        id: targetId,
        label: object.trim(),
        depth: 0,
        size: 14,
        color: SEED_NODE_COLOR,
      });
    }

    edges.push({
      id: `${sourceId}_${kind}_${targetId}`,
      source: sourceId,
      target: targetId,
      kind,
      label: relation.trim(),
      color: getRelationColor(kind),
      size: 2,
    });
  }

  return { nodes, edges };
}
