/**
 * CLI Agent Module — connects to the PTY WebSocket server (pty-poc-ws)
 * to control Claude Code, Gemini CLI, or Codex CLI remotely from SmartChats.
 *
 * The agent can send commands, read terminal output, and monitor idle state.
 */

let ws: WebSocket | null = null
let wsUrl = 'ws://localhost:9100'
let connected = false
let idle = false
let idleSeconds = 0
let outputBuffer: string[] = []
const MAX_OUTPUT_BUFFER = 500
let _emitEvent: ((evt: any) => void) | null = null
let _voiceForwardActive = false

function ensureConnection(): WebSocket {
    if (ws && connected) return ws

    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
        connected = true
        idle = false
    }

    ws.onclose = () => {
        connected = false
        ws = null
    }

    ws.onerror = () => {
        connected = false
        ws = null
    }

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)

        if (msg.type === 'output') {
            const lines = stripAnsi(msg.data).split('\n')
            for (const line of lines) {
                outputBuffer.push(line)
                if (outputBuffer.length > MAX_OUTPUT_BUFFER) {
                    outputBuffer.shift()
                }
            }
            idle = false
        } else if (msg.type === 'idle') {
            idle = true
            idleSeconds = msg.seconds
            console.log(`[cli_agent] idle detected — ${msg.seconds}s`)
            if (_voiceForwardActive) {
                // Voice forward mode — skip idle callback to avoid injecting partial output
            } else if (_emitEvent) {
                _emitEvent({
                    type: 'inject_user_data',
                    data: { name: 'cli_idle', idleSeconds: msg.seconds },
                    priority: 'immediate',
                })
            }
        } else if (msg.type === 'active') {
            idle = false
            idleSeconds = 0
        } else if (msg.type === 'exit') {
            connected = false
            ws = null
        }
    }

    return ws
}

function stripAnsi(str: string): string {
    return str.replace(
        /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=><%]/g,
        ''
    ).replace(/\r/g, '')
}

/** Filter out Claude Code TUI chrome lines (spinners, separators, prompt decorations) */
function filterTuiNoise(lines: string[]): string[] {
    const spinnerChars = /^[✶✻✽✢·*●○◦◆◇■□▪▫☐☑⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]+$/
    const separatorLine = /^[─━═─\-]{5,}$/
    const promptChrome = /^[❯>]\s*$/
    const shortcutHint = /^\??\s*for\s+shortcuts\s*$/i
    const whirlpool = /^(Whirlpooling|Thinking|Processing)…?\s*$/
    const emptyish = /^\s*$/

    return lines.filter(line => {
        const trimmed = line.trim()
        if (emptyish.test(trimmed)) return false
        if (spinnerChars.test(trimmed)) return false
        if (separatorLine.test(trimmed)) return false
        if (promptChrome.test(trimmed)) return false
        if (shortcutHint.test(trimmed)) return false
        if (whirlpool.test(trimmed)) return false
        // Single-char lines that are just spinner residue
        if (trimmed.length <= 2 && /^[^a-zA-Z0-9]/.test(trimmed)) return false
        return true
    })
}

function waitForOpen(socket: WebSocket, timeoutMs = 3000): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) return Promise.resolve()
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket connection timed out')), timeoutMs)
        socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
        socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket connection failed')) }, { once: true })
    })
}

