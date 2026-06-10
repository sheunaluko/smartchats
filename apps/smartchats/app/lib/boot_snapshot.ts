/**
 * Boot + session-start snapshot — module-level, non-reactive timing state
 * shared across boot useEffects (app3.tsx), the Start-click handler
 * (useOrchestrator), and the LLM driver (useSmartChatsStore).
 *
 * Why a shared module instead of the Zustand store: this is pure
 * bookkeeping — no UI ever subscribes to it — and several writers
 * (warmup probes, click handler, runLlm) need to compare against the
 * same wall-clock baseline without round-tripping through a reactive
 * store and tripping action-emit instrumentation.
 */

export interface BootProbeResult {
  ok: boolean;
  duration_ms: number;
  error?: string;
  cached?: boolean;
}

interface BootSnapshot {
  bootStartTime: number;
  bootCompleteTime: number | null;
  app3MountedTime: number | null;
  runner: BootProbeResult | null;
  tts: BootProbeResult | null;
  vad: BootProbeResult | null;
  prefetch: BootProbeResult | null;
  /** Click T0 of the most recent voice_session_start, or null between sessions. */
  voiceSessionStartTime: number | null;
  /** True when the current voice session began cold (any probe missing/failed). */
  voiceSessionCold: boolean;
}

const snapshot: BootSnapshot = {
  bootStartTime: typeof performance !== 'undefined' ? performance.now() : 0,
  bootCompleteTime: null,
  app3MountedTime: null,
  runner: null,
  tts: null,
  vad: null,
  prefetch: null,
  voiceSessionStartTime: null,
  voiceSessionCold: false,
};

export function markApp3Mounted(): void {
  if (snapshot.app3MountedTime === null) {
    snapshot.app3MountedTime = performance.now();
  }
}

export function recordProbe(
  name: 'runner' | 'tts' | 'vad' | 'prefetch',
  result: BootProbeResult,
): void {
  snapshot[name] = result;
}

export function markBootComplete(): void {
  if (snapshot.bootCompleteTime === null) {
    snapshot.bootCompleteTime = performance.now();
  }
}

export function getBootSnapshot(): Readonly<BootSnapshot> {
  return snapshot;
}

/**
 * True at click time if any warmup probe is missing, not-ok, or boot
 * hasn't yet completed. The single source of truth for the `cold_start`
 * flag stamped on every Start-flow event.
 */
export function isColdStart(): boolean {
  if (snapshot.bootCompleteTime === null) return true;
  return (
    !snapshot.runner?.ok ||
    !snapshot.tts?.ok ||
    !snapshot.vad?.ok ||
    !snapshot.prefetch?.ok
  );
}

export function getTimeSinceBootStart(): number {
  return Math.round(performance.now() - snapshot.bootStartTime);
}

export function getTimeSinceBootComplete(): number | null {
  if (snapshot.bootCompleteTime === null) return null;
  return Math.round(performance.now() - snapshot.bootCompleteTime);
}

/**
 * Called by useOrchestrator when the user clicks Start, before any
 * awaited work. Lets downstream emitters (e.g. runLlm in the store)
 * compute `duration_ms` against the click without needing to plumb
 * a ref through React props.
 */
export function markVoiceSessionStart(cold: boolean): void {
  snapshot.voiceSessionStartTime = performance.now();
  snapshot.voiceSessionCold = cold;
}

export function clearVoiceSessionStart(): void {
  snapshot.voiceSessionStartTime = null;
  snapshot.voiceSessionCold = false;
}

export function getVoiceSessionT0(): number | null {
  return snapshot.voiceSessionStartTime;
}

export function isVoiceSessionCold(): boolean {
  return snapshot.voiceSessionCold;
}

export function getTimeSinceVoiceSessionStart(): number | null {
  if (snapshot.voiceSessionStartTime === null) return null;
  return Math.round(performance.now() - snapshot.voiceSessionStartTime);
}
