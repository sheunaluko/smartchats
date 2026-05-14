import type { AckType } from '@lab-components/tivi/lib/tts_acknowledgements';
import { ACK_CATEGORIES, ACK_CATEGORY_LABELS, LABEL_TO_CATEGORY, getAckFromCategory } from './ack_cat';
import type { AckCategory } from './ack_cat';

const MODEL = 'Xenova/nli-deberta-v3-xsmall';

export interface ClassificationResult {
  category: AckCategory;
  ackType: AckType;
  scores: Array<{ label: string; categoryId: string; score: number }>;
  latency_ms: number;
}

export interface ClassifierStatus {
  model: string;
  loaded: boolean;
  loading: boolean;
  load_time_ms: number | null;
  cached: boolean | null;
  init_query_time_ms: number | null;
  error: string | null;
  classification_count: number;
}

// -- State --

let classifier: any = null;
let pipelinePromise: Promise<any> | null = null;
let insightsRef: any = null;

let status: ClassifierStatus = {
  model: MODEL,
  loaded: false,
  loading: false,
  load_time_ms: null,
  cached: null,
  init_query_time_ms: null,
  error: null,
  classification_count: 0,
};

// -- Telemetry helper --

function emit(type: string, payload: Record<string, any>) {
  if (insightsRef) {
    try {
      insightsRef.addEvent(type, { ...payload, tags: ['classifier', 'experimental'] });
    } catch { /* swallow */ }
  }
}

// -- Core --

async function loadPipeline(): Promise<any> {
  if (classifier) return classifier;
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    status.loading = true;
    status.error = null;
    const t0 = performance.now();

    try {
      const { pipeline } = await import('@huggingface/transformers');
      classifier = await pipeline('zero-shot-classification', MODEL, { dtype: 'q8' });

      const loadTime = Math.round(performance.now() - t0);
      const cached = loadTime < 2000;
      status.load_time_ms = loadTime;
      status.cached = cached;
      status.loaded = true;
      status.loading = false;

      emit('classifier_model_loaded', { model: MODEL, load_time_ms: loadTime, cached });

      // Warmup: dummy query to JIT the ONNX session
      const tw0 = performance.now();
      await classifier('warmup', ACK_CATEGORY_LABELS, { multi_label: false, hypothesis_template: '{}' });
      const warmupTime = Math.round(performance.now() - tw0);
      status.init_query_time_ms = warmupTime;

      emit('classifier_warmup_complete', { model: MODEL, init_query_time_ms: warmupTime });

      return classifier;
    } catch (err: any) {
      status.loading = false;
      status.error = err?.message ?? String(err);
      pipelinePromise = null;
      emit('classifier_load_error', { model: MODEL, error: status.error });
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

export async function classifyForAck(text: string): Promise<ClassificationResult> {
  const pipe = await loadPipeline();
  const t0 = performance.now();

  const result = await pipe(text, ACK_CATEGORY_LABELS, { multi_label: false, hypothesis_template: '{}' });

  const latency_ms = Math.round(performance.now() - t0);
  status.classification_count++;

  const scores: ClassificationResult['scores'] = (result.labels as string[]).map((label: string, i: number) => ({
    label,
    categoryId: LABEL_TO_CATEGORY.get(label)?.id ?? 'unknown',
    score: result.scores[i] as number,
  }));

  const winningLabel = scores[0].label;
  const match = getAckFromCategory(winningLabel);

  const out: ClassificationResult = {
    category: match?.category ?? ACK_CATEGORIES[0],
    ackType: match?.ackType ?? 'sure' as AckType,
    scores,
    latency_ms,
  };

  emit('classifier_result', {
    model: MODEL,
    input_text: text,
    winning_category: out.category.id,
    winning_ack: out.ackType,
    top_score: scores[0].score,
    scores,
    latency_ms,
    classification_count: status.classification_count,
  });

  return out;
}

export function getStatus(): ClassifierStatus {
  return { ...status };
}

export function reset() {
  classifier = null;
  pipelinePromise = null;
  status = {
    model: MODEL,
    loaded: false,
    loading: false,
    load_time_ms: null,
    cached: null,
    init_query_time_ms: null,
    error: null,
    classification_count: 0,
  };
}