export function createCliAgentModule(options?: { wsUrl?: string }) {
    if (options?.wsUrl) wsUrl = options.wsUrl

    return {
        id: 'cli_agent',
        name: 'CLI Agent',
        position: 55,

        system_msg: `You have access to a remote Claude Code session running in a terminal via WebSocket.
Claude Code is an AI coding agent that accepts natural language instructions — send it tasks like you would talk to a developer.

Use cli_connect to connect (or reconnect) to the WebSocket server.
Use cli_send_command to send a natural language instruction to Claude Code. It returns immediately.
Use cli_read_output to read recent terminal output without sending anything.
Use cli_status to check connection and idle state.

IMPORTANT — idle notification flow:
After you send a command, the CLI will notify you when it goes idle (finished processing). When you receive a cli_idle notification, call cli_read_output to read the terminal output and relay the result to the user. Use an appropriate line count (e.g. 50–100 lines) to capture the response.
Do NOT poll — just acknowledge the command and WAIT for the idle notification.`,

        functions: [
            {
                enabled: true,
                description: 'Connect to the PTY WebSocket server. Call this first or to reconnect. Optionally provide a custom WebSocket URL.',
                name: 'cli_connect',
                return_shape: `{ connected: true, url: string } on success. Throws on connect failure (no error-object return path).`,
                parameters: { url: 'string' },
                fn: async (ops: any) => {
                    const { url } = ops.params
                    const { log, event } = ops.util

                    if (url) wsUrl = url
                    if (event) _emitEvent = event
                    log(`Connecting to CLI agent at ${wsUrl}`)

                    const socket = ensureConnection()
                    await waitForOpen(socket)

                    log('Connected to CLI agent')
                    return { connected: true, url: wsUrl }
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: 'Send a command or prompt to the CLI agent. Returns immediately — output arrives asynchronously when the agent goes idle.',
                name: 'cli_send_command',
                return_shape: `{ sent: true, command: string (truncated to 100 chars in the echo) }. Returns immediately; the actual output arrives later via cli_idle notification — call cli_read_output then.`,
                parameters: { command: 'string' },
                fn: async (ops: any) => {
                    const { command } = ops.params
                    const { log, event } = ops.util

                    if (event) _emitEvent = event

                    if (!ws || !connected) {
                        const socket = ensureConnection()
                        await waitForOpen(socket)
                    }

                    log(`Sending command: ${command.slice(0, 100)}`)
                    ws!.send(JSON.stringify({ type: 'input', data: command + '\n' }))

                    return { sent: true, command: command.slice(0, 100) }
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: 'Read the last N lines of terminal output from the CLI agent without sending any input.',
                name: 'cli_read_output',
                return_shape: `Success: { output: string (lines joined by '\\n'), lineCount: number, source?: 'local_buffer' (set when the WS read timed out and we fell back to the local buffer) }. Error: { error: 'Not connected. Call cli_connect first.' }.`,
                parameters: { lines: 'number' },
                fn: async (ops: any) => {
                    const { lines } = ops.params
                    const { log } = ops.util
                    const n = lines || 50

                    if (!ws || !connected) {
                        return { error: 'Not connected. Call cli_connect first.' }
                    }

                    log(`Reading last ${n} lines`)

                    return new Promise((resolve) => {
                        const handler = (event: MessageEvent) => {
                            const msg = JSON.parse(event.data)
                            if (msg.type === 'lines') {
                                ws!.removeEventListener('message', handler)
                                resolve({
                                    output: msg.data.join('\n'),
                                    lineCount: msg.data.length,
                                })
                            }
                        }
                        ws!.addEventListener('message', handler)
                        ws!.send(JSON.stringify({ type: 'read', lines: n }))

                        setTimeout(() => {
                            ws!.removeEventListener('message', handler)
                            const local = outputBuffer.slice(-n)
                            resolve({
                                output: local.join('\n'),
                                lineCount: local.length,
                                source: 'local_buffer',
                            })
                        }, 3000)
                    })
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: `Forward incoming voice transcriptions to the connected CLI session in real time.
Blocks until the user says "finished" (or "cancel"). Each voice chunk is sent as PTY input.
Set submit=true to append a newline after each chunk (submits to the CLI). While this function
is running, voice input routes here automatically via the function_input_ch channel.`,
                name: 'cli_voice_forward',
                return_shape: `Completion: { status: 'VOICE MODE COMPLETE', sentChars: number, sentMessages: number }. Cancellation: { status: 'VOICE MODE CANCELLED', sentChars: number, sentMessages: number }. Error: { error: 'Not connected. Call cli_connect first.' }.`,
                parameters: { submit: 'boolean', instructions: 'string' },
                fn: async (ops: any) => {
                    const { submit, instructions } = ops.params
                    // get_user_data is provided by cortex engine — it awaits function_input_ch.read()
                    // Because is_running_function=true while this fn executes, the orchestrator's
                    // transcriptionCb routes voice text here via cor.handle_function_input(text)
                    const { get_user_data, feedback, user_output, log } = ops.util

                    if (!ws || !connected) {
                        return { error: 'Not connected. Call cli_connect first.' }
                    }

                    _voiceForwardActive = true
                    feedback.activated()
                    await user_output(instructions || 'Voice-to-CLI mode active. Say "finished" to stop.')

                    let sentChars = 0
                    let sentMessages = 0
                    const clean = (s: string) => s.toLowerCase().trim().replace('.', '')

                    let chunk: string = await get_user_data()

                    while (clean(chunk) !== 'finished') {
                        if (clean(chunk) === 'cancel') {
                            _voiceForwardActive = false
                            log('cli_voice_forward: cancelled')
                            return { status: 'VOICE MODE CANCELLED', sentChars, sentMessages }
                        }

                        const payload = submit !== false ? chunk + '\n' : chunk
                        log(`cli_voice_forward: sending ${chunk.length} chars`)
                        ws!.send(JSON.stringify({ type: 'input', data: payload }))

                        sentChars += chunk.length
                        sentMessages++
                        feedback.ok()

                        chunk = await get_user_data()
                    }

                    _voiceForwardActive = false
                    feedback.success()
                    log(`cli_voice_forward: done — ${sentMessages} msgs, ${sentChars} chars`)
                    return { status: 'VOICE MODE COMPLETE', sentChars, sentMessages }
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: 'Check the connection status and idle state of the CLI agent.',
                name: 'cli_status',
                return_shape: `{ connected: boolean, url: string, idle: boolean, idleSeconds: number (0 when not idle), bufferedLines: number }.`,
                parameters: null,
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const status = {
                        connected,
                        url: wsUrl,
                        idle,
                        idleSeconds: idle ? idleSeconds : 0,
                        bufferedLines: outputBuffer.length,
                    }
                    log(`CLI status: ${JSON.stringify(status)}`)
                    return status
                },
                return_type: 'object',
            },
        ],
    }
}
