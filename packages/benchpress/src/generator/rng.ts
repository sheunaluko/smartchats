/**
 * Seeded deterministic RNG. Same seed → same persona, byte-for-byte.
 * Mulberry32 — small, fast, statistically fine for fixture generation.
 */
export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  bool(p?: number): boolean;
  gauss(mean: number, sd: number): number;
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  let cachedGauss: number | null = null;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    bool: (p = 0.5) => next() < p,
    gauss: (mean, sd) => {
      // Box-Muller; caches the second draw for the next call.
      if (cachedGauss !== null) {
        const v = cachedGauss;
        cachedGauss = null;
        return mean + sd * v;
      }
      const u1 = Math.max(next(), 1e-9);
      const u2 = next();
      const r = Math.sqrt(-2 * Math.log(u1));
      const z0 = r * Math.cos(2 * Math.PI * u2);
      const z1 = r * Math.sin(2 * Math.PI * u2);
      cachedGauss = z1;
      return mean + sd * z0;
    },
  };
}
