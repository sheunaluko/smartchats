/**
 * Core utility functions: respond_to_user, accumulate_text, reset_sandbox,
 * check_login_status, initialize
 */

import { getAuthProvider } from '@/lib/auth'

export function createCoreModule() {
    return {
        id: 'core_functions',
        name: 'Core Functions',
        position: 10,
        functions: [
            {
                enabled: true,
                description: `Function for responding to the user`,
                name: 'respond_to_user',
                parameters: { response: 'string' },
                fn: async (ops: any) => {
                    let { user_output, log } = ops.util;
                    let { response } = ops.params;
                    log(`user response: ${String(response)}`);
                    await user_output(response);
                    return `Responded to user with: ${response}`;
                },
                return_type: 'string',
            },
            {
                enabled: true,
                description: `Collect extended text input from the user until they say "finished" (or "cancel" to abort). The user_instructions parameter is spoken aloud — either pass instructions there OR speak them in your response, never both. You must RETURN the result of this function to retrieve the collected text. silence_timeout_seconds (optional, defaults to 3600 = 1 hour) bounds how long to wait between chunks before declaring the user silent — pass a shorter value for situations where you specifically want to detect the user falling asleep / drifting off (e.g. dream journaling, body-scan pre-sleep loops).`,
                name: 'accumulate_text',
                return_shape: `{ status: 'finished' | 'cancelled' | 'silence_timeout', joined_text: string, pings: [{text, arrived_at_ms, delta_ms_from_previous, delta_ms_from_start}], total_pings: number, total_duration_ms: number, final_silence_ms: number, started_at_ms: number }. joined_text is the assembled input (one chunk per line) — pass THIS (not the whole result object) as the text param to save_log. status === 'silence_timeout' means the user went silent past silence_timeout_seconds; treat joined_text as best-effort and save what you have. status === 'cancelled' means the user explicitly aborted. The pings array is per-chunk timing for drift analysis — only inspect it if you specifically need timing information; in normal flows you can ignore it.`,
                parameters: { user_instructions: 'string', silence_timeout_seconds: 'number' },
                fn: async (ops: any) => {

                    let { get_user_data, feedback, user_output, log, addInsightEvent } = ops.util;
                    const silence_timeout_seconds = typeof ops.params.silence_timeout_seconds === 'number'
                        ? ops.params.silence_timeout_seconds
                        : 3600;
                    const timeoutMs = silence_timeout_seconds * 1000;

                    feedback.activated()
                    await user_output(ops.params.user_instructions || "");

                    const clean = function (s: string) {
                        return (s || "").toLowerCase().trim().replace(".", "")
                    }

                    const started_at_ms = Date.now();
                    const text: string[] = [];
                    const pings: any[] = [];
                    let last_arrived_at_ms = started_at_ms;
                    let status: 'finished' | 'cancelled' | 'silence_timeout' = 'finished';

                    while (true) {
                        const r = await get_user_data({ timeoutMs });

                        if (r.timed_out) {
                            status = 'silence_timeout';
                            break;
                        }

                        const chunk = r.text;

                        // Defensive: channel.flush() resolves with null on cancel
                        if (chunk == null) {
                            status = 'cancelled';
                            break;
                        }

                        const cleaned = clean(chunk);
                        if (cleaned === 'cancel') {
                            status = 'cancelled';
                            break;
                        }
                        if (cleaned === 'finished') {
                            status = 'finished';
                            break;
                        }

                        const arrived_at_ms = Date.now();
                        text.push(chunk);
                        pings.push({
                            text: chunk,
                            arrived_at_ms,
                            delta_ms_from_previous: arrived_at_ms - last_arrived_at_ms,
                            delta_ms_from_start: arrived_at_ms - started_at_ms,
                        });
                        last_arrived_at_ms = arrived_at_ms;
                        feedback.ok()
                    }

                    if (status === 'finished') feedback.success();

                    const end_at_ms = Date.now();
                    const total_duration_ms = end_at_ms - started_at_ms;
                    const final_silence_ms = pings.length > 0
                        ? end_at_ms - pings[pings.length - 1].arrived_at_ms
                        : total_duration_ms;

                    const result = {
                        status,
                        joined_text: text.join("\n"),
                        pings,
                        total_pings: pings.length,
                        total_duration_ms,
                        final_silence_ms,
                        started_at_ms,
                    };

                    // Persist the full session unconditionally so drift data survives
                    // even if the LLM ignores the pings field in its return handling.
                    try {
                        addInsightEvent('accumulate_session', {
                            status,
                            total_pings: pings.length,
                            total_duration_ms,
                            final_silence_ms,
                            silence_timeout_seconds,
                            started_at_ms,
                            pings,
                        });
                    } catch (e: any) {
                        log(`Failed to emit accumulate_session insight: ${e?.message || e}`);
                    }

                    return result;
                },
                return_type: 'any'
            },
            {
                enabled: true,
                description: 'Reset the JavaScript sandbox, clearing all variables and state.',
                name: 'reset_sandbox',
                parameters: null,
                fn: async (ops: any) => {
                    const { log } = ops.util;
                    log("Resetting sandbox environment");

                    const { resetSandbox } = await import("../src/sandbox");
                    await resetSandbox();

                    return "Sandbox environment reset successfully";
                },
                return_type: 'string'
            },
            {
                enabled: true,
                description: `Check the user's login status and storage mode (local or cloud).`,
                name: 'check_login_status',
                return_shape: `{ isAuthenticated: boolean, storageMode: 'cloud' | 'local' | 'unknown', userName: string (may be empty), message: string (user-facing description of the auth state) }. Branch on isAuthenticated and storageMode.`,
                parameters: null,
                fn: async (ops: any) => {
                    const { log } = ops.util;
                    log("Checking login status");

                    let isAuthenticated = false;
                    let storageMode = 'unknown';
                    let userName = '';

                    try {
                        const user = getAuthProvider().getCurrentUser();
                        isAuthenticated = !!user;
                        if (user) {
                            userName = user.displayName || user.email || '';
                        }
                    } catch { }

                    try {
                        const modeKey = 'appdata::smartchats::__backend_mode__';
                        storageMode = (typeof window !== 'undefined' && localStorage.getItem(modeKey)) || 'cloud';
                    } catch { }

                    let message: string;
                    if (isAuthenticated) {
                        message = `You are logged in${userName ? ` as ${userName}` : ''} with ${storageMode} storage. Your data syncs across devices.`;
                    } else if (storageMode === 'cloud') {
                        message = 'You are not logged in. You are in cloud mode but your data cannot sync until you log in. You can log in via the login button, or switch to local storage if you prefer to use SmartChats without an account.';
                    } else {
                        message = 'You are using local storage mode. Your data is saved in this browser only and will not sync across devices. You can log in and switch to cloud storage to enable cross-device sync.';
                    }

                    return { isAuthenticated, storageMode, userName, message };
                },
                return_type: 'object'
            },
        ],
    }
}
