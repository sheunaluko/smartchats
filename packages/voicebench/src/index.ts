export type {
    ConnectOpts, StreamOpts, BatchYieldEvent,
    TtsConnection, TtsProvider, CostEstimate,
} from './providers/_types.js';

export { OpenAITtsProvider } from './providers/openai.js';

export type { BatchTiming, TrialMeasurement, AggregateStats } from './metrics/timing.js';
export { aggregate, deriveStatsFromBatches } from './metrics/timing.js';

export type { Scenario } from './scenarios/index.js';
export { SCENARIOS, listScenarios } from './scenarios/index.js';

export { runScenario } from './runner.js';
export type { RunOptions } from './runner.js';

export { reportTrials, reportAggregate } from './reporter.js';
