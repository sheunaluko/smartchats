'use client';

import { useRef, useCallback, useMemo } from 'react';

/**
 * usePipelineTelemetry — Manages pipeline timestamp tracking and voice interaction telemetry.
 *
 * Owns the `pipelineTs` bag of timestamps that track every stage of a voice interaction:
 * transcription_received, llm_call_start, first_ack_received, first_response_chunk,
 * response_complete, first_tts_utterance, tts_queue_drain, llm_call_end, etc.
 *
 * Consolidates the two duplicate voice_interaction_complete emission blocks
 * (previously in onQueueDrain and add_ai_message) into a single emitVoiceComplete.
 */

export interface PipelineTimestamps {
    [key: string]: number;
}

export interface PipelineTelemetry {
    stamp: (key: string) => void;
    stampFirst: (key: string) => void;
    resetTimestamps: (initial?: PipelineTimestamps) => void;
    getTimestamps: () => PipelineTimestamps;
    emitVoiceComplete: (opts: {
        insightsClient: any;
        runnerMode: string;
        responseLength: number;
        mode: string;
        ttsPipeline?: string;
    }) => void;
    pipelineTs: React.MutableRefObject<PipelineTimestamps>;
}

export function usePipelineTelemetry(): PipelineTelemetry {
    const pipelineTs = useRef<PipelineTimestamps>({});

    const stamp = useCallback((key: string) => {
        pipelineTs.current[key] = Date.now();
    }, []);

    const stampFirst = useCallback((key: string) => {
        if (!pipelineTs.current[key]) {
            pipelineTs.current[key] = Date.now();
        }
    }, []);

    const resetTimestamps = useCallback((initial?: PipelineTimestamps) => {
        pipelineTs.current = initial ? { ...initial } : {};
    }, []);

    const getTimestamps = useCallback(() => {
        return { ...pipelineTs.current };
    }, []);

    const emitVoiceComplete = useCallback((opts: {
        insightsClient: any;
        runnerMode: string;
        responseLength: number;
        mode: string;
        ttsPipeline?: string;
    }) => {
        const { insightsClient, runnerMode, responseLength, mode, ttsPipeline } = opts;
        const ts = pipelineTs.current;
        const turnStart = ts.transcription_received || ts.user_message_sent;

        if (!insightsClient || !turnStart) return;

        insightsClient.addEvent('voice_interaction_complete', {
            runner_mode: runnerMode,
            timestamps: { ...ts },
            durations: {
                transcription_to_llm_start: ts.llm_call_start ? ts.llm_call_start - turnStart : null,
                llm_round_trip: ts.llm_call_end && ts.llm_call_start ? ts.llm_call_end - ts.llm_call_start : null,
                first_ack_latency: ts.first_ack_received && ts.llm_call_start ? ts.first_ack_received - ts.llm_call_start : null,
                first_response_latency: ts.first_response_chunk && ts.llm_call_start ? ts.first_response_chunk - ts.llm_call_start : null,
                response_streaming_duration: ts.response_complete && ts.first_response_chunk ? ts.response_complete - ts.first_response_chunk : null,
                text_to_first_speech: ts.first_tts_utterance && ts.first_response_chunk ? ts.first_tts_utterance - ts.first_response_chunk : null,
                tts_total_duration: ts.tts_queue_drain && ts.first_tts_utterance ? ts.tts_queue_drain - ts.first_tts_utterance : null,
                tts_generation: ts.tts_end && ts.tts_start ? ts.tts_end - ts.tts_start : null,
                end_to_end: (ts.tts_queue_drain || ts.tts_end || Date.now()) - turnStart,
                end_to_end_with_speech: ts.tts_queue_drain ? ts.tts_queue_drain - turnStart : null,
            },
            response_length: responseLength,
            mode: ts.transcription_received ? 'voice' : mode,
            tts_pipeline: ttsPipeline || 'separate',
        }, { tags: ['latency', 'pipeline'] }).catch(() => {});
    }, []);

    return useMemo(() => ({
        stamp,
        stampFirst,
        resetTimestamps,
        getTimestamps,
        emitVoiceComplete,
        pipelineTs,
    }), [stamp, stampFirst, resetTimestamps, getTimestamps, emitVoiceComplete, pipelineTs]);
}
