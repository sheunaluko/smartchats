/**
 * Regenerate the benchpress fixtures from scratch.
 *
 *   - fixtures/canonical_user.surql  — `surreal import`-able seed
 *   - fixtures/truths.json           — per-scenario expected answers
 *
 * Deterministic: same seed number → identical output, byte-for-byte.
 *
 *   tsx packages/benchpress/scripts/generate.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePersona, SEED_VERSION } from '../src/generator/persona.js';
import { emitSurql } from '../src/generator/emit_surql.js';
import { buildTruths } from '../src/generator/emit_truths.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const fixturesDir = resolve(pkgRoot, 'fixtures');

mkdirSync(fixturesDir, { recursive: true });

const t0 = Date.now();
const seed = generatePersona();
const surql = emitSurql(seed, { seedVersion: SEED_VERSION });
const truths = buildTruths(seed, SEED_VERSION);

const surqlPath = resolve(fixturesDir, 'canonical_user.surql');
const truthsPath = resolve(fixturesDir, 'truths.json');

writeFileSync(surqlPath, surql, 'utf8');
writeFileSync(truthsPath, JSON.stringify(truths, null, 2), 'utf8');

const stats = {
  logs: seed.logs.length,
  metrics: seed.metrics.length,
  entities: seed.entities.length,
  todos: seed.todos.length,
  completions: seed.completions.length,
  scenarios: Object.keys(truths.scenarios).length,
};
console.log(`benchpress: generated in ${Date.now() - t0}ms`);
console.log(`  ${surqlPath}`);
console.log(`  ${truthsPath}`);
console.log(`  rows:`, stats);
