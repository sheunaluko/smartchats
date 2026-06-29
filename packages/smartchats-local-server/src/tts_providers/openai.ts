/**
 * OpenAI TTS adapter — thin wrapper around llm-service's openaiTtsStream
 * so the registry has a uniform shape across providers. No behavior change
 * from the original direct-call path in routes/llm.ts.
 *
 * Locked to `gpt-4o-mini-tts` (the existing production model). If we want
 * to expose `gpt-4o-tts` (HD) later, add a `model` field to TtsStreamOpts
 * or build a parallel adapter.
 */

import OpenAI from 'openai';
import {
    openaiTtsStream,
    countGpt4oMiniTtsInputTokens,
} from 'llm-service';
import { estimateGpt4oMiniTtsCost, GPT4O_MINI_TTS_PRICING } from 'cortex';

import type {
    ServerTtsAdapter, TtsStreamOpts, TtsCostOpts, TtsCostEstimate,
} from './_types.js';

const VOICES = [
    'alloy', 'ash', 'ballad', 'coral', 'echo',
    'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse',
];

export class OpenAiTtsAdapter implements ServerTtsAdapter {
    readonly name = 'openai';
    private client: OpenAI;

    constructor(private readonly apiKey: string) {
        if (!apiKey) throw new Error('OpenAiTtsAdapter requires apiKey');
        this.client = new OpenAI({ apiKey });
    }

    async *stream(opts: TtsStreamOpts): AsyncIterable<Buffer> {
        for await (const pcm of openaiTtsStream(this.client, {
            text: opts.text,
            voice: opts.voice,
            model: GPT4O_MINI_TTS_PRICING.model,
            speed: opts.speed ?? 1,
            ...(opts.instructions ? { instructions: opts.instructions } : {}),
        })) {
            yield pcm;
        }
    }

    estimateCost(opts: TtsCostOpts): TtsCostEstimate {
        const inputTokens = countGpt4oMiniTtsInputTokens(opts.text);
        const e = estimateGpt4oMiniTtsCost({
            inputTokens,
            outputPcmBytes: opts.outputBytes,
        });
        return {
            usd: e.costUsd,
            unit: 'tokens',
            quantity: inputTokens + e.outputTokens,
        };
    }

    listVoices(): string[] { return VOICES; }
}
