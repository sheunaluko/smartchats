export const SEED_NODE_COLOR = '#e74c3c';
export const EXPANDED_NODE_COLOR = '#3498db';
export const DEFAULT_EDGE_COLOR = '#95a5a6';

export const RELATION_COLORS: Record<string, string> = {
  treats: '#27ae60',
  is_a: '#8e44ad',
  created: '#e67e22',
  has: '#2980b9',
  part_of: '#16a085',
  causes: '#c0392b',
  prevents: '#1abc9c',
  associated_with: '#f39c12',
  used_for: '#d35400',
  located_in: '#2c3e50',
  belongs_to: '#7f8c8d',
  produces: '#e74c3c',
  inhibits: '#9b59b6',
  activates: '#3498db',
};

export const DEPTH_COLORS = [
  '#e74c3c', // depth 0 — seed (red)
  '#3498db', // depth 1 (blue)
  '#2ecc71', // depth 2 (green)
  '#f39c12', // depth 3 (orange)
  '#9b59b6', // depth 4 (purple)
  '#1abc9c', // depth 5 (teal)
];

export function getDepthColor(depth: number): string {
  return DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)];
}

export function getRelationColor(kind: string): string {
  return RELATION_COLORS[kind] || DEFAULT_EDGE_COLOR;
}

/** Map KNN distance to node size. Closer = bigger (range ~6-20). */
export function mapDistanceToSize(distance: number): number {
  // Typical KNN distances range ~0.1-2.0
  // Clamp and invert: low distance → large size
  const clamped = Math.max(0.05, Math.min(distance, 2.0));
  const normalized = 1 - (clamped / 2.0);
  return 6 + normalized * 14; // range 6-20
}
