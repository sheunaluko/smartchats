/**
 * TTS call functions that tivi consumes (`ttsCallFn` + `ttsStreamCallFn`),
 * built on top of SmartChatsBackend. Preserves tivi's existing `(text, voice, model, speed)`
 * signature — the `model` arg is ignored since the backend locks to `gpt-4o-mini-tts`.
 */

'use client';

import { getBackend } from './backend';

// ─── Helpers ──────────────────────────────────────────────────────

function pcmToFloat32(pcm: ArrayBuffer): Float32Array {
    const numSamples = pcm.byteLength / 2;
    const view = new DataView(pcm);
    const out = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        out[i] = view.getInt16(i * 2, true) / 32768;
    }
    return out;
}

// ─── Streaming variant (ttsStreamCallFn) ──────────────────────────

export async function backendTtsStreamFn(
    text: string,
    voice: string,
    _model: string,
    speed?: number,
): Promise<{ stream: AsyncIterable<Float32Array>; done: Promise<void> }> {
    const startTs = Date.now();
    const insights = (typeof window !== 'undefined' ? (window as any).cortexInsights : null);
    insights?.addEvent?.('tts_stream_start', {
        text: text.slice(0, 80), text_length: text.length, voice, transport: 'http', ts: startTs,
    }).catch(() => {});

    const result = await getBackend().tts.stream({ text, voice, speed });
    let firstChunkEmitted = false;
    let chunkCount = 0;

    const stream: AsyncIterable<Float32Array> = {
        async *[Symbol.asyncIterator]() {
            for await (const chunk of result.stream) {
                chunkCount++;
                const float32 = pcmToFloat32(chunk.pcm);
                if (!firstChunkEmitted) {
                    firstChunkEmitted = true;
                    insights?.addEvent?.('tts_stream_first_chunk', {
                        text: text.slice(0, 80),
                        latency_ms: Date.now() - startTs,
                        chunk_samples: float32.length,
                        transport: 'http',
                    }).catch(() => {});
                }
                yield float32;
            }
        },
    };

    const done = result.done.then((info) => {
        insights?.addEvent?.('tts_stream_complete', {
            text: text.slice(0, 80),
            total_ms: Date.now() - startTs,
            total_chunks: chunkCount,
            voice,
            transport: 'http',
        }).catch(() => {});
        if (info.billing && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('smartchats:billing_update', { detail: info.billing }));
        }
    });

    return { stream, done };
}

// ─── Collect-then-play variant (ttsCallFn) ────────────────────────

export async function backendTtsCallFn(
    text: string,
    voice: string,
    model: string,
    speed?: number,
): Promise<AudioBuffer> {
    const { stream, done } = await backendTtsStreamFn(text, voice, model, speed);

    const chunks: Float32Array[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    await done;

    const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
    const allSamples = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
        allSamples.set(chunk, offset);
        offset += chunk.length;
    }

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = ctx.createBuffer(1, totalSamples, 24000);
    audioBuffer.getChannelData(0).set(allSamples);
    return audioBuffer;
}

// ─── Warmup ──────────────────────────────────────────────────────

/** Best-effort warmup — delegates to backend's per-endpoint warm probe. */
export async function warmupBackendTts(): Promise<void> {
    await getBackend().tts.warmup?.();
}
