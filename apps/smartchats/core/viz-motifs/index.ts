import type { VizMotif } from '../types';

export const classicMotif: VizMotif = {
  id: 'classic',
  name: 'Classic',
  description: 'Clean horizontal bars and standard chart styles',
};

export const glassMotif: VizMotif = {
  id: 'glass',
  name: 'Glass Slab',
  description: 'Frosted vertical bars with backdrop blur, inner glow, and gradient fills',
};

export const minimalMotif: VizMotif = {
  id: 'minimal',
  name: 'Minimal',
  description: 'Ultra-stripped-down, hairline axes, monospace values, no decorations',
};

export const retroMotif: VizMotif = {
  id: 'retro',
  name: 'Retro',
  description: 'Dot-matrix / pixel aesthetic with stepped edges and dashed grids',
};

export const vizMotifs: Record<string, VizMotif> = {
  classic: classicMotif,
  glass: glassMotif,
  minimal: minimalMotif,
  retro: retroMotif,
};

export const defaultMotif = glassMotif;

export function getVizMotif(id: string): VizMotif | undefined {
  return vizMotifs[id];
}

export function listVizMotifs(): VizMotif[] {
  return Object.values(vizMotifs);
}
