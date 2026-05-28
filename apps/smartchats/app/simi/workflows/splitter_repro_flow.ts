import { defineWorkflow } from 'simi';

/**
 * splitter_repro_flow — controlled-length response specifically designed to
 * reproduce the chunk-0 audio-glitch hypothesis on the server.
 *
 * The bug fires when the server's ResponseSplitter triggers an early TTS
 * call mid-stream (default threshold: 8 words at next sentence boundary).
 * That first TTS call hits cold OpenAI encoder (~700-1500ms first byte),
 * but meanwhile the LLM keeps streaming text events that flush the HTTP
 * response buffer regularly. Result: audio_start arrives at the client
 * BEFORE the first audio chunk, exposing the encoder warmup as a visible
 * chunk-0 arrival latency → snap-forward → audible glitch.
 *
 * basic_chat_flow can't reproduce this — its 1-3 word responses never
 * cross the splitter threshold, so only one TTS call fires (the
 * remainder) and the server buffers audio_start+first-chunk together.
 *
 * long_response_flow rarely reproduces it — the LLM doesn't deterministically
 * produce >8 words before a sentence boundary at the right cadence.
 *
 * This workflow asks the LLM to produce EXACTLY two sentences with
 * explicit minimum word counts. First sentence >=15 words guarantees
 * splitter fires (8-word threshold + sentence boundary). Second sentence
 * >=25 words ensures continued text-event streaming during the TTS wait,
 * which keeps the response buffer flushing — pushing audio_start out
 * ahead of the first audio chunk.
 */
export const splitterReproFlow = defineWorkflow({
  id: 'splitter_repro_flow',
  app: 'smartchats',
  tags: ['chat', 'audio', 'long', 'splitter_repro'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    { waitFor: 'state.aiModel !== "" && state.agent !== null', timeout: 10000 },
    {
      action: 'sendMessageAsync',
      args: [
        'Respond with exactly two sentences. ' +
        'The first sentence should describe morning in a forest, and must be at least fifteen words long. ' +
        'The second sentence should describe evening by a river, and must be at least twenty-five words long. ' +
        'No introduction, no conclusion, no list — just the two complete sentences with periods.',
      ],
      timeout: 90_000,
      wait: 500,
    },
    { assert: 'state.chatHistory.length >= 2', message: 'Chat should have user + assistant messages' },
    { assert: 'state.lastAiMessage.length > 150', message: 'AI response should be substantial (≥150 chars covers ~25+ words)' },
  ],
});
