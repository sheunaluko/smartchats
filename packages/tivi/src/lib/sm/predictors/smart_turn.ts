/**
 * Smart Turn v3 predictor — main-thread WASM implementation.
 *
 * Loads the 8.3 MB int8 ONNX model (openai/whisper-tiny encoder + linear
 * classifier head) from apps/smartchats/public/onnx/, runs Whisper-style
 * mel-spectrogram preprocessing via @huggingface/transformers, and emits
 * a sigmoid probability of turn completion.
 *
 * Model spec (from pipecat-ai/smart-turn-v3):
 *   - Sample rate: 16 kHz mono
 *   - Max duration: 8 s (128 000 samples)
 *   - Padding rule: zero-pad at the BEGINNING (real audio at the end)
 *   - Truncation rule: keep the LAST 8 s
 *   - Input tensor: input_features [1, 80, 800] (log-mel)
 *   - Output tensor: logits [1, 1] — sigmoid activation baked in → already a probability
 *   - Threshold: 0.5
 *
 * License: BSD-2-Clause.
 */

import type { EndpointPredictor, PredictorDecision, PredictorWarmup } from '../types';
import { get_smart_turn_session, warmup_smart_turn } from '../../onnx';

const TARGET_SR = 16000;
const MAX_SAMPLES = 8 * TARGET_SR; // 128 000
const THRESHOLD = 0.5;

// ─── Feature extractor: lazy-load @huggingface/transformers ────────────
//
// We use AutoFeatureExtractor.from_pretrained('openai/whisper-tiny') for
// bit-parity with the Python reference's WhisperFeatureExtractor(chunk_length=8,
// do_normalize=True). The Smart Turn repo doesn't ship its own
// preprocessor_config.json — it uses Whisper's default (n_mels=80, n_fft=400,
// hop_length=160, Hann window). transformers.js mirrors that exactly.

let cachedFE: any = null;
let feLoadPromise: Promise<any> | null = null;

async function getFeatureExtractor(): Promise<any> {
  if (cachedFE) return cachedFE;
  if (feLoadPromise) return feLoadPromise;
  feLoadPromise = (async () => {
    const tj = await import('@huggingface/transformers');
    // Pin chunk_length=8 to match Smart Turn's 8-second window; the config
    // otherwise inherits Whisper-tiny's defaults from HF.
    const fe = await tj.AutoFeatureExtractor.from_pretrained('openai/whisper-tiny', {
      chunk_length: 8,
    } as any);
    cachedFE = fe;
    return fe;
  })();
  try {
    return await feLoadPromise;
  } finally {
    feLoadPromise = null;
  }
}

// ─── Audio prep helpers ───────────────────────────────────────────────

/**
 * Truncate to last MAX_SAMPLES or zero-pad at the beginning to reach
 * MAX_SAMPLES. Matches audio_utils.truncate_audio_to_last_n_seconds in
 * the reference Python inference.py.
 */
function padOrTruncate(audio: Float32Array): Float32Array {
  if (audio.length === MAX_SAMPLES) return audio;
  if (audio.length > MAX_SAMPLES) {
    return audio.slice(audio.length - MAX_SAMPLES);
  }
  const out = new Float32Array(MAX_SAMPLES);
  // Zeros already; real audio goes at the END.
  out.set(audio, MAX_SAMPLES - audio.length);
  return out;
}

// ─── Predictor factory ────────────────────────────────────────────────

export interface SmartTurnPredictorOptions {
  /** Override probability threshold. Default: 0.5 (from the model card). */
  threshold?: number;
  /** For diagnostic logging in the browser. */
  verbose?: boolean;
}

