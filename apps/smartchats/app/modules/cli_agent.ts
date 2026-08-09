/**
 * CLI Agent Module — connects to the PTY WebSocket server (pty-poc-ws)
 * to control Claude Code, Gemini CLI, or Codex CLI remotely from SmartChats.
 *
 * The agent can send commands, read terminal output, and monitor idle state.
 */

const DEFAULT_RELAY_URL = 'wss://smartchats-relay.fly.dev'

export type BridgeKind = 'pty' | 'agent'

interface SessionMeta {
    session_id: string
    kind: BridgeKind
    label: string
    model: string
    online: boolean
    last_active_ms_ago: number
}

export interface AgentMessage {
    from: 'agent'
    text: string
    timestamp: number
}

let ws: WebSocket | null = null
let wsUrl = 'ws://localhost:9100'
let connected = false
let connectionMode: 'local' | 'cloud' = 'local'
let activeSessionId: string | null = null
let activeSessionKind: BridgeKind | null = null
let availableSessions: SessionMeta[] = []
let idle = false
let idleSeconds = 0
let outputBuffer: string[] = []
const MAX_OUTPUT_BUFFER = 500
let _emitEvent: ((evt: any) => void) | null = null
let _voiceForwardActive = false

// Patch-through mode — user's voice routes as agent_message to the subscribed
// agent-kind bridge instead of as PTY 'input'. The agent-mcp-bridge queues
// those messages and its wait_for_message tool returns them to the coding agent.
let patched = false

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

type AgentMsgCb = (msg: AgentMessage) => void
const agentMsgSubs = new Set<AgentMsgCb>()

/** Subscribe to incoming agent-kind messages (from send_message_to_user tool calls
 *  on the coding-agent side). Widgets can use this to render the conversation and
 *  push text into TTS. */
export function subscribeCliAgentMessage(cb: AgentMsgCb): () => void {
    agentMsgSubs.add(cb)
    return () => { agentMsgSubs.delete(cb) }
}

type PatchModeCb = (patched: boolean) => void
const patchModeSubs = new Set<PatchModeCb>()

export function subscribeCliPatchMode(cb: PatchModeCb): () => void {
    patchModeSubs.add(cb)
    return () => { patchModeSubs.delete(cb) }
}

export function isCliPatched(): boolean {
    return patched
}

export function getActiveSessionKind(): BridgeKind | null {
    return activeSessionKind
}

/** Programmatically leave patch-through mode (e.g. widget's Unpatch button).
 *  Same effect as the `cli_unpatch` tool. */
export function unpatchCli(): void {
    if (patched) {
        patched = false
        for (const cb of patchModeSubs) cb(false)
    }
}

type UserSentCb = (text: string, timestamp: number) => void
const userSentSubs = new Set<UserSentCb>()

/** Subscribe to user's outbound agent_message chunks (only fires while patched
 *  and cli_voice_forward is running). Widgets use this to render the user side
 *  of the conversation. */
