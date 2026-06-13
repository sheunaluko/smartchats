/**
 * Voice memos module: save_memo, play_memo.
 *
 * MVP model — a memo is a `logs` row with `category='voice_memo'`:
 *   - content  = full WebSpeech transcript (the user's speech)
 *   - metadata = { kind, audio_local_id, duration_seconds, device_id, title? }
 *
 * The transcript + metadata round-trip to the cloud DB (and sync across
 * devices). The raw audio is written to OPFS on the device that recorded
 * it — playing on a different device returns "audio not on this device."
 *
 * Listing / searching memos uses the existing log tools
 * (get_recent_logs, search_logs, search_logs_semantic) with
 * category='voice_memo' — no new query infra needed.
 */

import { embed_vector, getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';
import { nowEventTime } from './system';
import { saveBlob, readBlob, getDeviceId } from '../lib/voice_memo_storage';
import { get_audio_stream } from '@lab-components/tivi/lib/tsw/web_audio';

const VOICE_MEMOS_SYSTEM_MSG = `
## Voice memos

Voice memos let the user dictate a thought; the raw audio is saved on
their device and the transcript becomes a log entry with
category='voice_memo'.

- Call **save_memo** when the user asks to "record a memo", "take a
  voice memo", "dictate a note", or similar. The function speaks the
  prompt aloud, then collects audio + transcript chunks until the user
  says "finished" (or "cancel" to abort). Pass a short
  user_instructions string; the function will speak it.
- To **list** or **search** memos, use the standard log tools with
  category='voice_memo' — do NOT add separate list/search tools.
  Examples: \`get_recent_logs({category: 'voice_memo', limit: 10})\`,
  \`search_logs_semantic({text: 'the kitchen idea', category: 'voice_memo'})\`.
- Call **play_memo** with a memo id (a logs:xxx record id) to play the
  audio. Only works on the device that recorded it.

Do not call save_memo just because the user is talking — only when they
explicitly want to record / save / capture a memo.
`;

export function createVoiceMemosModule() {
    return {
        id: 'voice_memos',
        name: 'Voice Memos',
        position: 47,
        system_msg: VOICE_MEMOS_SYSTEM_MSG,
        functions: [
            // ── save_memo ──
            {
                enabled: true,
                description: `Record a voice memo. Speaks user_instructions aloud, then collects audio + transcript chunks until the user says "finished" (or "cancel" to abort). Saves the audio to local device storage and the transcript as a voice_memo log entry. You MUST return the result to retrieve the memo_id and transcript.`,
                name: 'save_memo',
                parameters: {
                    user_instructions: 'string',
                    title: 'string (optional)',
                },
                fn: async (ops: any) => {
                    const { user_instructions, title } = ops.params;
                    const { get_user_data, feedback, user_output, log } = ops.util;

                    feedback.activated();
                    await user_output(user_instructions || 'Recording. Say finished when done.');

                    // Tap the live mic stream (already initialized by tivi).
                    let stream: MediaStream;
                    try {
                        stream = await get_audio_stream();
                    } catch (err: any) {
                        log(`save_memo: mic unavailable: ${err}`);
                        return { error: 'Microphone unavailable' };
                    }

                    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                        ? 'audio/webm;codecs=opus'
                        : 'audio/webm';
                    const chunks: Blob[] = [];
                    const rec = new MediaRecorder(stream, { mimeType });
                    rec.ondataavailable = (e: BlobEvent) => {
                        if (e.data.size > 0) chunks.push(e.data);
                    };
                    rec.start(250);
                    const t0 = Date.now();

                    const text: string[] = [];
                    const clean = (s: string) => s.toLowerCase().trim().replace(/[.!?]/g, '');

                    let chunk: string = await get_user_data();

                    while (clean(chunk) !== 'finished') {
                        if (clean(chunk) === 'cancel') {
                            rec.stop();
                            // Drain so we don't leak the recorder
                            await new Promise((r) => rec.addEventListener('stop', r, { once: true }));
                            feedback.error?.();
                            log('save_memo: user cancelled');
                            return { cancelled: true };
                        }
                        text.push(chunk);
                        feedback.ok();
                        chunk = await get_user_data();
                    }

                    rec.stop();
                    await new Promise((r) => rec.addEventListener('stop', r, { once: true }));

                    const blob = new Blob(chunks, { type: 'audio/webm' });
                    const audio_local_id = `${crypto.randomUUID()}.webm`;
                    try {
                        await saveBlob(audio_local_id, blob);
                    } catch (err: any) {
                        log(`save_memo: OPFS save failed: ${err}`);
                        return { error: 'Failed to save audio locally' };
                    }

                    const duration_seconds = (Date.now() - t0) / 1000;
                    const transcript = text.join(' ').trim();

                    let embedding: unknown = null;
                    if (transcript) {
                        try {
                            embedding = await embed_vector(transcript);
                        } catch (err: any) {
                            log(`save_memo: embedding failed: ${err}`);
                        }
                    }

                    const response = (await getBackend().data.query(
                        queries.insertLog({
                            content: transcript,
                            category: 'voice_memo',
                            embedding,
                            ...nowEventTime(),
                            metadata: {
                                kind: 'voice_memo',
                                audio_local_id,
                                duration_seconds,
                                device_id: getDeviceId(),
                                title: title || null,
                            },
                        })
                    )) as any;

                    const rows = response.rows;
                    const memo_id = rows.length > 0 && rows[0]?.id != null ? String(rows[0].id) : null;

                    feedback.success();
                    ops.util.event?.({
                        type: 'voice_memo_saved',
                        data: { memo_id, duration_seconds, transcript_length: transcript.length },
                    });
                    log(`Memo saved (${duration_seconds.toFixed(1)}s, id=${memo_id})`);

                    return {
                        saved: !!memo_id,
                        memo_id,
                        transcript,
                        duration_seconds,
                    };
                },
                return_type: 'object',
            },

            // ── play_memo ──
            {
                enabled: true,
                description: `Play a previously-recorded voice memo by its log id (e.g. "logs:abc123"). Only works on the device that recorded the memo — if the audio file isn't on this device, returns an error.`,
                name: 'play_memo',
                parameters: {
                    memo_id: 'string',
                },
                fn: async (ops: any) => {
                    const { memo_id } = ops.params;
                    const { log } = ops.util;

                    if (!memo_id) return { error: 'memo_id is required' };

                    const bridge = (window as any)?.__smartchats_voice_memos__;
                    if (!bridge?.play) {
                        return { error: 'Voice memo playback bridge unavailable' };
                    }
                    const result = await bridge.play(memo_id);
                    if (!result?.ok) {
                        log(`play_memo: ${result?.error || 'unknown error'}`);
                        return { error: result?.error || 'Could not play memo' };
                    }
                    return { playing: true, memo_id, duration_seconds: result.duration_seconds };
                },
                return_type: 'object',
            },
        ],
    };
}
