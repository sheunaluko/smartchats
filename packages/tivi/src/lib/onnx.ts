'use client';

import { TSVAD } from './ts_vad/src';
import { logger } from 'smartchats-common';

const log = logger.get_logger({ id: 'tivi/onnx' });

// Track if ONNX has been initialized
let onnxInitialized = false;
let ort: any = null;
let cachedSilero: any = null;
let sileroLoadPromise: Promise<any> | null = null;

// Dynamically import ONNX runtime (only on client side)
async function getOnnxRuntime() {
  if (typeof window === 'undefined') {
    throw new Error('ONNX runtime can only be used on client side');
  }

  if (!ort) {
    // This bypasses the entire Webpack/Terser/SWC pipeline
    // It loads the minified file directly from the public folder
    // webpackIgnore tells webpack to completely ignore this import
    // @ts-expect-error - Dynamic import from public folder, type checking not applicable
    ort = await import(/* webpackIgnore: true */ '/onnx/ort.wasm.min.mjs');

    // Explicitly set the WASM paths to the public folder
    ort.env.wasm.wasmPaths = '/onnx/';
    ort.env.logLevel = 'error';
    onnxInitialized = true;
    log('ONNX runtime initialized from /onnx/ort.wasm.min.mjs');
  }

  return ort;
}

export async function get_ort() {
  return await getOnnxRuntime();
}

// Cached session — safe to share across TSVAD instances since the session
// itself is read-only; TSVAD holds its own per-instance state tensor (see
// SileroV5Model). Pre-warming via warmupVAD() populates this so the first
// startListening() pays only the audio stream init cost, not the model load.
export async function get_silero_session() {
  if (cachedSilero) return cachedSilero;
  if (sileroLoadPromise) return sileroLoadPromise;
  sileroLoadPromise = (async () => {
    const ortRuntime = await getOnnxRuntime();
    log('Loading Silero VAD session');
    const session = await ortRuntime.InferenceSession.create('/onnx/silero_vad_v5.onnx');
    log('Silero session loaded');
    cachedSilero = session;
    return session;
  })();
  try {
    return await sileroLoadPromise;
  } finally {
    sileroLoadPromise = null;
  }
}

/**
 * Pre-load the ONNX runtime + Silero VAD model so the first call to
 * `startListening()` doesn't pay the cold WASM/model-fetch cost in the
 * Start click path. Idempotent — second call returns immediately with
 * `cached: true`. Never throws; failures are returned in the result so
 * callers can emit instrumentation without try/catch noise.
 */
export async function warmup_vad(): Promise<{
  duration_ms: number;
  ok: boolean;
  cached: boolean;
  error?: string;
}> {
  const start = performance.now();
  if (cachedSilero) {
    return { duration_ms: 0, ok: true, cached: true };
  }
  try {
    await get_silero_session();
    return {
      duration_ms: Math.round(performance.now() - start),
      ok: true,
      cached: false,
    };
  } catch (err: any) {
    return {
      duration_ms: Math.round(performance.now() - start),
      ok: false,
      cached: false,
      error: err?.message || String(err),
    };
  }
}

export async function enable_vad(options: {
  onSpeechStart?: () => void;
  onSpeechEnd?: (audio: Float32Array) => void;
  onFrameProcessed?: (prob: number, frame: Float32Array) => void;
  onError?: (err: Error) => void;
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  redemptionMs?: number;
  preSpeechPadMs?: number;
  minSpeechStartMs?: number;
}): Promise<{
  vad: TSVAD;
  audioContext: AudioContext;
  analyserNode: AnalyserNode;
  stream: MediaStream;
}> {
  log('Enabling VAD...');
  const ortRuntime = await getOnnxRuntime();
  const silero = await get_silero_session();

  const vad = new TSVAD({
    silero,
    ort: ortRuntime,
    onSpeechStart: options.onSpeechStart,
    onSpeechEnd: options.onSpeechEnd,
    onFrameProcessed: options.onFrameProcessed,
    onError: options.onError,
    positiveSpeechThreshold: options.positiveSpeechThreshold ?? 0.8,
    negativeSpeechThreshold: options.negativeSpeechThreshold ?? 0.6,
    redemptionMs: options.redemptionMs ?? 1400,
    preSpeechPadMs: options.preSpeechPadMs ?? 1000,
    minSpeechStartMs: options.minSpeechStartMs ?? 150,
  });

  await vad.start();

  // Get audio components from VAD
  const audioContext = vad.getAudioContext();
  const analyserNode = vad.getAnalyserNode();
  const stream = vad.getStream();

  if (!audioContext || !analyserNode || !stream) {
    throw new Error('Failed to initialize VAD audio pipeline');
  }

  log('VAD enabled and started');
  return { vad, audioContext, analyserNode, stream };
}

export { TSVAD };
