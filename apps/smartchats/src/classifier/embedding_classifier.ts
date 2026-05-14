import type { AckType } from '@lab-components/tivi/lib/tts_acknowledgements';
import { ACK_CATEGORIES } from './ack_cat';
import type { AckCategory } from './ack_cat';

const MODEL = 'Xenova/all-MiniLM-L6-v2';

// -- Types --

export interface CategoryScore {
  categoryId: string;
  max: number;
  avg: number;
  median: number;
  min: number;
}

export interface EmbeddingClassificationResult {
  category: AckCategory;
  ackType: AckType;
  scores: CategoryScore[];
  latency_ms: number;
  embed_ms: number;
  similarity_ms: number;
}

export interface EmbeddingClassifierStatus {
  model: string;
  loaded: boolean;
  loading: boolean;
  load_time_ms: number | null;
  embed_time_ms: number | null;
  warmup_ms: number | null;
  cached: boolean | null;
  error: string | null;
  classification_count: number;
  exemplar_count: number;
}

// -- State --

let embedder: any = null;
let pipelinePromise: Promise<any> | null = null;
let insightsRef: any = null;

/** Map from category id → array of pre-computed exemplar embeddings */
let exemplarEmbeddings: Map<string, Float32Array[]> = new Map();

let status: EmbeddingClassifierStatus = {
  model: MODEL,
  loaded: false,
  loading: false,
  load_time_ms: null,
  embed_time_ms: null,
  warmup_ms: null,
  cached: null,
  error: null,
  classification_count: 0,
  exemplar_count: 0,
};

// -- Telemetry helper --

function emit(type: string, payload: Record<string, any>) {
  if (insightsRef) {
    try {
      insightsRef.addEvent(type, { ...payload, tags: ['classifier', 'experimental'] });
    } catch { /* swallow */ }
  }
}

// -- Math helpers --

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Extract Float32Array from pipeline output (handles nested Tensor objects) */
function extractEmbedding(output: any): Float32Array {
  // pipeline('feature-extraction') returns a Tensor with .data
  if (output?.data && output.data instanceof Float32Array) {
    // For a single sentence, shape is [1, tokens, dims] — we want mean pooling
    // But with pooling/normalize options the pipeline may already return [1, dims]
    return output.data as Float32Array;
  }
  // Fallback: if it's already a Float32Array
  if (output instanceof Float32Array) return output;
  // If it's an array of arrays, take first
  if (Array.isArray(output) && output.length > 0) {
    if (output[0] instanceof Float32Array) return output[0];
    return new Float32Array(output[0]);
  }
  throw new Error('Unexpected embedding output format');
}

/** Mean-pool a [1, tokens, dims] tensor into [dims] */
function meanPool(data: Float32Array, dims: number): Float32Array {
  const tokens = data.length / dims;
  const result = new Float32Array(dims);
  for (let d = 0; d < dims; d++) {
    let sum = 0;
    for (let t = 0; t < tokens; t++) {
      sum += data[t * dims + d];
    }
    result[d] = sum / tokens;
  }
  return result;
}

/** Normalize a vector to unit length */
function normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  const result = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) result[i] = vec[i] / norm;
  return result;
}

/** Embed a single text, returning a normalized [dims] Float32Array */
async function embedText(text: string): Promise<Float32Array> {
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  // output is a Tensor with shape [1, dims] after pooling
  const raw = extractEmbedding(output);
  // If pooling worked, raw.length === dims. If not, we need to mean-pool.
  // all-MiniLM-L6-v2 has 384 dims
  if (raw.length === 384) return raw;
  if (raw.length > 384 && raw.length % 384 === 0) {
    return normalize(meanPool(raw, 384));
  }
  // Fallback: return as-is (already pooled at different dim)
  return raw;
}

// -- Core --

