export type {
    ConnectOpts, StreamOpts, BatchYieldEvent,
    TtsConnection, TtsProvider, CostEstimate,
} from './providers/_types.js';

export { OpenAITtsProvider } from './providers/openai.js';
export { GcpStreamingTtsProvider } from './providers/gcp_streaming.js';
export { XaiWsTtsProvider } from './providers/xai_ws.js';
export { GeminiLiveTtsProvider } from './providers/gemini_live.js';
export { GeminiTtsProvider } from './providers/gemini_tts.js';

export type { BatchTiming, TrialMeasurement, AggregateStats } from './metrics/timing.js';
export { aggregate, deriveStatsFromBatches } from './metrics/timing.js';

export type { Scenario } from './scenarios/index.js';
export { SCENARIOS, listScenarios } from './scenarios/index.js';

export { runScenario } from './runner.js';
export type { RunOptions } from './runner.js';

export { reportTrials, reportAggregate } from './reporter.js';
