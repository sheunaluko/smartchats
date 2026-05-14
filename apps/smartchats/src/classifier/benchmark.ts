import { classifyForAck, getStatus, init, setInsights } from './embedding_classifier';

interface TestCase {
  input: string;
  expected: string;
}

const TEST_SUITE: TestCase[] = [
  // greeting (3)
  { input: 'hey whats up', expected: 'greeting' },
  { input: 'good morning', expected: 'greeting' },
  { input: 'hi there how are you', expected: 'greeting' },
  // empathy (3)
  { input: 'my computer keeps crashing and i lost my work', expected: 'empathy' },
  { input: 'im feeling really stressed out', expected: 'empathy' },
  { input: 'i failed my exam', expected: 'empathy' },
  // enthusiasm (2)
  { input: 'i got a job promotion', expected: 'enthusiasm' },
  { input: 'we just launched the product and its doing great', expected: 'enthusiasm' },
  // affirmative_action (3)
  { input: 'can you write me a python script', expected: 'affirmative_action' },
  { input: 'send an email to my boss', expected: 'affirmative_action' },
  { input: 'delete all the old log files', expected: 'affirmative_action' },
  // thinking (3)
  { input: 'what is the meaning of life', expected: 'thinking' },
  { input: 'why do some languages have grammatical gender', expected: 'thinking' },
  { input: 'how does quantum computing work', expected: 'thinking' },
  // buying_time (2)
  { input: 'show me my calendar for next week', expected: 'buying_time' },
  { input: 'look up the latest sales numbers', expected: 'buying_time' },
  // quick_confirm (2)
  { input: 'ok sounds good', expected: 'quick_confirm' },
  { input: 'yes please do that', expected: 'quick_confirm' },
  // soft_transition (2)
  { input: 'anyway moving on to the next topic', expected: 'soft_transition' },
  { input: 'so what else is new', expected: 'soft_transition' },
];

export interface BenchmarkResult {
  model: string;
  total: number;
  correct: number;
  accuracy: number;
  avg_latency_ms: number;
  min_latency_ms: number;
  max_latency_ms: number;
  load_time_ms: number | null;
  cached: boolean | null;
  results: Array<{
    input: string;
    expected: string;
    predicted: string;
    correct: boolean;
    score: number;
    latency_ms: number;
  }>;
  misses: Array<{
    input: string;
    expected: string;
    predicted: string;
    score: number;
  }>;
  by_category: Record<string, { total: number; correct: number; accuracy: number }>;
}

// Insights ref for emitting benchmark report
let insightsRef: any = null;

function emit(type: string, payload: Record<string, any>) {
  if (insightsRef) {
    try {
      insightsRef.addEvent(type, { ...payload, tags: ['classifier', 'benchmark'] });
    } catch { /* swallow */ }
  }
}

export async function runBenchmark(insights?: any): Promise<BenchmarkResult> {
  // Use passed insights or try the module-level one from the classifier
  if (insights) insightsRef = insights;
  else if (!insightsRef) {
    // Pull from embedding_classifier's shared insights via setInsights side-effect
    // (it's already set if app wired it up)
    try {
      insightsRef = (globalThis as any).cortexInsights ?? null;
    } catch { /* swallow */ }
  }

  // Ensure model is loaded
  await init();
  const status = getStatus();

  const results: BenchmarkResult['results'] = [];

  for (let i = 0; i < TEST_SUITE.length; i++) {
    const tc = TEST_SUITE[i];
    console.log(`[${i + 1}/${TEST_SUITE.length}] "${tc.input}"`);
    const r = await classifyForAck(tc.input);
    const correct = r.category.id === tc.expected;
    const topScore = r.scores[0].max;
    const mark = correct ? '\u2705' : '\u274c';
    console.log(`  ${mark} ${r.category.id} (${topScore.toFixed(3)}) ${r.latency_ms}ms${!correct ? ` \u2014 expected ${tc.expected}` : ''}`);
    results.push({
      input: tc.input,
      expected: tc.expected,
      predicted: r.category.id,
      correct,
      score: topScore,
      latency_ms: r.latency_ms,
    });
  }

  const correct = results.filter(r => r.correct).length;
  const latencies = results.map(r => r.latency_ms);

  // Per-category breakdown
  const byCategory: BenchmarkResult['by_category'] = {};
  for (const r of results) {
    if (!byCategory[r.expected]) byCategory[r.expected] = { total: 0, correct: 0, accuracy: 0 };
    byCategory[r.expected].total++;
    if (r.correct) byCategory[r.expected].correct++;
  }
  for (const cat of Object.values(byCategory)) {
    cat.accuracy = Math.round((cat.correct / cat.total) * 100) / 100;
  }

  const misses = results
    .filter(r => !r.correct)
    .map(r => ({ input: r.input, expected: r.expected, predicted: r.predicted, score: r.score }));

  const out: BenchmarkResult = {
    model: status.model,
    total: results.length,
    correct,
    accuracy: Math.round((correct / results.length) * 100) / 100,
    avg_latency_ms: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    min_latency_ms: Math.min(...latencies),
    max_latency_ms: Math.max(...latencies),
    load_time_ms: status.load_time_ms,
    cached: status.cached,
    results,
    misses,
    by_category: byCategory,
  };

  // Print summary to console
  console.log(`\n=== Classifier Benchmark: ${out.model} ===`);
  console.log(`Accuracy: ${out.correct}/${out.total} (${(out.accuracy * 100).toFixed(0)}%)`);
  console.log(`Latency: avg ${out.avg_latency_ms}ms | min ${out.min_latency_ms}ms | max ${out.max_latency_ms}ms`);
  console.log(`Model load: ${out.load_time_ms}ms (cached: ${out.cached})`);
  console.log('\nPer category:');
  for (const [cat, stats] of Object.entries(out.by_category)) {
    console.log(`  ${cat.padEnd(20)} ${stats.correct}/${stats.total} (${(stats.accuracy * 100).toFixed(0)}%)`);
  }
  console.log('\nMisses:');
  for (const m of misses) {
    console.log(`  "${m.input}" \u2192 ${m.predicted} (expected ${m.expected}, score ${m.score.toFixed(3)})`);
  }
  console.log('');

  // Emit full benchmark report as telemetry event
  emit('embedding_classifier_benchmark', {
    model: out.model,
    total: out.total,
    correct: out.correct,
    accuracy: out.accuracy,
    avg_latency_ms: out.avg_latency_ms,
    min_latency_ms: out.min_latency_ms,
    max_latency_ms: out.max_latency_ms,
    load_time_ms: out.load_time_ms,
    cached: out.cached,
    by_category: out.by_category,
    misses,
    results: out.results,
  });

  return out;
}