export function subscribeCliUserSent(cb: UserSentCb): () => void {
    userSentSubs.add(cb)
    return () => { userSentSubs.delete(cb) }
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
        activeSessionKind = null
        if (patched) { patched = false; for (const cb of patchModeSubs) cb(false) }
        ws = null
        clearReauthTimer()
        notifyState()
    }

    ws.onerror = () => {
        connected = false
        activeSessionId = null
        activeSessionKind = null
        if (patched) { patched = false; for (const cb of patchModeSubs) cb(false) }
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
            // Do NOT set activeSessionKind here. The caller who initiated the
            // subscribe (cli_connect for pty, cli_patch_through for agent) is
            // responsible for setting it after the subscribed ack — that avoids
            // the race where this handler reads a stale availableSessions and
            // silently defaults to 'pty' even when the caller knows the bridge
            // is 'agent'. Bug found in 2026-08-08 audit: `agent_message` was
            // getting mis-routed as `input` and dropped by the relay because of
            // this fallback.
            notifyState()
            return
        } else if (msg.type === 'session_offline') {
            if (activeSessionId === msg.session_id) {
                activeSessionId = null
                activeSessionKind = null
                if (patched) {
                    patched = false
                    for (const cb of patchModeSubs) cb(false)
                }
                notifyState()
            }
            return
        } else if (msg.type === 'error') {
            console.warn(`[cli_agent] relay error: ${msg.code}`)
            return
        } else if (msg.type === 'agent_event') {
            // agent-kind bridge event — dispatch by event subtype.
            // Diagnostic: fire an insights event on EVERY agent_event arrival
            // so we can see (from session bundles) whether the response path
            // is delivering messages, and if so, whether TTS + widget subs
            // fire. Added 2026-08-09 to debug "Claude responds but user hears
            // nothing" — the previous absence of any signal here made it
            // impossible to tell whether the wire delivered or not.
            const insights = (typeof window !== 'undefined' ? (window as any).cortexInsights : undefined)
            const tiviGlobal = (typeof window !== 'undefined' ? (window as any).tivi : undefined)
            const hasTtsQueue = !!(tiviGlobal?.ttsQueue?.speakText)
            insights?.addEvent?.('agent_event_received', {
                event: msg.event ?? null,
                has_text: typeof msg.text === 'string',
                text_length: typeof msg.text === 'string' ? msg.text.length : 0,
                text_preview: typeof msg.text === 'string' ? msg.text.slice(0, 80) : null,
                subscriber_count: agentMsgSubs.size,
                tivi_available: hasTtsQueue,
                patched,
                active_session_kind: activeSessionKind,
            })?.catch?.(() => {})

            if (msg.event === 'message' && typeof msg.text === 'string') {
                const agentMsg: AgentMessage = {
                    from: 'agent',
                    text: msg.text,
                    timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
                }
                // Fire TTS at the module level so agent replies always audibly
                // reach the user — even if AgentCallWidget isn't mounted (which
                // happens for anyone whose cortex_widget_config in localStorage
                // predates the widget being added). Widget subscribers still
                // fire below for bubble rendering when the widget IS mounted.
                try {
                    if (hasTtsQueue) {
                        tiviGlobal.ttsQueue.speakText(agentMsg.text)
                        insights?.addEvent?.('agent_event_tts_dispatched', {
                            text_length: agentMsg.text.length,
                            text_preview: agentMsg.text.slice(0, 80),
                        })?.catch?.(() => {})
                    }
                } catch (err) {
                    insights?.addEvent?.('agent_event_tts_error', {
                        error_message: (err as Error)?.message ?? String(err),
                        text_length: agentMsg.text.length,
                    })?.catch?.(() => {})
                }
                for (const cb of agentMsgSubs) cb(agentMsg)
            }
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
            activeSessionKind = null
            if (patched) { patched = false; for (const cb of patchModeSubs) cb(false) }
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

        system_msg: `You have access to remote coding-agent sessions via WebSocket. There are two bridge kinds:

- kind='pty' — legacy PTY-wrapped CLI (bin/pty-bridge.mjs wrapping claude/gemini/codex). You interact via cli_send_command (natural-language instruction) + cli_read_output (poll output) + cli_voice_forward (voice → PTY input). Output arrives as terminal bytes; wait for cli_idle before reading.
- kind='agent' — MCP-based agent participant (smartchats-mcp-bridge, a coding agent that has send_message_to_user / wait_for_message tools). You enter this mode via cli_patch_through, which routes the user's voice as agent_message and surfaces the agent's send_message_to_user calls as TTS-spoken replies. Call cli_unpatch to leave.

Connection modes:
- Local (LAN): cli_connect with no args — connects to ws://localhost:9100 (a bin/pty-bridge.mjs running on this machine, kind='pty' only).
- Cloud (via smartchats-relay): cli_connect with mode="cloud" — connects to any bridge (either kind) registered under the user's account. If the user has only one bridge online, it auto-selects. If multiple, the call returns { connected: false, sessions: [...] } with kind on each; use session_id (or label) to pick one.

Common tools:
- cli_status — check connection, mode, subscribed session kind, patched flag, idle state.
- cli_list_sessions — enumerate available sessions (each includes kind).

kind='pty' flow (unchanged):
- cli_send_command → immediate return; wait for cli_idle notification → cli_read_output.
- cli_voice_forward → voice becomes PTY input.

kind='agent' flow (patch-through) — CALL CEREMONY:
- cli_patch_through(session_id?) is BLOCKING. When you call it, you (the LLM) are 'on hold' — the tool doesn't return until the user says an exit phrase ('unpatch' / 'end call' / 'stop listening' / 'goodbye' / 'hang up' / 'cancel' / 'finished'). During the call, user's voice + text input routes directly as agent_message to the coding agent (bypassing you entirely). Agent's send_message_to_user calls surface as TTS-spoken bubbles via AgentCallWidget — the user hears the agent, you (LLM) don't need to do anything.
- Optional session_id if multiple agent bridges are online; auto-selects otherwise.
- When the tool returns, you'll see { unpatched: true, sent_messages, duration_ms } — briefly acknowledge the call ended and stand ready for the next user request.
- cli_unpatch — vestigial. cli_patch_through unpatches automatically on exit; only call cli_unpatch if patched-mode state got wedged somehow.

IMPORTANT — idle notification flow (pty only):
After cli_send_command on a pty bridge, wait for cli_idle notification, then cli_read_output. Do NOT poll. This does NOT apply in patch-through mode — agent-kind bridges don't emit idle events.`,

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
                        // Caller-owned kind (the subscribed handler doesn't set
                        // this anymore — see the race-fix note there). Generic
                        // cli_connect defaults to 'pty' since it's the legacy
                        // path; patch-through path uses cli_patch_through which
                        // sets kind='agent' explicitly.
                        activeSessionKind = chosen?.kind ?? 'pty'
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
                description: 'List currently available cloud sessions for the logged-in user. Only meaningful after cli_connect with mode=cloud. Sends a live `list_sessions` request to the relay and awaits the fresh `session_list` response — reflects bridges that connected AFTER the initial handshake. Falls back to the cached list if not connected in cloud mode.',
                name: 'cli_list_sessions',
                return_shape: `{ sessions: Array<{session_id, kind: 'pty'|'agent', label, model, online, last_active_ms_ago}>, active_session_id: string | null }`,
                parameters: null,
                fn: async (_ops: any) => {
                    if (ws && connected && connectionMode === 'cloud') {
                        try {
                            ws.send(JSON.stringify({ type: 'list_sessions' }))
                            // The regular onmessage dispatcher will update
                            // `availableSessions` when the fresh session_list
                            // arrives — we just gate on that arrival here.
                            await waitForRelayMessage(ws, 'session_list', 3000)
                        } catch {
                            // Fall through to whatever's cached — caller still
                            // gets *some* answer even if the relay is slow.
                        }
                    }
                    return { sessions: availableSessions, active_session_id: activeSessionId }
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: `Send a command / prompt / text message to the connected CLI session. Kind-aware routing:
- Bridge kind='pty' (legacy CLI wrapped in PTY): sent as PTY 'input' (keystrokes + newline). Output arrives asynchronously when the CLI goes idle — wait for the cli_idle notification, then call cli_read_output.
- Bridge kind='agent' AND patched=true (via cli_patch_through): sent as 'agent_message' on the wire. The coding agent's wait_for_message tool returns it; agent responds via send_message_to_user → arrives as agent_event, rendered as a bubble + spoken via TTS in AgentCallWidget. NO cli_idle event will fire — do NOT wait for one; do NOT call cli_read_output.
- Bridge kind='agent' but NOT patched: relay drops the message. Call cli_patch_through first (returns { patched: true }) then re-send.`,
                name: 'cli_send_command',
                return_shape: `Success: { sent: true, command: string (truncated to 100 chars in the echo), routed_as: 'input'|'agent_message', mode: 'pty'|'patched'|'unpatched-agent-dropped' }. The routed_as field tells you which wire type went out; use it to gate follow-up behavior (wait for cli_idle only if routed_as === 'input').`,
                parameters: { command: 'string' },
                fn: async (ops: any) => {
                    const { command } = ops.params
                    const { log, event } = ops.util

                    if (event) _emitEvent = event

                    if (!ws || !connected) {
                        const socket = ensureConnection()
                        await waitForOpen(socket)
                    }

                    // Kind-aware routing so relay's FORWARDED_FROM_CLIENT filter
                    // doesn't drop the message. See relay ws/client.ts + the failing
                    // 2026-08-06 patch-through test (ses_msgv0qkp1tkrp1j) where 6
                    // 'input' sends silently vanished against an agent-kind bridge.
                    if (patched && activeSessionKind === 'agent') {
                        const ts = Date.now()
                        log(`Sending agent_message: ${command.slice(0, 100)}`)
                        ws!.send(JSON.stringify({
                            type: 'agent_message',
                            text: command,
                            timestamp: ts,
                        }))
                        for (const cb of userSentSubs) cb(command, ts)
                        return { sent: true, command: command.slice(0, 100), routed_as: 'agent_message', mode: 'patched' }
                    }

                    if (activeSessionKind === 'agent' && !patched) {
                        return { sent: false, command: command.slice(0, 100), routed_as: 'input', mode: 'unpatched-agent-dropped',
                                 error: 'Subscribed to an agent-kind bridge but not patched — relay would drop the PTY-style input. Call cli_patch_through first.' }
                    }

                    log(`Sending input: ${command.slice(0, 100)}`)
                    ws!.send(JSON.stringify({ type: 'input', data: command + '\n' }))
                    return { sent: true, command: command.slice(0, 100), routed_as: 'input', mode: 'pty' }
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

                        if (patched && activeSessionKind === 'agent') {
                            log(`cli_voice_forward: sending agent_message ${chunk.length} chars`)
                            const ts = Date.now()
                            ws!.send(JSON.stringify({
                                type: 'agent_message',
                                text: chunk,
                                timestamp: ts,
                            }))
                            for (const cb of userSentSubs) cb(chunk, ts)
                        } else {
                            const payload = submit !== false ? chunk + '\n' : chunk
                            log(`cli_voice_forward: sending ${chunk.length} chars`)
                            ws!.send(JSON.stringify({ type: 'input', data: payload }))
                        }

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
                description: 'Check the connection status, subscribed session kind (pty|agent), patch-through state, and idle state.',
                name: 'cli_status',
                return_shape: `{ connected, mode: 'local'|'cloud', url, active_session_id, active_session_kind: 'pty'|'agent'|null, patched: boolean, idle, idleSeconds, bufferedLines }.`,
                parameters: null,
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const status = {
                        connected: effectivelyConnected(),
                        mode: connectionMode,
                        url: wsUrl,
                        active_session_id: activeSessionId,
                        active_session_kind: activeSessionKind,
                        patched,
                        idle,
                        idleSeconds: idle ? idleSeconds : 0,
                        bufferedLines: outputBuffer.length,
                    }
                    log(`CLI status: ${JSON.stringify(status)}`)
                    return status
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: `Enter patch-through mode with an agent-kind bridge — a CALL CEREMONY. This tool BLOCKS while the user is on the call: user's voice + text input routes as agent_message to the coding agent (bypassing you, the LLM); agent's send_message_to_user calls surface as TTS-spoken bubbles via AgentCallWidget. You (the LLM) are effectively 'on hold' during the call — you cannot do other work until the user exits the call by saying 'unpatch' / 'end call' / 'stop listening' / 'goodbye'. Requires cli_connect(mode:'cloud') to have run first. If session_id is omitted, auto-selects when exactly one agent session is online.`,
                name: 'cli_patch_through',
                return_shape: `Success (after user ends call): { unpatched: true, session_id, label, sent_messages: N, duration_ms }. Errors (return immediately, don't block): { error: 'not_connected' | 'no_agent_sessions' | 'ambiguous_agent_sessions', sessions?, message? }.`,
                parameters: { session_id: 'string' },
                fn: async (ops: any) => {
                    const { session_id } = ops.params
                    const { log, feedback, user_output, get_user_data } = ops.util

                    if (!ws || !connected || connectionMode !== 'cloud') {
                        return { error: 'not_connected', message: 'Call cli_connect(mode:"cloud") first.' }
                    }

                    const agentSessions = availableSessions.filter(s => s.kind === 'agent')
                    let target = session_id
                    if (!target) {
                        if (agentSessions.length === 0) {
                            return { error: 'no_agent_sessions', message: 'No agent bridges online. Start one with `sm agent start <coding-agent>`.' }
                        }
                        if (agentSessions.length > 1) {
                            return {
                                error: 'ambiguous_agent_sessions',
                                sessions: agentSessions,
                                message: 'Multiple agent sessions available — pass session_id.',
                            }
                        }
                        target = agentSessions[0].session_id
                    }

                    ws.send(JSON.stringify({ type: 'subscribe', session_id: target }))
                    await waitForRelayMessage(ws, 'subscribed')

                    const chosen = availableSessions.find(s => s.session_id === target)
                    activeSessionKind = chosen?.kind ?? 'agent'
                    patched = true
                    _voiceForwardActive = true
                    for (const cb of patchModeSubs) cb(true)
                    log(`Patched through to agent session ${target}; entering call loop`)

                    // ── Call ceremony: block until user says an exit phrase ──
                    // While this fn is executing, cortex's is_running_function=true
                    // redirects transcriptions to function_input_ch (via
                    // orchestrator.transcriptionCb → cor.handle_function_input),
                    // so voice AND text input both surface here as chunks from
                    // get_user_data(). Each chunk goes on-wire as agent_message
                    // (bypassing you, the LLM). Agent replies come back as
                    // agent_event, rendered + spoken via AgentCallWidget.
                    const startMs = Date.now()
                    let sentMessages = 0
                    const clean = (s: string) => s.toLowerCase().trim().replace(/[.!?]+$/, '')
                    const EXIT_PHRASES = new Set(['unpatch', 'end call', 'stop listening', 'goodbye', 'hang up', 'cancel', 'finished'])

                    try {
                        feedback?.activated?.()
                        await user_output?.(`Patched through to ${chosen?.label ?? target}. Speak to the agent directly. Say "unpatch" to end the call.`)

                        while (true) {
                            const chunk: string = await get_user_data()
                            if (EXIT_PHRASES.has(clean(chunk))) {
                                log(`Exit phrase heard: "${chunk}" — ending call`)
                                break
                            }
                            const ts = Date.now()
                            if (ws && ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({ type: 'agent_message', text: chunk, timestamp: ts }))
                                for (const cb of userSentSubs) cb(chunk, ts)
                                sentMessages++
                                feedback?.ok?.()
                                log(`sent agent_message (${chunk.length} chars, total ${sentMessages})`)
                            } else {
                                log(`ws not open — chunk dropped`)
                                break
                            }
                        }
                    } finally {
                        _voiceForwardActive = false
                        patched = false
                        for (const cb of patchModeSubs) cb(false)
                        feedback?.success?.()
                    }

                    return {
                        unpatched: true,
                        session_id: target,
                        label: chosen?.label ?? '',
                        sent_messages: sentMessages,
                        duration_ms: Date.now() - startMs,
                    }
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: `Exit patch-through mode. Stops routing user's voice to the coding agent as agent_message; further voice input goes back to the normal LLM path. The underlying WebSocket subscription remains — the agent bridge keeps running and can be re-patched.`,
                name: 'cli_unpatch',
                return_shape: `{ unpatched: true }`,
                parameters: null,
                fn: async (ops: any) => {
                    const { log } = ops.util
                    if (patched) {
                        patched = false
                        for (const cb of patchModeSubs) cb(false)
                        log('Unpatched from agent session')
                    }
                    return { unpatched: true }
                },
                return_type: 'object',
            },
        ],
    }
}
