/**
 * Embedding pipeline for the seed generator.
 *
 * Calls OpenAI's `text-embedding-3-small` (1536-dim, matches the schema's
 * HNSW DIMENSION) and caches results to `fixtures/embeddings.json` keyed by
 * sha1(model + "\n" + text). Identical text → identical hash → cache hit, so
 * regenerating the seed without content changes costs $0 and stays
 * byte-deterministic.
 *
 * Why call OpenAI directly instead of routing through
 * `smartchats-local-server`'s /embeddings/embed endpoint:
 *   - Generator runs *before* any server is up
 *   - That endpoint embeds one text per HTTP call; OpenAI's native API
 *     accepts up to 2048 strings per batch, so we ship 2500 rows in ~2 calls
 *     instead of 2500
 *   - Same model end-to-end → semantic equivalence with what the app would
 *     compute at runtime
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MODEL = 'text-embedding-3-small';
const DIMENSION = 1536;
const BATCH_SIZE = 1024;          // well under OpenAI's 2048 limit; safer for large strings
const API_URL = 'https://api.openai.com/v1/embeddings';

export const EMBED_MODEL = MODEL;
export const EMBED_DIMENSION = DIMENSION;

interface CacheFile {
  version: 1;
  model: string;
  dimension: number;
  /** sha1(model + "\n" + text) → 1536-dim embedding. */
  entries: Record<string, number[]>;
}

function hashKey(text: string): string {
  return createHash('sha1').update(MODEL).update('\n').update(text).digest('hex');
}

function loadCache(path: string): CacheFile {
  if (!existsSync(path)) {
    return { version: 1, model: MODEL, dimension: DIMENSION, entries: {} };
  }
  const data = JSON.parse(readFileSync(path, 'utf8')) as CacheFile;
  if (data.version !== 1 || data.model !== MODEL || data.dimension !== DIMENSION) {
    // Cache schema/model drift — start fresh.
    return { version: 1, model: MODEL, dimension: DIMENSION, entries: {} };
  }
  return data;
}

function saveCache(path: string, cache: CacheFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 0), 'utf8');
}

interface OpenAIEmbeddingsResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
  model: string;
}

async function fetchBatch(inputs: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as OpenAIEmbeddingsResponse;
  const result: number[][] = new Array(inputs.length);
  for (const item of json.data) {
    if (item.embedding.length !== DIMENSION) {
      throw new Error(`unexpected embedding dimension: ${item.embedding.length} (expected ${DIMENSION})`);
    }
    result[item.index] = item.embedding;
  }
  return result;
}

export interface EmbedAllOptions {
  cachePath: string;
  /** Optional logger; defaults to console. */
  log?: (msg: string) => void;
}

export interface EmbedAllResult {
  /** Original text → embedding vector. */
  byText: Map<string, number[]>;
  cacheHits: number;
  cacheMisses: number;
}

/**
 * Resolve every text → embedding, using the cache where possible and the
 * OpenAI API for the rest. Save the updated cache before returning.
 */
export async function embedAll(texts: string[], opts: EmbedAllOptions): Promise<EmbedAllResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const cache = loadCache(opts.cachePath);
  const unique = [...new Set(texts)];

  const byText = new Map<string, number[]>();
  const missing: string[] = [];
  for (const t of unique) {
    const cached = cache.entries[hashKey(t)];
    if (cached) byText.set(t, cached);
    else missing.push(t);
  }
  const cacheHits = unique.length - missing.length;
  const cacheMisses = missing.length;

  if (cacheMisses > 0) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        `${cacheMisses} new strings need embedding but OPENAI_API_KEY is not set.\n` +
        `Either set it in your shell (export OPENAI_API_KEY=...) or commit ` +
        `the embedding cache (fixtures/embeddings.json) covering them.`,
      );
    }
    log(`embed: ${cacheHits} cached, ${cacheMisses} to fetch in ${Math.ceil(cacheMisses / BATCH_SIZE)} batch(es)`);

    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE);
      const t0 = Date.now();
      const vectors = await fetchBatch(batch, apiKey);
      log(`  batch ${i / BATCH_SIZE + 1}: ${batch.length} strings in ${Date.now() - t0}ms`);
      for (let j = 0; j < batch.length; j++) {
        const text = batch[j]!;
        const vec = vectors[j]!;
        byText.set(text, vec);
        cache.entries[hashKey(text)] = vec;
      }
      // Persist after each batch so a mid-run failure doesn't lose progress.
      saveCache(opts.cachePath, cache);
    }
  } else {
    log(`embed: ${cacheHits} cache hits, 0 fetches needed`);
  }

  return { byText, cacheHits, cacheMisses };
}