async function loadPipeline(): Promise<any> {
  if (embedder) return embedder;
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    status.loading = true;
    status.error = null;
    const t0 = performance.now();

    try {
      const { pipeline } = await import('@huggingface/transformers');
      embedder = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });

      const loadTime = Math.round(performance.now() - t0);
      const cached = loadTime < 2000;
      status.load_time_ms = loadTime;
      status.cached = cached;
      status.loaded = true;
      status.loading = false;

      // Embed all exemplars
      const te0 = performance.now();
      let totalExemplars = 0;
      for (const cat of ACK_CATEGORIES) {
        const embeddings: Float32Array[] = [];
        for (const sentence of cat.exemplars) {
          embeddings.push(await embedText(sentence));
          totalExemplars++;
        }
        exemplarEmbeddings.set(cat.id, embeddings);
      }
      const embedTime = Math.round(performance.now() - te0);
      status.embed_time_ms = embedTime;
      status.exemplar_count = totalExemplars;

      emit('embedding_classifier_loaded', {
        model: MODEL,
        load_time_ms: loadTime,
        embed_time_ms: embedTime,
        exemplar_count: totalExemplars,
        cached,
      });

      // Warmup with dummy embed
      const tw0 = performance.now();
      await embedText('warmup');
      const warmupMs = Math.round(performance.now() - tw0);
      status.warmup_ms = warmupMs;

      emit('embedding_classifier_warmup', { model: MODEL, warmup_ms: warmupMs });

      return embedder;
    } catch (err: any) {
      status.loading = false;
      status.error = err?.message ?? String(err);
      pipelinePromise = null;
      emit('embedding_classifier_error', { model: MODEL, error: status.error });
      throw err;
    }
  })();

  return pipelinePromise;
}

// -- Public API --

export function setInsights(client: any) {
  insightsRef = client;
}

export async function init(): Promise<void> {
  await loadPipeline();
}

export async function classifyForAck(text: string): Promise<EmbeddingClassificationResult> {
  await loadPipeline();

  const t0 = performance.now();

  // 1. Embed input text
  const te0 = performance.now();
  const inputEmb = await embedText(text);
  const embed_ms = Math.round(performance.now() - te0);

  // 2. Compute cosine similarity against all exemplar embeddings
  const ts0 = performance.now();
  const scores: CategoryScore[] = [];

  for (const cat of ACK_CATEGORIES) {
    const catEmbeddings = exemplarEmbeddings.get(cat.id);
    if (!catEmbeddings || catEmbeddings.length === 0) {
      scores.push({ categoryId: cat.id, max: 0, avg: 0, median: 0, min: 0 });
      continue;
    }

    const sims = catEmbeddings.map(emb => cosineSimilarity(inputEmb, emb));
    const sum = sims.reduce((a, b) => a + b, 0);

    scores.push({
      categoryId: cat.id,
      max: Math.max(...sims),
      avg: sum / sims.length,
      median: median(sims),
      min: Math.min(...sims),
    });
  }
  const similarity_ms = Math.round(performance.now() - ts0);

  // 3. Sort by max descending
  scores.sort((a, b) => b.max - a.max);

  // 4. Winner = highest max similarity
  const winner = scores[0];
  const winningCategory = ACK_CATEGORIES.find(c => c.id === winner.categoryId)!;
  const ackType = winningCategory.ack_types[Math.floor(Math.random() * winningCategory.ack_types.length)];

  const latency_ms = Math.round(performance.now() - t0);
  status.classification_count++;

  const out: EmbeddingClassificationResult = {
    category: winningCategory,
    ackType,
    scores,
    latency_ms,
    embed_ms,
    similarity_ms,
  };

  emit('embedding_classifier_result', {
    model: MODEL,
    input_text: text,
    winning_category: winningCategory.id,
    winning_ack: ackType,
    top_max_score: winner.max,
    scores,
    latency_ms,
    embed_ms,
    similarity_ms,
    classification_count: status.classification_count,
  });

  return out;
}

export function getStatus(): EmbeddingClassifierStatus {
  return { ...status };
}

export function reset() {
  embedder = null;
  pipelinePromise = null;
  exemplarEmbeddings = new Map();
  status = {
    model: MODEL,
    loaded: false,
    loading: false,
    load_time_ms: null,
    embed_time_ms: null,
    warmup_ms: null,
    cached: null,
    error: null,
    classification_count: 0,
    exemplar_count: 0,
  };
}
