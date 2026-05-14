'use client';

import { useRef, useCallback, useMemo } from 'react';
import { useSmartChatsStore } from '../store/useSmartChatsStore';

/**
 * useStreamBuffers — Manages throttled streaming buffer updates for chat, thoughts, and stream viewer.
 *
 * Three parallel buffering systems that throttle high-frequency streaming events into batched UI updates:
 * 1. Response buffer — 100ms throttle for response_chunk → chatHistory
 * 2. Thought buffer — 100ms throttle for thought_chunk → thoughtHistory
 * 3. Stream buffer — 200ms throttle for stream_chunk → streamChunks (debug viewer)
 */

export interface StreamBuffers {
    /** Feed a response chunk — accumulate + throttled flush to chat */
    feedResponseChunk: (chunk: string) => void;
    /** Feed a thought chunk — accumulate + throttled flush to thoughts */
    feedThoughtChunk: (chunk: string) => void;
    /** Feed a stream chunk — accumulate + throttled flush to stream viewer */
    feedStreamChunk: (chunk: string) => void;
    /** Clear response timers, set final chat content */
    finalizeResponse: (fullResponse: string) => void;
    /** Flush remaining thought buffer, clear streaming marker */
    finalizeThoughts: () => void;
    /** Flush + end stream viewer */
    finalizeStream: (remaining?: string) => void;
    /** Clear all buffers for new interaction */
    resetStreaming: () => void;
    /** Whether we've created the streaming assistant message entry */
    streamingAssistantMsg: React.MutableRefObject<boolean>;
    /** Create the first assistant message entry (called on first response_chunk) */
    createStreamingMessage: (firstChunk: string) => void;
    /** Ref holding accumulated raw stream text (for UI effects, never cleared except on reset) */
    rawStreamRef: React.MutableRefObject<string>;
}

