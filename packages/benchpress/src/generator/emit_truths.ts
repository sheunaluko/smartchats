/**
 * Compute every scenario's expected truth against a Seed and emit the
 * `truths.json` snapshot consumed by the verifier.
 *
 * The verifier reads this snapshot WITHOUT importing the scenario .ts
 * files, so the JSON has to be self-contained per scenario:
 * id → { truth, surql_probe?, kind }.
 */
import type { TruthsSnapshot } from '../types.js';
import type { Seed } from './persona.js';
import { ALL_SCENARIOS } from '../scenarios/index.js';

export function buildTruths(seed: Seed, seedVersion: string): TruthsSnapshot {
  const scenarios: TruthsSnapshot['scenarios'] = {};
  for (const s of ALL_SCENARIOS) {
    scenarios[s.id] = {
      truth: s.ts_truth(seed),
      surql_probe: s.surql_probe,
      kind: s.kind,
    };
  }
  return {
    generated_at: new Date().toISOString(),
    seed_version: seedVersion,
    scenarios,
  };
}
