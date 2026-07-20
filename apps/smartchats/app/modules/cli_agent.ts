/**
 * CLI Agent Module — connects to the PTY WebSocket server (pty-poc-ws)
 * to control Claude Code, Gemini CLI, or Codex CLI remotely from SmartChats.
 *
 * The agent can send commands, read terminal output, and monitor idle state.
 */

const DEFAULT_RELAY_URL = 'wss://smartchats-relay.fly.dev'

interface SessionMeta {
    session_id: string
    label: string
    model: string
    online: boolean
    last_active_ms_ago: number
}

let ws: WebSocket | null = null
let wsUrl = 'ws://localhost:9100'
let connected = false
let connectionMode: 'local' | 'cloud' = 'local'
let activeSessionId: string | null = null
let availableSessions: SessionMeta[] = []
let idle = false
let idleSeconds = 0
let outputBuffer: string[] = []
const MAX_OUTPUT_BUFFER = 500
let _emitEvent: ((evt: any) => void) | null = null
let _voiceForwardActive = false

// Firebase ID tokens expire ~1h after issue. Refresh well ahead of that and
// push a client_reauth to the relay so the socket keeps forwarding forever
// (relay closes the connection with code 1008 "reauth failed" if tokenExp
// passes without a refresh). Cleared on WS close/error.
const CLIENT_REAUTH_INTERVAL_MS = 45 * 60 * 1000
let reauthTimer: ReturnType<typeof setTimeout> | null = null

type OutputCb = (chunk: string) => void
const outputSubs = new Set<OutputCb>()

export function subscribeCliOutput(cb: OutputCb): () => void {
    outputSubs.add(cb)
    return () => { outputSubs.delete(cb) }
}

type StateCb = (connected: boolean) => void
const stateSubs = new Set<StateCb>()

export function subscribeCliConnectionState(cb: StateCb): () => void {
    stateSubs.add(cb)
    return () => { stateSubs.delete(cb) }
}

function effectivelyConnected(): boolean {
    if (connectionMode === 'local') return connected
    return connected && activeSessionId !== null
}

let lastNotifiedState = false
function notifyState(): void {
    const now = effectivelyConnected()
    if (now === lastNotifiedState) return
    lastNotifiedState = now
    for (const cb of stateSubs) cb(now)
}

export function isCliConnected(): boolean {
    return effectivelyConnected()
}

export function getActiveSessionId(): string | null {
    return activeSessionId
}

export function getAvailableSessions(): SessionMeta[] {
    return availableSessions
}

export function sendCliRawInput(data: string): void {
    if (ws && effectivelyConnected()) ws.send(JSON.stringify({ type: 'input', data }))
}

export function sendCliResize(cols: number, rows: number): void {
    if (ws && effectivelyConnected()) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
}

export async function ensureCliConnected(url?: string): Promise<void> {
    if (url) wsUrl = url
    const socket = ensureConnection()
    await waitForOpen(socket)
}

export function requestCliSnapshot(): void {
    if (ws && effectivelyConnected()) ws.send(JSON.stringify({ type: 'request_snapshot' }))
}

async function getFirebaseToken(): Promise<string> {
    const { getAuthProvider } = await import('@/lib/auth')
    const token = await getAuthProvider().getIdToken()
    if (!token) throw new Error('Not authenticated — sign in before connecting in cloud mode')
    return token
}

function clearReauthTimer(): void {
    if (reauthTimer) {
        clearTimeout(reauthTimer)
        reauthTimer = null
    }
}

function scheduleClientReauth(socket: WebSocket): void {
    clearReauthTimer()
    reauthTimer = setTimeout(async () => {
        // If the socket has been replaced or closed since scheduling, bail.
        if (ws !== socket || socket.readyState !== WebSocket.OPEN) return
        try {
            const token = await getFirebaseToken()
            socket.send(JSON.stringify({ type: 'client_reauth', token }))
            scheduleClientReauth(socket)
        } catch (e) {
            console.warn(`[cli_agent] reauth failed: ${(e as Error).message}`)
            // Don't reschedule — next connect will restart the loop.
        }
    }, CLIENT_REAUTH_INTERVAL_MS)
}

function waitForRelayMessage(socket: WebSocket, type: string, timeoutMs = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
        const handler = (event: MessageEvent) => {
            try {
                const msg = JSON.parse(event.data)
                if (msg.type === type) {
                    socket.removeEventListener('message', handler)
                    resolve(msg)
                } else if (msg.type === 'error') {
                    socket.removeEventListener('message', handler)
                    reject(new Error(`relay error: ${msg.code}`))
                }
            } catch {}
        }
        socket.addEventListener('message', handler)
        setTimeout(() => {
            socket.removeEventListener('message', handler)
            reject(new Error(`Timeout waiting for ${type}`))
        }, timeoutMs)
    })
}