export function useStreamBuffers(): StreamBuffers {
    // Response buffering
    const responseChunkBuffer = useRef('');
    const responseFlushTimer = useRef<any>(null);
    const streamingAssistantMsg = useRef(false);

    // Thought buffering
    const thoughtChunkBuffer = useRef('');
    const thoughtFlushTimer = useRef<any>(null);

    // Stream viewer buffering
    const streamChunkBuffer = useRef('');
    const streamFlushTimer = useRef<any>(null);

    // Raw accumulated stream text (for UI effects like the title underline)
    const rawStreamRef = useRef('');

    const flushResponseBuffer = useCallback(() => {
        responseFlushTimer.current = null;
        const buffered = responseChunkBuffer.current;
        if (!buffered) return;
        responseChunkBuffer.current = '';
        const state = useSmartChatsStore.getState();
        const history = state.chatHistory;
        if (history.length > 0 && history[history.length - 1].role === 'assistant') {
            const updated = [...history];
            updated[updated.length - 1] = { role: 'assistant', content: updated[updated.length - 1].content + buffered };
            useSmartChatsStore.setState({ chatHistory: updated });
        }
    }, []);

    const flushThoughtBuffer = useCallback(() => {
        thoughtFlushTimer.current = null;
        const buffered = thoughtChunkBuffer.current;
        if (!buffered) return;
        thoughtChunkBuffer.current = '';
        const state = useSmartChatsStore.getState();
        const history = state.thoughtHistory;
        if (history.length > 0 && history[history.length - 1].startsWith('⏳')) {
            const updated = [...history];
            updated[updated.length - 1] += buffered;
            useSmartChatsStore.setState({ thoughtHistory: updated });
        } else {
            useSmartChatsStore.setState({ thoughtHistory: [...history, '⏳' + buffered] });
        }
    }, []);

    const flushStreamBuffer = useCallback(() => {
        streamFlushTimer.current = null;
        const buffered = streamChunkBuffer.current;
        if (!buffered) return;
        streamChunkBuffer.current = '';
        useSmartChatsStore.getState().handleStreamChunk({ chunk: buffered });
    }, []);

    const createStreamingMessage = useCallback((firstChunk: string) => {
        streamingAssistantMsg.current = true;
        const state = useSmartChatsStore.getState();
        const history = state.chatHistory;
        useSmartChatsStore.setState({ chatHistory: [...history, { role: 'assistant', content: firstChunk }] });
    }, []);

    const feedResponseChunk = useCallback((chunk: string) => {
        if (!streamingAssistantMsg.current) {
            createStreamingMessage(chunk);
        } else {
            responseChunkBuffer.current += chunk;
            if (!responseFlushTimer.current) {
                responseFlushTimer.current = setTimeout(flushResponseBuffer, 100);
            }
        }
    }, [flushResponseBuffer, createStreamingMessage]);

    const feedThoughtChunk = useCallback((chunk: string) => {
        thoughtChunkBuffer.current += chunk;
        if (!thoughtFlushTimer.current) {
            thoughtFlushTimer.current = setTimeout(flushThoughtBuffer, 100);
        }
    }, [flushThoughtBuffer]);

    const feedStreamChunk = useCallback((chunk: string) => {
        streamChunkBuffer.current += chunk;
        rawStreamRef.current += chunk;
        if (!streamFlushTimer.current) {
            streamFlushTimer.current = setTimeout(flushStreamBuffer, 200);
        }
    }, [flushStreamBuffer]);

    const finalizeResponse = useCallback((fullResponse: string) => {
        streamingAssistantMsg.current = false;
        if (responseFlushTimer.current) {
            clearTimeout(responseFlushTimer.current);
            responseFlushTimer.current = null;
        }
        responseChunkBuffer.current = '';
        // Set final chat content
        const state = useSmartChatsStore.getState();
        const history = state.chatHistory;
        if (history.length > 0 && history[history.length - 1].role === 'assistant') {
            const updated = [...history];
            updated[updated.length - 1] = { role: 'assistant', content: fullResponse };
            useSmartChatsStore.setState({ chatHistory: updated, lastAiMessage: fullResponse });
        }
    }, []);

    const finalizeThoughts = useCallback(() => {
        if (thoughtFlushTimer.current) {
            clearTimeout(thoughtFlushTimer.current);
            thoughtFlushTimer.current = null;
        }
        thoughtChunkBuffer.current = '';
    }, []);

    const finalizeStream = useCallback((remaining?: string) => {
        if (streamFlushTimer.current) {
            clearTimeout(streamFlushTimer.current);
            streamFlushTimer.current = null;
        }
        const buffered = streamChunkBuffer.current;
        streamChunkBuffer.current = '';
        if (buffered) useSmartChatsStore.getState().handleStreamChunk({ chunk: buffered });
        if (remaining) useSmartChatsStore.getState().handleStreamChunk({ chunk: remaining });
        useSmartChatsStore.getState().handleStreamEnd({});
    }, []);

    const resetStreaming = useCallback(() => {
        streamingAssistantMsg.current = false;
        responseChunkBuffer.current = '';
        thoughtChunkBuffer.current = '';
        streamChunkBuffer.current = '';
        rawStreamRef.current = '';
        if (responseFlushTimer.current) { clearTimeout(responseFlushTimer.current); responseFlushTimer.current = null; }
        if (thoughtFlushTimer.current) { clearTimeout(thoughtFlushTimer.current); thoughtFlushTimer.current = null; }
        if (streamFlushTimer.current) { clearTimeout(streamFlushTimer.current); streamFlushTimer.current = null; }
    }, []);

    return useMemo(() => ({
        feedResponseChunk,
        feedThoughtChunk,
        feedStreamChunk,
        finalizeResponse,
        finalizeThoughts,
        finalizeStream,
        resetStreaming,
        streamingAssistantMsg,
        createStreamingMessage,
        rawStreamRef,
    }), [feedResponseChunk, feedThoughtChunk, feedStreamChunk, finalizeResponse, finalizeThoughts, finalizeStream, resetStreaming, createStreamingMessage]);
}
