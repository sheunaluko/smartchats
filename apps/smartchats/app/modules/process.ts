/**
 * Process functions: fork_process, ps, read_process, kill_process, send_process_input
 */

export function createProcessModule() {
    return {
        id: 'process_functions',
        name: 'Process Functions',
        position: 35,
        system_msg: `You can spawn background processes that run independently while the conversation continues.
Use 'execute' mode for code that runs once (timers, data fetching, file processing).
Use 'agent' mode to spawn a sub-agent that reasons and loops autonomously on a task.
Processes have stdout/stderr streams you can check with ps and read_process.

IMPORTANT — process code style:
Process code runs in a sandbox wrapper. You MUST use explicit return statements and top-level await — do NOT wrap code in an IIFE.
WRONG: \`(async () => { await something(); return result; })()\`
RIGHT: \`const result = await something(); return result;\`
Use console.log() to emit output to stdout. Use return to produce the final result.`,
        functions: [
            {
                enabled: true,
                description: `Spawn a background process. Mode 'execute' runs code once; mode 'agent' spawns a sub-agent with its own LLM loop. completionMode: 'immediate' triggers your next turn on completion, 'standard' waits for user.`,
                name: 'fork_process',
                parameters: { name: 'string', mode: 'string', completionMode: 'string', code: 'string', directive: 'string', maxLoops: 'number' },
                fn: async (ops: any) => {
                    const { name, mode, completionMode, code, directive, maxLoops } = ops.params;
                    const { log } = ops.util;
                    const COR = (typeof window !== 'undefined' ? (window as any).COR : null);
                    if (!COR?.processManager) throw new Error('ProcessManager not initialized');
                    log(`Forking process: ${name} (${mode})`);
                    const pid = await COR.processManager.fork({ name, mode, completionMode, code, directive, maxLoops });
                    return { process_id: pid, name, status: 'running' };
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: 'Lists all background processes with their status, elapsed time, and output line counts.',
                name: 'ps',
                parameters: null,
                fn: async (ops: any) => {
                    const COR = (typeof window !== 'undefined' ? (window as any).COR : null);
                    if (!COR?.processManager) return [];
                    return COR.processManager.ps();
                },
                return_type: 'array',
            },
            {
                enabled: true,
                description: `Read stdout/stderr output from a background process.`,
                name: 'read_process',
                parameters: { process_id: 'string', stream: 'string', last: 'number' },
                fn: async (ops: any) => {
                    const { process_id, stream, last } = ops.params;
                    const COR = (typeof window !== 'undefined' ? (window as any).COR : null);
                    if (!COR?.processManager) return null;
                    return COR.processManager.read(process_id, { stream, last });
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: 'Kills a running background process.',
                name: 'kill_process',
                parameters: { process_id: 'string' },
                fn: async (ops: any) => {
                    const { process_id } = ops.params;
                    const { log } = ops.util;
                    const COR = (typeof window !== 'undefined' ? (window as any).COR : null);
                    if (!COR?.processManager) return { killed: false };
                    log(`Killing process: ${process_id}`);
                    return { killed: COR.processManager.kill(process_id) };
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: `Send input data to a child process that is waiting for input via request_input.`,
                name: 'send_process_input',
                parameters: { process_id: 'string', data: 'any' },
                fn: async (ops: any) => {
                    const { process_id, data } = ops.params;
                    const { log } = ops.util;
                    const COR = (typeof window !== 'undefined' ? (window as any).COR : null);
                    if (!COR?.processManager) return { sent: false, error: 'ProcessManager not initialized' };
                    log(`Sending input to process: ${process_id}`);
                    const sent = COR.processManager.sendInput(process_id, data);
                    return { sent, process_id };
                },
                return_type: 'object',
            },
        ],
    }
}
