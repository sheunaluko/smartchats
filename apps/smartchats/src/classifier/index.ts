// Default: embedding classifier
export { init, classifyForAck, setInsights, getStatus, reset } from './embedding_classifier';
export type { EmbeddingClassificationResult, EmbeddingClassifierStatus } from './embedding_classifier';

// NLI classifier (kept for comparison)
export * as nli from './text_classifier';

// Shared
export { ACK_CATEGORIES, ACK_CATEGORY_LABELS, LABEL_TO_CATEGORY, getAckFromCategory } from './ack_cat';
export type { AckCategory } from './ack_cat';

export { runBenchmark } from './benchmark';
export type { BenchmarkResult } from './benchmark';
