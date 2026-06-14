/**
 * Regenerate the benchpress fixtures from scratch.
 *
 *   - fixtures/canonical_user.surql  — `surreal import`-able seed
 *   - fixtures/truths.json           — per-scenario expected answers
 *   - fixtures/embeddings.json       — sha1(model|text) → vector cache
 *
 * Deterministic: same seed number + same cached embeddings → identical
 * `.surql` output byte-for-byte. First run after the cache file is wiped
 * (or a new content string appears) calls OpenAI's text-embedding-3-small
 * for the cache miss — set OPENAI_API_KEY in your shell.
 *
 *   tsx packages/benchpress/scripts/generate.ts
 *   tsx packages/benchpress/scripts/generate.ts --no-embed   # skip embeddings entirely
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePersona, SEED_VERSION, type Seed } from '../src/generator/persona.js';
import { emitSurql } from '../src/generator/emit_surql.js';
import { buildTruths } from '../src/generator/emit_truths.js';
import { embedAll } from '../src/generator/embed.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const fixturesDir = resolve(pkgRoot, 'fixtures');

const skipEmbed = process.argv.includes('--no-embed');

mkdirSync(fixturesDir, { recursive: true });

const t0 = Date.now();
const seed = generatePersona();

if (!skipEmbed) {
  await attachEmbeddings(seed);
}

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
  logs_embedded: seed.logs.filter((l) => l.embedding).length,
  entities_embedded: seed.entities.filter((e) => e.embedding).length,
};
console.log(`benchpress: generated in ${Date.now() - t0}ms`);
console.log(`  ${surqlPath}`);
console.log(`  ${truthsPath}`);
console.log(`  rows:`, stats);

/**
 * Compute (or load from cache) embeddings for every text-bearing row that
 * needs to support semantic search. The schema's HNSW indexes are defined
 * on `logs.embedding`, `user_entities.embedding`, `user_relations.embedding`,
 * `events.embedding`, `cortex.embedding` (DIMENSION 1536). We attach to logs
 * + entities since those are the only tables benchpress's seed populates.
 *
 * Embed text choices match what the runtime app embeds:
 *   - logs    → `content`
 *   - entities → `name`  (matches knowledge_graph.ts buildKnowledgeInsertQuery)
 */
async function attachEmbeddings(s: Seed): Promise<void> {
  const cachePath = resolve(fixturesDir, 'embeddings.json');
  const texts: string[] = [];
  for (const l of s.logs) texts.push(l.content);
  for (const e of s.entities) texts.push(e.name);

  const { byText, cacheHits, cacheMisses } = await embedAll(texts, { cachePath });
  console.log(`embed: ${cacheHits} cached, ${cacheMisses} fetched`);

  for (const l of s.logs) {
    const v = byText.get(l.content);
    if (v) l.embedding = v;
  }
  for (const e of s.entities) {
    const v = byText.get(e.name);
    if (v) e.embedding = v;
  }
}
