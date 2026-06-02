/**
 * Logging module: save_log, get_recent_logs, search_logs, search_logs_semantic,
 * get_log_categories, show_logs_grid
 *
 * Central log creation and retrieval. All writes compute `lts` (local timestamp)
 * automatically so day-bucketed queries use the user's wall-clock day.
 *
 * Log schema (embedding omitted):
 *   id          — SurrealDB record ID (e.g. logs:abc123)
 *   content     — the log text
 *   category    — lowercase string (general, water, exercise, etc.)
 *   embedding   — vector (auto-computed on save)
 *   created_at  — real UTC datetime (auto by DB)
 *   updated_at  — real UTC datetime (auto by DB)
 *   lts         — local timestamp as fake-UTC datetime (user's wall clock with Z suffix)
 *   local_tz    — IANA timezone name (e.g. America/Chicago)
 *   owner       — user record ID (auto by DB)
 */

import { embed_vector, getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';
import { getUserTimezone, toLocalTimestamp, nowEventTime, getCurrentLocalDate } from './system';

/** Fetch log categories with counts — reusable by prefetch and module fn */
export async function fetchLogCategories(): Promise<any[]> {
    const [response, preparedRes] = await Promise.all([
        getBackend().data.query(queries.getLogCategories()) as any,
        getBackend().data.query(queries.getPreparedLogCategories()).catch(() => []) as any,
    ])
    const categories = response.rows
    const prepared = preparedRes.rows
    // Merge prepared categories that don't yet have actual entries
    const existing = new Set(categories.map((c: any) => c.category))
    for (const p of prepared) {
        if (!existing.has(p.data?.category)) {
            categories.push({ category: p.data.category, count: 0, prepared: true, description: p.data.description })
        }
    }
    return categories
}

/** Build an lts range filter for a date, date range, or recency duration */
function buildLtsFilter(params: { date?: string; from_date?: string; to_date?: string; recency?: string }, tz: string): string {
    if (params.recency) {
        // e.g. "5h", "2d", "1w" — compute lts cutoff
        const match = params.recency.match(/^(\d+)(h|d|w)$/)
        if (!match) return ''
        const amount = parseInt(match[1])
        const unit = match[2]
        const ms = unit === 'h' ? amount * 3600000 : unit === 'd' ? amount * 86400000 : amount * 604800000
        const cutoff = toLocalTimestamp(new Date(Date.now() - ms), tz)
        return ` AND lts >= d'${cutoff}'`
    }

    if (params.date) {
        return ` AND lts >= d'${params.date}T00:00:00Z' AND lts <= d'${params.date}T23:59:59Z'`
    }

    if (params.from_date) {
        const to = params.to_date || getCurrentLocalDate(tz)
        return ` AND lts >= d'${params.from_date}T00:00:00Z' AND lts <= d'${to}T23:59:59Z'`
    }

    return ''
}

// ── System message ───────────────────────────────────────────────────────────

const LOGGING_SYSTEM_MSG = `
## Logging

Logs are the user's personal journal. Each log has: content (text), category (lowercase string), and timestamps.

### Creating Logs
- Use accumulate_text() first to collect the full log text, then save_log() to persist it.
- Always use lowercase for categories (e.g. "general", "water", "exercise", "dreams").
- "captain's log" means category "general".
- Do not manually set timestamps — save_log handles them automatically.

### Querying Logs
All log query functions accept these optional filters:
- category: filter by category
- date: a single local date like "2026-03-20" (the user's calendar day, not UTC)
- from_date / to_date: a local date range
- recency: a duration like "5h", "2d", "1w" for recent logs
- limit: max results (default varies by function)

When the user says "yesterday", "last week", etc., resolve it relative to the current local date shown in the [Timing] block, then pass the local date string to the function. Do NOT write raw SurrealQL for log queries — use the provided functions.

### Preparing Categories (No Entries Yet)
Use prepare_log_category when the user says they WANT to journal about something but hasn't written anything yet (e.g. during onboarding: "I want to keep a dream journal"). This registers the category so it appears in future get_log_categories calls.
`

// ── Module ───────────────────────────────────────────────────────────────────

export function createLoggingModule() {
    return {
        id: 'logging',
        name: 'Logging',
        position: 22,
        system_msg: LOGGING_SYSTEM_MSG,
        functions: [
            // ── save_log ──
            {
                enabled: true,
                description: `Save a journal/log entry with category. Auto-embeds for semantic search.`,
                name: 'save_log',
                parameters: {
                    text: 'string',
                    category: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { text, category } = ops.params

                    if (!text || !text.trim()) {
                        return { error: 'text is required' }
                    }

                    const cat = (category || 'general').toLowerCase().trim()
                    log(`Saving log: category=${cat}, length=${text.length}`)

                    // Compute embedding
                    let embedding: any
                    try {
                        embedding = await embed_vector(text)
                    } catch (err: any) {
                        log(`Embedding failed: ${err}`)
                        embedding = null
                    }

                    const response = await getBackend().data.query(queries.insertLog({
                        content: text,
                        category: cat,
                        embedding: embedding,
                        ...nowEventTime(),
                    })) as any
                    const rows = response.rows
                    log(`Log saved`)
                    return rows.length > 0 ? { saved: true, id: rows[0]?.id, category: cat } : { saved: false, error: 'No result from DB' }
                },
                return_type: 'object'
            },

            // ── update_log ──
            {
                enabled: true,
                description: `Update log content, category, or timestamp. Re-embeds on content change.`,
                name: 'update_log',
                parameters: {
                    id: 'string',
                    text: 'string',
                    category: 'string',
                    date: 'string',
                    time: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { id, text, category, date, time } = ops.params

                    if (!id) return { error: 'id is required' }

                    const patch: {
                        content?: string
                        embedding?: unknown
                        category?: string
                        lts?: string
                        local_tz?: string
                    } = {}

                    if (text !== undefined && text !== null) {
                        patch.content = text

                        // Recompute embedding for new content
                        try {
                            patch.embedding = await embed_vector(text)
                        } catch (err: any) {
                            log(`Embedding update failed: ${err}`)
                        }
                    }

                    if (category !== undefined && category !== null) {
                        patch.category = category.toLowerCase().trim()
                    }

                    if (date) {
                        // date/time are already local — format directly as fake-UTC lts
                        const timeStr = time || '12:00'
                        patch.lts = `${date}T${timeStr}:00Z`
                        patch.local_tz = getUserTimezone()
                    }

                    const spec = queries.updateLog({ recordId: id, patch })
                    if (!spec) return { updated: false, error: 'No fields to update' }

                    log(`update_log: ${id}`)

                    const response = await getBackend().data.query(spec) as any
                    const rows = response.rows
                    return rows.length > 0 ? { updated: true, id } : { updated: false, error: 'Log not found' }
                },
                return_type: 'object'
            },

            // ── get_recent_logs ──
            {
                enabled: true,
                description: `Get recent logs with optional category/date filtering.`,
                name: 'get_recent_logs',
                parameters: {
                    category: 'string',
                    date: 'string',
                    from_date: 'string',
                    to_date: 'string',
                    recency: 'string',
                    limit: 'number',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { category, date, from_date, to_date, recency, limit } = ops.params
                    const n = Number(limit) || 20
                    const tz = getUserTimezone()

                    const ltsFilter = buildLtsFilter({ date, from_date, to_date, recency }, tz)

                    const spec = queries.listLogs({
                        category: category ? category.toLowerCase().trim() : undefined,
                        ltsFilter,
                        limit: n,
                    })
                    log(`get_recent_logs: ${spec.query}`)

                    const response = await getBackend().data.query(spec) as any
                    return response.rows
                },
                return_type: 'array'
            },

            // ── search_logs ──
            {
                enabled: true,
                description: `Search logs by text substring (case-insensitive). Optional category/date filter.`,
                name: 'search_logs',
                parameters: {
                    text: 'string',
                    category: 'string',
                    date: 'string',
                    from_date: 'string',
                    to_date: 'string',
                    recency: 'string',
                    limit: 'number',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { text, category, date, from_date, to_date, recency, limit } = ops.params
                    const n = Number(limit) || 20
                    const tz = getUserTimezone()

                    if (!text || !text.trim()) {
                        return { error: 'text is required' }
                    }

                    const ltsFilter = buildLtsFilter({ date, from_date, to_date, recency }, tz)

                    const spec = queries.listLogs({
                        category: category ? category.toLowerCase().trim() : undefined,
                        ltsFilter,
                        searchText: text.trim(),
                        limit: n,
                    })
                    log(`search_logs: ${spec.query}`)

                    const response = await getBackend().data.query(spec) as any
                    return response.rows
                },
                return_type: 'array'
            },

            // ── search_logs_semantic ──
            {
                enabled: true,
                description: `Semantic search: find logs by meaning, ranked by similarity.`,
                name: 'search_logs_semantic',
                parameters: {
                    text: 'string',
                    category: 'string',
                    limit: 'number',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { text, category, limit } = ops.params
                    const n = Number(limit) || 10

                    if (!text || !text.trim()) {
                        return { error: 'text is required' }
                    }

                    log(`search_logs_semantic: computing embedding for "${text.slice(0, 50)}"`)
                    const embedding = await embed_vector(text)

                    const spec = queries.searchLogsSemantic({
                        embedding,
                        category: category ? category.toLowerCase().trim() : undefined,
                        limit: n,
                    })
                    log(`search_logs_semantic: ${spec.query}`)

                    const response = await getBackend().data.query(spec) as any
                    return response.rows
                },
                return_type: 'array'
            },

            // ── get_log_categories ──
            {
                enabled: true,
                description: `List all log categories with entry counts.`,
                name: 'get_log_categories',
                parameters: null,
                fn: async (ops: any) => {
                    const { log } = ops.util
                    log(`get_log_categories`)
                    return fetchLogCategories()
                },
                return_type: 'array'
            },

            // ── show_logs_grid ──
            {
                enabled: true,
                description: `Display logs in an interactive visual grid with hover-to-expand.`,
                name: 'show_logs_grid',
                parameters: {
                    category: 'string',
                    limit: 'number',
                },
                fn: async (ops: any) => {
                    const { log, event } = ops.util
                    const { category, limit } = ops.params
                    const n = Number(limit) || 12

                    const spec = queries.listLogs({
                        category: category ? category.toLowerCase().trim() : undefined,
                        limit: n,
                    })
                    const response = await getBackend().data.query(spec) as any
                    const logs = response.rows

                    if (logs.length === 0) {
                        return { displayed: 0, message: 'No logs found.' }
                    }

                    // Build interactive HTML grid
                    const tz = getUserTimezone()
                    const cards = logs.map((entry: any) => {
                        const d = entry.lts ? new Date(entry.lts) : new Date(entry.created_at)
                        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
                        const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
                        const preview = (entry.content || '').slice(0, 80)
                        const full = (entry.content || '').replace(/'/g, "\\'").replace(/\n/g, ' ')
                        return `<div style="background:var(--sc-surface-secondary,#1a1a2e);border-radius:8px;padding:12px;cursor:pointer;transition:all 0.2s;min-height:80px;display:flex;flex-direction:column;gap:4px;" onmouseover="this.querySelector('.full').style.display='block';this.querySelector('.preview').style.display='none'" onmouseout="this.querySelector('.full').style.display='none';this.querySelector('.preview').style.display='block'"><div style="font-size:11px;color:var(--sc-text-muted,#888);display:flex;justify-content:space-between;"><span>${dateStr} ${timeStr}</span><span style="text-transform:uppercase;letter-spacing:0.5px;">${entry.category || ''}</span></div><div class="preview" style="font-size:13px;color:var(--sc-text,#e0e0e0);line-height:1.4;">${preview}${(entry.content || '').length > 80 ? '...' : ''}</div><div class="full" style="display:none;font-size:13px;color:var(--sc-text,#e0e0e0);line-height:1.4;">${full}</div></div>`
                    }).join('')

                    const html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;padding:8px;font-family:system-ui,sans-serif;">${cards}</div>`
                    event({ type: 'html_update', html })

                    return { displayed: logs.length }
                },
                return_type: 'object'
            },

            // ── prepare_log_category ──
            {
                enabled: true,
                description: `Register a log category the user intends to use, without creating an actual log entry. Use during onboarding or when the user says "I want to journal about X" but hasn't written anything yet. This makes the category visible in get_log_categories so you know about it on future sessions.`,
                name: 'prepare_log_category',
                parameters: {
                    category: 'string',
                    description: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    let { category, description } = ops.params

                    if (!category) return { error: 'category is required' }
                    category = category.trim().toLowerCase()

                    log(`Preparing log category: ${category}`)

                    // Check if already exists in logs table
                    const existsRes = await getBackend().data.query(queries.findLogByCategory(category)) as any
                    if (existsRes.rows.length > 0) {
                        return { ok: true, category, already_exists: true }
                    }

                    // Check if already prepared
                    const prepRes = await getBackend().data.query(queries.findPreparedLogCategory(category)) as any
                    if (prepRes.rows.length > 0) {
                        return { ok: true, category, already_prepared: true }
                    }

                    await getBackend().data.query(queries.insertPreparedLogCategory({
                        category,
                        description: description || '',
                    }))

                    return { ok: true, category, description: description || '', prepared: true }
                },
                return_type: 'object'
            },
        ],
    }
}
