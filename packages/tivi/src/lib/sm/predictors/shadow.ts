/**
 * Shadow predictor — wraps another predictor to record its decisions
 * without gating on them.
 *
 * The SM treats every shadow decision as INCOMPLETE (never commits early),
 * so semantic endpointing has zero user-visible effect while shadow mode
 * is active. The wrapped predictor's decisions are reported via
 * onPredictorDecision for telemetry analysis.
 *
 * Deploy this in Phase 2 for a week to collect real-conversation data
 * before flipping to the real predictor in Phase 3.
 */

import type { EndpointPredictor, PredictorDecision, PredictorWarmup } from '../types';

export function createShadowPredictor(inner: EndpointPredictor): EndpointPredictor {
  return {
    async warmup(): Promise<PredictorWarmup> {
      return inner.warmup();
    },
    async predict(audio: Float32Array, signal?: AbortSignal): Promise<PredictorDecision> {
      const raw = await inner.predict(audio, signal);
      return { ...raw, shadow: true };
    },
  };
}
