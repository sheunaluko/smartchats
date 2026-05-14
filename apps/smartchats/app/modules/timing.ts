/**
 * Timing module — injects session timing + temporal awareness as trailing state via beforeBuild.
 *
 * The state refreshes on every build_messages() call (including each loop
 * iteration in multi-step execution), so the agent always sees current timing.
 *
 * Trailing state format:
 *   [Timing]
 *   Monday, March 31, 2026, 10:45 PM PDT (UTC-7) | session: 8m32s | time_since_last_speech: 4.1s | turns: 14
 */

import { useSmartChatsStore } from '../store/useSmartChatsStore';
import { getUserTimezone } from './system';

let sessionStartTs: number | null = null;
let turnCount = 0;
const tz = getUserTimezone();

function formatDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min < 60) return sec > 0 ? `${min}m${sec}s` : `${min}m`;
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    return remMin > 0 ? `${hr}h${remMin}m` : `${hr}h`;
}

export function createTimingModule() {
    sessionStartTs = Date.now();
    turnCount = 0;

    const mod = {
        id: 'timing',
        name: 'Timing',
        position: 999,
        system_msg: `You have access to a [Timing] block in the trailing state that updates on every LLM call — including each loop iteration during multi-step execution. It contains:
- local datetime with day of week and timezone (e.g. "Monday, March 31, 2026, 10:45 PM PDT (UTC-7)")
- session: how long this session has been active
- time_since_last_speech: time since the agent last spoke aloud (had a non-null response). Accumulates across silent turns.
- turns: number of completed LLM turns so far

Use this to stay aware of the current date/time, conversational pace, and session context. If the user asks what day or time it is, reference this data. If the user asks about timing, duration, or how long something took, reference this data. During multi-step execution, check time_since_last_speech to decide whether enough time has passed to give the user a progress update.`,
        state: '',
        beforeBuild() {
            const now = Date.now();
            const nowDate = new Date(now);
            if (!sessionStartTs) sessionStartTs = now;

            // Human-readable local datetime with day of week
            const localTime = nowDate.toLocaleString('en-US', {
                timeZone: tz,
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            });
            const tzAbbr = nowDate.toLocaleString('en-US', {
                timeZone: tz,
                timeZoneName: 'short',
            }).split(' ').pop();
            const offsetMin = -nowDate.getTimezoneOffset();
            const sign = offsetMin >= 0 ? '+' : '-';
            const absMin = Math.abs(offsetMin);
            const hrs = Math.floor(absMin / 60);
            const mins = absMin % 60;
            const utcOffset = `UTC${sign}${hrs}${mins > 0 ? ':' + String(mins).padStart(2, '0') : ''}`;

            const session = formatDuration(now - sessionStartTs);
            const storeLastSpeech = useSmartChatsStore.getState().lastSpeechTs;
            const sinceSpeech = storeLastSpeech
                ? formatDuration(now - storeLastSpeech)
                : 'first';

            mod.state = `${localTime} ${tzAbbr} (${utcOffset}) | session: ${session} | time_since_last_speech: ${sinceSpeech} | turns: ${turnCount}`;
        },
    };

    return mod;
}

/**
 * Call after each LLM turn completes to increment turn count.
 */
export function recordTurnComplete(): void {
    turnCount++;
}

