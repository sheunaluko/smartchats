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
                description: `Collect extended text input from the user until they say "finished" (or "cancel" to abort). The user_instructions parameter is spoken aloud — either pass instructions there OR speak them in your response, never both. You must RETURN the result of this function to retrieve the collected text.`,
                name: 'accumulate_text',
                parameters: { user_instructions: 'string' },
                fn: async (ops: any) => {

                    let { get_user_data, feedback, user_output, log } = ops.util;
                    feedback.activated()
                    await user_output(ops.params.user_instructions || "");

                    let text: string[] = [];
                    let chunk = await get_user_data();

                    let clean = function (s: string) {
                        return s.toLowerCase().trim().replace(".", "")
                    }

                    while (clean(chunk) != "finished") {

                        if (clean(chunk) == "cancel") {
                            return "User cancelled the text accumulation"
                        }

                        text.push(chunk)
                        feedback.ok()
                        chunk = await get_user_data();
                    }

                    feedback.success();

                    return text.join("\n")
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