export function createSmartTurnPredictor(
  opts: SmartTurnPredictorOptions = {},
): EndpointPredictor {
  const threshold = opts.threshold ?? THRESHOLD;
  const verbose = opts.verbose ?? false;

  return {
    async warmup(): Promise<PredictorWarmup> {
      const start = performance.now();
      try {
        // Warm both the ONNX session and the mel feature extractor in parallel.
        const results = await Promise.allSettled([
          warmup_smart_turn(),
          getFeatureExtractor(),
        ]);
        const sessionResult = results[0];
        const feResult = results[1];
        if (sessionResult.status === 'rejected') {
          return {
            ok: false,
            duration_ms: Math.round(performance.now() - start),
            cached: false,
            error: `session load failed: ${String(sessionResult.reason)}`,
          };
        }
        if (feResult.status === 'rejected') {
          return {
            ok: false,
            duration_ms: Math.round(performance.now() - start),
            cached: false,
            error: `feature extractor load failed: ${String(feResult.reason)}`,
          };
        }
        return {
          ok: sessionResult.value.ok,
          duration_ms: Math.round(performance.now() - start),
          cached: sessionResult.value.cached,
          error: sessionResult.value.error,
        };
      } catch (err: any) {
        return {
          ok: false,
          duration_ms: Math.round(performance.now() - start),
          cached: false,
          error: err?.message || String(err),
        };
      }
    },

    async predict(audio: Float32Array, signal?: AbortSignal): Promise<PredictorDecision> {
      const start = performance.now();

      if (signal?.aborted) throw new Error('aborted');

      const session = await get_smart_turn_session();
      const fe = await getFeatureExtractor();

      if (signal?.aborted) throw new Error('aborted');

      // 1. Pad/truncate audio to 8 s.
      const padded = padOrTruncate(audio);

      // 2. Mel-spec via Whisper feature extractor. do_normalize=True is the
      //    HF default, and it matches the Python reference.
      const feResult = await fe(padded, {
        sampling_rate: TARGET_SR,
      });

      if (signal?.aborted) throw new Error('aborted');

      // feResult.input_features is a transformers.js Tensor of shape [1, 80, 800]
      // (or [80, 800] depending on version). Normalize to a shape+data pair.
      const inputTensor = extractInputFeatures(feResult);

      // 3. Build an ONNX Tensor and run the session.
      // We reach ort via the loaded session's proto rather than importing ort
      // separately — same runtime is used throughout tivi.
      const ort = (await import(/* webpackIgnore: true */ '/onnx/ort.wasm.min.mjs' as any));
      const ortTensor = new ort.Tensor('float32', inputTensor.data, inputTensor.shape);
      const outputs = await session.run({ input_features: ortTensor });

      if (signal?.aborted) throw new Error('aborted');

      // 4. Read output. Model exports 'logits' with sigmoid baked in → probability [0,1].
      const outName = Object.keys(outputs)[0];
      const probability = Number(outputs[outName].data[0]);
      const complete = probability >= threshold;
      const latency_ms = Math.round(performance.now() - start);

      if (verbose) {
        // eslint-disable-next-line no-console
        console.debug(`[smart-turn] prob=${probability.toFixed(3)} complete=${complete} in ${latency_ms}ms`);
      }

      return { complete, probability, latency_ms };
    },
  };
}

// Extract [1, 80, 800] float32 from the transformers.js output. Handles
// both wrapped-Tensor and raw-array shapes across library versions.
function extractInputFeatures(feResult: any): { data: Float32Array; shape: number[] } {
  // Prefer the .input_features field (Whisper convention)
  const raw = feResult?.input_features ?? feResult;
  if (raw?.data && Array.isArray(raw?.dims)) {
    // transformers.js Tensor: has `data` (typed array) + `dims` (shape).
    const shape = raw.dims.length === 3 ? raw.dims : [1, ...raw.dims];
    return { data: raw.data as Float32Array, shape };
  }
  if (raw?.data && Array.isArray(raw?.shape)) {
    const shape = raw.shape.length === 3 ? raw.shape : [1, ...raw.shape];
    return { data: raw.data as Float32Array, shape };
  }
  // Fallback: raw is the Float32Array itself; assume [1, 80, 800].
  if (raw instanceof Float32Array) {
    return { data: raw, shape: [1, 80, 800] };
  }
  throw new Error('smart-turn: could not interpret feature-extractor output shape');
}
