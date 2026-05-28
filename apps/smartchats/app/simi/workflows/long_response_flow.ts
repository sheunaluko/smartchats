import { defineWorkflow } from 'simi';

/**
 * long_response_flow — companion to basic_chat_flow that explicitly asks
 * for a long, multi-paragraph response. Used by /sail's ExperimentRunner
 * to reproduce the first-chunk audio-glitch conditions that short
 * responses don't surface.
 *
 * The bug pattern (per 2026-05-27 diagnosis): server-side HTTP response
 * buffering causes `audio_start` and the first audio chunk to bundle
 * into the same network flush when the LLM response is short. With a
 * longer response, intervening text-event flushes push `audio_start`
 * to the client ahead of the audio chunks, exposing the ~700ms encoder
 * warmup gap that causes the chunk-0 snap-forward → audible glitch.
 *
 * Spends more LLM/TTS budget than basic_chat_flow (~3-5× more tokens
 * + ~30-60s of TTS audio). Use sparingly.
 */
export const longResponseFlow = defineWorkflow({
  id: 'long_response_flow',
  app: 'smartchats',
  tags: ['chat', 'audio', 'long'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    { waitFor: 'state.aiModel !== "" && state.agent !== null', timeout: 10000 },
    // Prompt designed to force a long, multi-paragraph response.
    // Length controls the server's HTTP-flush cadence, which is what
    // exposes the audio_start/first-chunk timing race.
    {
      action: 'sendMessageAsync',
      args: ['Tell me a four-paragraph story about a curious octopus exploring a coral reef. Be descriptive and use vivid language. At least 200 words.'],
      timeout: 90_000,
      wait: 500,
    },
    { assert: 'state.chatHistory.length >= 2', message: 'Chat should have user + assistant messages' },
    { assert: 'state.lastAiMessage.length > 200', message: 'AI response should be at least 200 chars (long-response test)' },
  ],
});
