/**
 * LLM trial runner.
 *
 * Wraps llm-service's handleLLMStreamRequest to measure:
 *   - TTFB: ms from call to first text token yielded
 *   - total_response_ms: ms from call to last token
 *   - output_tokens: number of tokens generated
 *   - estimated_cost_usd: input + output tokens × per-model rates
 *
 * Cold vs warm: the runner does ONE cold trial first (forced unique
 * suffix to break any prompt-cache), then N warm trials (identical
 * prompt to exercise the cache). Anthropic + OpenAI both auto-cache
 * frequent prefixes; the warm column reflects production-typical
 * latency, the cold column is the worst case.
 */

import { handleLLMStreamRequest, type LLMStreamRequest } from 'llm-service';
import { getModelInfo, getCachedInputPrice } from 'cortex';
import type { Scenario } from './scenarios/index.js';

export interface TrialMeasurement {
    provider: string;
    modelKey: string;
    scenarioId: string;
    trialIndex: number;
    /** 'cold' = first trial w/ unique suffix to defeat prompt cache; 'warm' = subsequent identical-prompt trials. */
    cacheClass: 'cold' | 'warm';
    /** ms from stream call to first text delta. */
    timeToFirstByteMs: number | null;
    /** ms from stream call to last text delta. */
    totalResponseMs: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    estimatedCostUsd: number;
    error?: string;
}

export interface RunOptions {
    modelKey: string;        // key in MODEL_REGISTRY (e.g. 'grok-4.3', 'claude-opus-4-7')
    scenario: Scenario;
    coldTrials: number;      // typically 1
    warmTrials: number;      // typically 4
    interTrialMs?: number;
}

function estimateCost(modelKey: string, inputTokens: number, outputTokens: number, cachedInputTokens: number): number {
    const info = getModelInfo(modelKey);
    const cachedPrice = getCachedInputPrice(info);
    const uncachedInput = Math.max(0, inputTokens - cachedInputTokens);
    return (
        (uncachedInput * info.inputPricePer1M) / 1_000_000 +
        (cachedInputTokens * cachedPrice) / 1_000_000 +
        (outputTokens * info.outputPricePer1M) / 1_000_000
    );
}

async function runOneTrial(opts: {
    modelKey: string;
    scenario: Scenario;
    trialIndex: number;
    cacheClass: 'cold' | 'warm';
    uniqueSuffix?: string;
}): Promise<TrialMeasurement> {
    const info = getModelInfo(opts.modelKey);
    const userPrompt = opts.uniqueSuffix
        ? `${opts.scenario.userPrompt} ${opts.uniqueSuffix}`
        : opts.scenario.userPrompt;

    const request: LLMStreamRequest = {
        model: info.id,
        input: [
            { role: 'system', content: opts.scenario.systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        // 5x cap floor: reasoning models (GPT-5, Grok-4) consume internal
        // chain-of-thought tokens against this budget BEFORE emitting any
        // visible text. Too tight → response.incomplete max_output_tokens
        // crash. 5x is generous enough for any of our scenarios.
        max_tokens: Math.min(opts.scenario.targetOutputTokens * 5, info.maxOutputTokens),
        // No temperature: GPT-5 family rejects any value other than the default
        // ("invalid_request_error: temperature"). Omitting it lets every
        // provider use its own default, which is what we want for a
        // latency-not-quality benchmark.
    };

    const t0 = Date.now();
    let firstByteMs: number | null = null;

    try {
        const stream = handleLLMStreamRequest(request);
        let firstTokenSeen = false;
        for await (const _delta of stream.stream) {
            if (!firstTokenSeen) {
                firstTokenSeen = true;
                firstByteMs = Date.now() - t0;
            }
        }
        const totalResponseMs = Date.now() - t0;
        const aggregated = await stream.aggregated;

        const cost = estimateCost(
            opts.modelKey,
            aggregated.usage.input_tokens,
            aggregated.usage.output_tokens,
            aggregated.usage.cached_input_tokens ?? 0,
        );

        return {
            provider: info.provider,
            modelKey: opts.modelKey,
            scenarioId: opts.scenario.id,
            trialIndex: opts.trialIndex,
            cacheClass: opts.cacheClass,
            timeToFirstByteMs: firstByteMs,
            totalResponseMs,
            inputTokens: aggregated.usage.input_tokens,
            outputTokens: aggregated.usage.output_tokens,
            cachedInputTokens: aggregated.usage.cached_input_tokens ?? 0,
            estimatedCostUsd: cost,
        };
    } catch (err) {
        return {
            provider: info.provider,
            modelKey: opts.modelKey,
            scenarioId: opts.scenario.id,
            trialIndex: opts.trialIndex,
            cacheClass: opts.cacheClass,
            timeToFirstByteMs: firstByteMs,
            totalResponseMs: Date.now() - t0,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            estimatedCostUsd: 0,
            error: (err as Error).message,
        };
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

export async function runScenario(opts: RunOptions): Promise<TrialMeasurement[]> {
    const results: TrialMeasurement[] = [];
    const interTrialMs = opts.interTrialMs ?? 500;
    let trialIndex = 0;

    // Cold trials — each gets a unique nonce suffix to break prompt cache.
    for (let i = 0; i < opts.coldTrials; i++) {
        if (trialIndex > 0) await sleep(interTrialMs);
        const nonce = `[nonce:${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
        results.push(await runOneTrial({
            modelKey: opts.modelKey, scenario: opts.scenario, trialIndex,
            cacheClass: 'cold', uniqueSuffix: nonce,
        }));
        trialIndex++;
    }

    // Warm trials — identical prompt, repeat hits cache.
    for (let i = 0; i < opts.warmTrials; i++) {
        if (trialIndex > 0) await sleep(interTrialMs);
        results.push(await runOneTrial({
            modelKey: opts.modelKey, scenario: opts.scenario, trialIndex,
            cacheClass: 'warm',
        }));
        trialIndex++;
    }

    return results;
}