function ensureConnection(): WebSocket {
    if (ws && connected) return ws

    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
        connected = true
        idle = false
        notifyState()
    }

    ws.onclose = () => {
        connected = false
        activeSessionId = null
        ws = null
        clearReauthTimer()
        notifyState()
    }

    ws.onerror = () => {
        connected = false
        activeSessionId = null
        ws = null
        clearReauthTimer()
        notifyState()
    }

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)

        if (msg.type === 'session_list') {
            availableSessions = Array.isArray(msg.sessions) ? msg.sessions : []
            return
        } else if (msg.type === 'subscribed') {
            activeSessionId = String(msg.session_id)
            notifyState()
            return
        } else if (msg.type === 'session_offline') {
            if (activeSessionId === msg.session_id) {
                activeSessionId = null
                notifyState()
            }
            return
        } else if (msg.type === 'error') {
            console.warn(`[cli_agent] relay error: ${msg.code}`)
            return
        }

        if (msg.type === 'output' || msg.type === 'snapshot') {
            for (const cb of outputSubs) cb(msg.data)
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
            activeSessionId = null
            ws = null
            notifyState()
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

Two connection modes:
- Local (LAN): cli_connect with no args — connects to ws://localhost:9100 (a bin/pty-bridge.mjs running on this machine).
- Cloud (via smartchats-relay): cli_connect with mode="cloud" — connects to the user's bridge running anywhere they've launched bin/pty-bridge.mjs --cloud. If the user has only one bridge online, it auto-selects. If multiple, the call returns { connected: false, sessions: [...] }; call cli_list_sessions or re-call cli_connect with session_id (or label) to pick one.

Use cli_send_command to send a natural language instruction to Claude Code. It returns immediately.
Use cli_read_output to read recent terminal output without sending anything.
Use cli_status to check connection and idle state.

IMPORTANT — idle notification flow:
After you send a command, the CLI will notify you when it goes idle (finished processing). When you receive a cli_idle notification, call cli_read_output to read the terminal output and relay the result to the user. Use an appropriate line count (e.g. 50–100 lines) to capture the response.
Do NOT poll — just acknowledge the command and WAIT for the idle notification.`,

        functions: [
            {
                enabled: true,
                description: 'Connect to a CLI bridge — either local (LAN, default ws://localhost:9100) or cloud (via smartchats-relay). Pass mode="cloud" with optional relay_url + session_id (or label) to route through the relay. Pass url (or no args) for legacy local mode.',
                name: 'cli_connect',
                return_shape: `Local mode: { connected: true, url } on ws-open. Cloud mode success: { connected: true, mode: 'cloud', session_id, label }. Cloud mode pending-selection (multiple sessions, none specified): { connected: false, sessions: [{session_id,label,model,online,last_active_ms_ago}], message }.`,
                parameters: { url: 'string', mode: 'string', relay_url: 'string', session_id: 'string', label: 'string' },
                fn: async (ops: any) => {
                    const { url, mode, relay_url, session_id, label } = ops.params
                    const { log, event } = ops.util
                    if (event) _emitEvent = event

                    if (mode === 'cloud') {
                        connectionMode = 'cloud'
                        const relay = (relay_url ?? DEFAULT_RELAY_URL).replace(/\/$/, '')
                        wsUrl = `${relay}/client`
                        log(`Connecting to relay ${wsUrl}`)

                        // Tear down any prior socket so we re-handshake cleanly.
                        if (ws) { try { ws.close() } catch {} ; ws = null ; connected = false }
                        const socket = ensureConnection()
                        await waitForOpen(socket)

                        const token = await getFirebaseToken()
                        socket.send(JSON.stringify({ type: 'client_hello', token }))
                        await waitForRelayMessage(socket, 'session_list')

                        if (availableSessions.length === 0) {
                            return { connected: false, sessions: [], message: 'No active sessions for this user. Start a bridge with --cloud.' }
                        }

                        let target = session_id
                        if (!target && label) {
                            target = availableSessions.find(s => s.label === label || s.label.includes(label))?.session_id
                        }
                        if (!target && availableSessions.length === 1) {
                            target = availableSessions[0].session_id
                        }
                        if (!target) {
                            return { connected: false, sessions: availableSessions, message: 'Multiple sessions available — provide session_id or label.' }
                        }

                        socket.send(JSON.stringify({ type: 'subscribe', session_id: target }))
                        await waitForRelayMessage(socket, 'subscribed')
                        log(`Subscribed to session ${target}`)
                        scheduleClientReauth(socket)
                        const chosen = availableSessions.find(s => s.session_id === target)
                        return { connected: true, mode: 'cloud', session_id: target, label: chosen?.label ?? '' }
                    }

                    // Local mode (default)
                    connectionMode = 'local'
                    if (url) wsUrl = url
                    log(`Connecting to CLI agent at ${wsUrl}`)
                    const socket = ensureConnection()
                    await waitForOpen(socket)
                    log('Connected to CLI agent')
                    return { connected: true, mode: 'local', url: wsUrl }
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: 'List currently available cloud sessions for the logged-in user. Only meaningful after cli_connect with mode=cloud. Returns the cached session_list from the last relay handshake.',
                name: 'cli_list_sessions',
                return_shape: `{ sessions: Array<{session_id, label, model, online, last_active_ms_ago}>, active_session_id: string | null }`,
                parameters: null,
                fn: async (_ops: any) => {
                    return { sessions: availableSessions, active_session_id: activeSessionId }
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
                return_shape: `{ connected, mode: 'local'|'cloud', url, active_session_id, idle, idleSeconds, bufferedLines }.`,
                parameters: null,
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const status = {
                        connected: effectivelyConnected(),
                        mode: connectionMode,
                        url: wsUrl,
                        active_session_id: activeSessionId,
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
