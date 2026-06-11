/**
 * Greeting template catalog — 15 variants, balanced across time buckets.
 *
 * Each template has TWO forms: `with_name` and `without_name`. The selector
 * fills `{name}` when a name is available, otherwise falls back to the
 * no-name form. There is no "needs a name to function" template — every
 * row degrades gracefully.
 *
 * Distribution:
 *   morning   × 3
 *   afternoon × 3
 *   evening   × 3
 *   night     × 3
 *   neutral   × 3   (time-agnostic; safe fallbacks if hour is unavailable)
 *
 * Adding a variant: append to the matching bucket array, give it a unique
 * `id` (the bucket prefix is convention not requirement), and provide
 * both with/without-name forms. The selector picks variants uniformly at
 * random within the chosen bucket, excluding the last few `id`s spoken
 * (caller-supplied).
 */

import type { TimeBucket } from './time_bucket';

export interface GreetingTemplate {
    id: string;
    /** Uses `{name}` placeholder, e.g. "Good morning, {name}." */
    with_name: string;
    /** Standalone, no placeholder. */
    without_name: string;
}

export const TEMPLATES: Record<TimeBucket, GreetingTemplate[]> = {
    morning: [
        { id: 'morning_1', with_name: 'Good morning {name}, what can I help with?',           without_name: 'Good morning, what can I help with?' },
        { id: 'morning_2', with_name: 'Morning {name}. Where do you want to start?',           without_name: 'Morning. Where do you want to start?' },
        { id: 'morning_3', with_name: 'Hi {name}, hope your morning is going well — what\'s up?', without_name: 'Hi, hope your morning is going well — what\'s up?' },
    ],
    afternoon: [
        { id: 'afternoon_1', with_name: 'Good afternoon {name}, what can I do for you?',       without_name: 'Good afternoon, what can I do for you?' },
        { id: 'afternoon_2', with_name: 'Hey {name}, what\'s on your mind?',                   without_name: 'Hey, what\'s on your mind?' },
        { id: 'afternoon_3', with_name: 'Hi {name}, how can I help this afternoon?',           without_name: 'Hi, how can I help this afternoon?' },
    ],
    evening: [
        { id: 'evening_1',  with_name: 'Good evening {name}, what would you like to do?',     without_name: 'Good evening, what would you like to do?' },
        { id: 'evening_2',  with_name: 'Hi {name}, how was your day?',                        without_name: 'Hi, how can I help this evening?' },
        { id: 'evening_3',  with_name: 'Evening {name}. Where should we start?',              without_name: 'Evening. Where should we start?' },
    ],
    night: [
        { id: 'night_1',    with_name: 'Hi {name}, up late — what do you need?',              without_name: 'Hi, what can I help with?' },
        { id: 'night_2',    with_name: 'Hey {name}, what\'s on your mind tonight?',           without_name: 'Hey, what\'s on your mind?' },
        { id: 'night_3',    with_name: 'Hi {name}, how can I help?',                          without_name: 'Hi, how can I help?' },
    ],
    neutral: [
        { id: 'neutral_1',  with_name: 'Hi {name}, what can I help with?',                    without_name: 'Hi, what can I help with?' },
        { id: 'neutral_2',  with_name: 'Hey {name}, what\'s going on?',                       without_name: 'Hey, what\'s going on?' },
        { id: 'neutral_3',  with_name: 'Hi {name}. Where do you want to start?',              without_name: 'Hi. Where do you want to start?' },
    ],
};
