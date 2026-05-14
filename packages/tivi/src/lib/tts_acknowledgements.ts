/**
 * TTS Acknowledgements
 *
 * Static MP3 cache for conversational fillers, organized per voice.
 * Uses fetch() from public/audio/acks/{voice}/ — no credits burned.
 *
 * 37 acknowledgement types covering:
 * - Quick confirms (sure, ok, got_it, alright, right, yeah, of_course)
 * - Thinking/processing (hmm, lets_see, lets_think_about_that, interesting, good_question)
 * - Buying time (one_moment, give_me_a_second, let_me_check, let_me_look_into_that)
 * - Soft transitions (so, well, absolutely, no_problem)
 * - Conversational fillers (mmhm)
 * - Greetings (hey, hi, hello, hey_there)
 * - Empathy (i_understand, sorry_to_hear_that, that_makes_sense)
 * - Enthusiasm (great, awesome, nice, love_it, thats_exciting)
 * - Affirmative action (on_it, will_do, you_got_it, happy_to_help)
 */

export const ACK_TYPES = [
  // Quick confirms
  'sure',
  'ok',
  'got_it',
  'alright',
  'right',
  'yeah',
  'of_course',
  // Thinking/processing
  'hmm',
  'lets_see',
  'lets_think_about_that',
  'interesting',
  'good_question',
  // Buying time (slightly longer)
  'one_moment',
  'give_me_a_second',
  'let_me_check',
  'let_me_look_into_that',
  // Soft transitions
  'so',
  'well',
  'absolutely',
  'no_problem',
  // Filler
  'mmhm',
  // Greetings
  'hey',
  'hi',
  'hello',
  'hey_there',
  // Empathy
  'i_understand',
  'sorry_to_hear_that',
  'that_makes_sense',
  // Enthusiasm
  'great',
  'awesome',
  'nice',
  'love_it',
  'thats_exciting',
  // Affirmative action
  'on_it',
  'will_do',
  'you_got_it',
  'happy_to_help',
] as const;

export type AckType = typeof ACK_TYPES[number];

export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const;
export type OpenAIVoice = typeof OPENAI_VOICES[number];

/**
 * Mapping from ack type to the spoken text for TTS generation.
 * Used by the generation script — not needed at runtime.
 */
export const ACK_SPOKEN_TEXT: Record<AckType, string> = {
  sure: 'Sure.',
  ok: 'Okay.',
  got_it: 'Got it.',
  alright: 'Alright.',
  right: 'Right.',
  yeah: 'Yeah.',
  of_course: 'Of course.',
  hmm: 'Hmm.',
  lets_see: "Let's see.",
  lets_think_about_that: "Let's think about that.",
  interesting: 'Interesting.',
  good_question: 'Good question.',
  one_moment: 'One moment.',
  give_me_a_second: 'Give me a second.',
  let_me_check: 'Let me check.',
  let_me_look_into_that: 'Let me look into that.',
  so: 'So.',
  well: 'Well.',
  absolutely: 'Absolutely.',
  no_problem: 'No problem.',
  mmhm: 'Mm-hmm.',
  // Greetings
  hey: 'Hey.',
  hi: 'Hi.',
  hello: 'Hello.',
  hey_there: 'Hey there.',
  // Empathy
  i_understand: 'I understand.',
  sorry_to_hear_that: "Sorry to hear that.",
  that_makes_sense: 'That makes sense.',
  // Enthusiasm
  great: 'Great.',
  awesome: 'Awesome.',
  nice: 'Nice.',
  love_it: 'Love it.',
  thats_exciting: "That's exciting.",
  // Affirmative action
  on_it: 'On it.',
  will_do: 'Will do.',
  you_got_it: 'You got it.',
  happy_to_help: 'Happy to help.',
};

// ─── Speed constants ──────────────────────────────────────────────

export const CACHED_SPEEDS = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5] as const;

/**
 * Round a speed value to 1 decimal place and return it if it matches a cached speed.
 * Returns null if the speed is outside the cached range.
 */
export function quantizeSpeed(speed: number): number | null {
  const rounded = Math.round(speed * 10) / 10;
  if (rounded < CACHED_SPEEDS[0] || rounded > CACHED_SPEEDS[CACHED_SPEEDS.length - 1]) return null;
  return rounded;
}

// ─── Reverse lookup: spoken text → ack type ───────────────────────

const spokenTextToAckType = new Map<string, AckType>();
for (const type of ACK_TYPES) {
  spokenTextToAckType.set(ACK_SPOKEN_TEXT[type].toLowerCase(), type);
}

// ─── Cache ────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
const cache = new Map<AckType, AudioBuffer>();
let loadedVoice: string | null = null;
let loadedSpeed: number | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

/**
 * Preload all acknowledgement MP3s for a specific voice and speed.
 * Path structure: {basePath}/{voice}/speed_{speed}/{type}.mp3
 * Re-fetches if voice or speed changed since last load.
 */
export async function preloadAcknowledgements(basePath: string, voice: string = 'nova', speed: number = 1.0): Promise<void> {
  const qSpeed = quantizeSpeed(speed) ?? 1.0;

  // Already loaded for this voice + speed
  if (loadedVoice === voice && loadedSpeed === qSpeed && cache.size > 0) return;

  // Voice or speed changed — clear old cache
  if (loadedVoice !== voice || loadedSpeed !== qSpeed) {
    cache.clear();
  }

  const ctx = getAudioContext();

  const promises = ACK_TYPES.map(async (type) => {
    try {
      const url = `${basePath}/${voice}/speed_${qSpeed}/${type}.mp3`;
      const response = await fetch(url);
      if (!response.ok) return;
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      cache.set(type, audioBuffer);
    } catch {
      // Skip failed loads silently
    }
  });

  await Promise.all(promises);
  if (cache.size > 0) {
    loadedVoice = voice;
    loadedSpeed = qSpeed;
  } else {
    loadedVoice = null;
    loadedSpeed = null;
  }
}

/**
 * Get a cached AudioBuffer for an acknowledgement type.
 * Returns null if not preloaded or type not found.
 */
export function getAckBuffer(type: AckType): AudioBuffer | null {
  return cache.get(type) ?? null;
}

/**
 * Get a cached AudioBuffer by text — matches against ack type names
 * (e.g., "sure") or spoken text (e.g., "Sure.") via reverse lookup.
 * Returns null if not in cache.
 */
export function getAckBufferByText(text: string): AudioBuffer | null {
  // Try as ack type name directly (e.g., "sure")
  const asType = text as AckType;
  if (cache.has(asType)) return cache.get(asType)!;

  // Try reverse lookup from spoken text (e.g., "Sure." → "sure")
  const matchedType = spokenTextToAckType.get(text.toLowerCase());
  if (matchedType && cache.has(matchedType)) return cache.get(matchedType)!;

  return null;
}

/**
 * The voice currently loaded in cache, or null.
 */
export function getLoadedVoice(): string | null {
  return loadedVoice;
}

/**
 * The speed currently loaded in cache, or null.
 */
export function getLoadedSpeed(): number | null {
  return loadedSpeed;
}

/**
 * Check if acknowledgements have been loaded.
 */
export function isAckCacheLoaded(): boolean {
  return loadedVoice !== null;
}

/**
 * Clear the acknowledgement cache.
 */
export function clearAckCache(): void {
  cache.clear();
  loadedVoice = null;
  loadedSpeed = null;
}
