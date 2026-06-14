/**
 * Sessions module: auto-save, list, search, read, activate sessions via SurrealDB.
 *
 * Each session is one SurrealDB record in the `sessions` table. Auto-saved after
 * every completed agent turn. Labels are derived from the first user message.
 *
 * Session schema:
 *   id              — SurrealDB record ID (e.g. sessions:abc123)
 *   label           — first user message truncated to 60 chars
 *   message_count   — number of non-system messages
 *   chat_history    — full conversation array
 *   workspace       — workspace object
 *   thought_history — agent reasoning steps
 *   execution_history — code execution snapshots
 *   settings        — { aiModel, speechCooldownMs, soundFeedback }
 *   created_at      — physical row creation in this DB (auto, READONLY)
 *   updated_at      — physical row last write in this DB (auto)
 *   ts              — real-UTC instant the session was active (app-stamped via
 *                     nowEventTime; preserved across export/import; UI lists
 *                     and search ORDER BY ts so original timing survives)
 *   local_date      — YYYY-MM-DD in the user's tz (app-stamped)
 *   local_tz        — IANA timezone the user was in (app-stamped)
 */

import { getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';
import { nowEventTime } from './system';

// ── Session ID state (module-level, not in Zustand) ──────────────────────────

let _currentSessionId: string | null = null
let _saveInProgress = false

export function getCurrentSessionId(): string | null { return _currentSessionId }
export function setCurrentSessionId(id: string | null) { _currentSessionId = id }

// ── Label generation ─────────────────────────────────────────────────────────

export function generateLabel(chatHistory: Array<{ role: string; content: string }>): string {
    const firstUserMsg = chatHistory.find(m => m.role === 'user')
    if (!firstUserMsg) return 'Empty session'
    const text = firstUserMsg.content.trim()
    if (text.length <= 60) return text
    const truncated = text.slice(0, 60).replace(/\s+\S*$/, '')
    return truncated + '...'
}

// ── SurrealDB query functions ────────────────────────────────────────────────

export async function saveSessionToSurreal(session: {
    label: string
    message_count: number
    chat_history: any[]
    workspace: Record<string, any>
    thought_history: any[]
    execution_history: any[]
    settings: any
}): Promise<string> {
    // Wait for any in-flight save to complete (up to 10s)
    if (_saveInProgress) {
        const start = Date.now()
        while (_saveInProgress && Date.now() - start < 10000) {
            await new Promise(r => setTimeout(r, 100))
        }
        // If still in progress after 10s, skip
        if (_saveInProgress) return _currentSessionId || ''
    }
    _saveInProgress = true

    try {


        const writeFields = {
            label: session.label,
            message_count: session.message_count,
            chat_history: session.chat_history,
            workspace: session.workspace,
            thought_history: session.thought_history,
            execution_history: session.execution_history,
            settings: session.settings,
            ...nowEventTime(),
        }

        if (_currentSessionId) {
            await getBackend().data.query(queries.updateSession(_currentSessionId, writeFields))
            return _currentSessionId
        } else {
            const response = await getBackend().data.query(queries.insertSession(writeFields)) as any
            const rows = response.rows
            // The `surrealdb` JS SDK 2.x parses incoming `id` fields into
            // RecordId instances (table + id parts), not plain strings —
            // independent of the server version. Coerce at the boundary so
            // downstream code (sessionKey, queries.updateSession) can rely on
            // a string. Without this, the second saveSession of a session
            // throws "sessionId.indexOf is not a function".
            const rawId = rows[0]?.id
            const newId = rawId != null ? String(rawId) : null
            if (newId) {
                _currentSessionId = newId
            }
            return newId || ''
        }
    } finally {
        _saveInProgress = false
    }
}

export async function listSessionsFromSurreal(limit: number = 50): Promise<any[]> {
    const response = await getBackend().data.query(queries.listSessions({ limit })) as any
    return response.rows
}

export async function loadSessionFromSurreal(sessionId: string): Promise<any | null> {
    const response = await getBackend().data.query(queries.loadSession(sessionId)) as any
    const rows = response.rows
    return rows.length > 0 ? rows[0] : null
}

export async function searchSessionsInSurreal(searchQuery: string, limit: number = 20): Promise<any[]> {
    const response = await getBackend().data.query(queries.searchSessions({ query: searchQuery, limit })) as any
    return response.rows
}

export async function deleteSessionFromSurreal(sessionId: string): Promise<boolean> {
    await getBackend().data.query(queries.deleteSession(sessionId))
    return true
}

// ── SCM Module ───────────────────────────────────────────────────────────────

const SESSIONS_SYSTEM_MSG = `
## Sessions

Conversation sessions are automatically saved after every turn. You can browse, search, and restore past sessions.

### Available functions:
- list_sessions: Get recent sessions with metadata (label, message count, timestamps)
- search_sessions: Search sessions by keyword across labels and conversation content
- read_session: Read the full conversation history of a specific session
- activate_session: Restore a previous session, replacing the current conversation. The current session is auto-saved first. Cannot be used mid-turn.

Session labels are derived from the first user message in the conversation.
`

export function createSessionsModule() {
    return {
        id: 'sessions',
        name: 'Sessions',
        position: 48,
        system_msg: SESSIONS_SYSTEM_MSG,
        functions: [
            {
                enabled: true,
                description: `List recent saved sessions with metadata, ordered by most recently updated.`,
                name: 'list_sessions',
                return_shape: `Array of session summary rows: [{ id: string, label: string, message_count: number, chat_history: any[], workspace: object, ts: string, local_date: string, local_tz: string, created_at: string, updated_at: string }]. Sorted updated_at DESC. Empty array if no sessions saved.`,
                parameters: { limit: 'number' },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { limit } = ops.params
                    const n = Number(limit) || 20
                    log(`list_sessions: fetching up to ${n} sessions`)
                    return listSessionsFromSurreal(n)
                },
                return_type: 'array'
            },
            {
                enabled: true,
                description: `Search session labels and conversation content by keyword.`,
                name: 'search_sessions',
                return_shape: `Array of matching session rows (same shape as list_sessions). Missing arg: { error: 'query is required' }.`,
                parameters: { query: 'string', limit: 'number' },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { query, limit } = ops.params
                    if (!query || !query.trim()) return { error: 'query is required' }
                    const n = Number(limit) || 10
                    log(`search_sessions: "${query}" (limit ${n})`)
                    return searchSessionsInSurreal(query.trim(), n)
                },
                return_type: 'array'
            },
            {
                enabled: true,
                description: `Read the full conversation history and workspace of a specific session by id.`,
                name: 'read_session',
                return_shape: `Full session record: { id: string, label: string, message_count: number, chat_history: any[], workspace: object, thought_history?: any[], execution_history?: any[], settings?: object, ts: string, local_date: string, local_tz: string }. Truncates very large arrays before returning. Errors: { error: 'session_id is required' } or { error: 'Session not found' }.`,
                parameters: { session_id: 'string' },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { session_id } = ops.params
                    if (!session_id) return { error: 'session_id is required' }
                    log(`read_session: ${session_id}`)
                    const session = await loadSessionFromSurreal(session_id)
                    if (!session) return { error: `Session not found: ${session_id}` }
                    // Truncate chat_history to last 50 messages to avoid context overflow
                    if (session.chat_history && session.chat_history.length > 50) {
                        session.chat_history = session.chat_history.slice(-50)
                    }
                    return session
                },
                return_type: 'object'
            },
            {
                enabled: true,
                description: `Restore a previous session, replacing the current conversation. The current session is auto-saved first.`,
                name: 'activate_session',
                return_shape: `Success: { activated: true, label: string, message_count: number }. Errors: { error: 'session_id is required' }, { error: 'Session not found' }, or { error: string } on activation failure.`,
                parameters: { session_id: 'string' },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { session_id } = ops.params
                    if (!session_id) return { error: 'session_id is required' }

                    log(`activate_session: ${session_id}`)

                    // Load session data to verify it exists
                    const session = await loadSessionFromSurreal(session_id)
                    if (!session) return { error: `Session not found: ${session_id}` }

                    // We can't fully activate mid-turn (agent is currently executing),
                    // but we can prepare the activation. The store's loadSession will
                    // handle the state swap and agent message sync.
                    try {
                        // Dynamic import to avoid circular dependency
                        const { useSmartChatsStore } = await import('../store/useSmartChatsStore')
                        await useSmartChatsStore.getState().loadSession(session_id)
                        return {
                            activated: true,
                            label: session.label,
                            message_count: session.message_count,
                        }
                    } catch (err: any) {
                        return { error: `Failed to activate session: ${err.message || err}` }
                    }
                },
                return_type: 'object'
            },
        ],
    }
}
