/**
 * Todos module: save_todo, manage_todo, get_todos_context
 * Manages user todos via the generic user_data table (type = 'todo').
 * Recurring todos track completions as separate records (type = 'todo_completion').
 *
 * user_data table schema (auto-created on first INSERT):
 *   id          — SurrealDB record ID (user_data:ulid)
 *   type        — "todo" | "todo_completion" | future types
 *   status      — "active" | "completed" | "cancelled" | "deferred" | null
 *   data        — type-specific JSON payload
 *   source_text — original user phrasing
 *   parent_id   — links records (completion → todo)
 *   due_at      — optional real-UTC datetime the todo is due (was: `timestamp`
 *                 pre-v1.0.0; renamed to disambiguate from row lifecycle)
 *   ts          — real-UTC instant the row's event happened (todo creation,
 *                 todo_completion event). OPTIONAL on user_data — config rows
 *                 (metric_definition, log_category_definition) leave it unset.
 *   local_date  — YYYY-MM-DD in the user's tz (paired with ts; OPTIONAL)
 *   local_tz    — IANA timezone (paired with ts; OPTIONAL)
 *   tags        — string array
 *   created_at  — set on insert
 *   updated_at  — set on update
 *
 * Recommended indexes (run manually in SurrealDB):
 *   DEFINE INDEX idx_ud_type_status ON user_data FIELDS type, status;
 *   DEFINE INDEX idx_ud_parent ON user_data FIELDS parent_id;
 *   DEFINE INDEX idx_ud_due_at ON user_data FIELDS due_at;
 */

import { getUserTimezone, nowEventTime } from "./system"
import { getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';
import { getStartupLoaders } from '../lib/background_loaders';

// Event-time bundle helpers live in ./system (nowEventTime / eventTimeAt).

// ── Recurrence logic ─────────────────────────────────────────────────────────

type Recurrence =
    | { freq: 'daily' }
    | { freq: 'weekly'; days: string[] }
    | { freq: 'weekly'; times: number }
    | { freq: 'monthly'; day: number }
    | { freq: 'interval'; every: number; unit: string }

/** Get lowercase 3-letter day name in the user's timezone */
function getDayName(date: Date, tz: string): string {
    return date.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz }).toLowerCase()
}

/** Get start of day in user's local timezone, returned as a real Date */
function getLocalDayStart(date: Date, tz: string): Date {
    const localStr = date.toLocaleDateString('sv-SE', { timeZone: tz }) // "2026-03-26"
    // Parse the local YYYY-MM-DD as midnight UTC. Other helpers in this module
    // do their date math entirely in UTC space (so a "local day start" is
    // represented as midnight-UTC of that local calendar date, never converted
    // back to real-UTC). Consistent with how event-time `local_date` is
    // consumed elsewhere.
    return new Date(localStr + 'T00:00:00Z')
}

function getLocalDayEnd(date: Date, tz: string): Date {
    const localStr = date.toLocaleDateString('sv-SE', { timeZone: tz })
    return new Date(localStr + 'T23:59:59.999Z')
}

/** Get the Monday of the current week in user's tz */
function getWeekStart(date: Date, tz: string): Date {
    const localStr = date.toLocaleDateString('sv-SE', { timeZone: tz })
    const d = new Date(localStr + 'T00:00:00Z')
    const day = d.getUTCDay() // 0=Sun, 1=Mon, ...
    const diff = day === 0 ? 6 : day - 1 // days since Monday
    d.setUTCDate(d.getUTCDate() - diff)
    return d
}

function getWeekEnd(date: Date, tz: string): Date {
    const start = getWeekStart(date, tz)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 6)
    end.setUTCHours(23, 59, 59, 999)
    return end
}

function getMonthStart(date: Date, tz: string): Date {
    const localStr = date.toLocaleDateString('sv-SE', { timeZone: tz })
    const [y, m] = localStr.split('-')
    return new Date(`${y}-${m}-01T00:00:00Z`)
}

function getMonthEnd(date: Date, tz: string): Date {
    const localStr = date.toLocaleDateString('sv-SE', { timeZone: tz })
    const [y, m] = localStr.split('-')
    const nextMonth = new Date(`${y}-${m}-01T00:00:00Z`)
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
    nextMonth.setUTCDate(nextMonth.getUTCDate() - 1)
    nextMonth.setUTCHours(23, 59, 59, 999)
    return nextMonth
}

/**
 * Get the period bounds for a recurrence rule.
 * Returns null for interval-based (uses last-completion check instead).
 */
export function getPeriodBounds(recurrence: Recurrence, now: Date, tz: string): { start: Date; end: Date } | null {
    switch (recurrence.freq) {
        case 'daily':
            return { start: getLocalDayStart(now, tz), end: getLocalDayEnd(now, tz) }
        case 'weekly':
            return { start: getWeekStart(now, tz), end: getWeekEnd(now, tz) }
        case 'monthly':
            return { start: getMonthStart(now, tz), end: getMonthEnd(now, tz) }
        case 'interval':
            return null
        default:
            return null
    }
}

/**
 * Determine if a recurring todo is currently due.
 * @param recurrence - the recurrence rule
 * @param completionsInPeriod - completion records within the current period
 * @param now - current time
 * @param tz - user's IANA timezone
 */
export function isDue(recurrence: Recurrence, completionsInPeriod: any[], now: Date, tz: string): boolean {
    switch (recurrence.freq) {
        case 'daily':
            return completionsInPeriod.length === 0

        case 'weekly':
            if ('days' in recurrence && recurrence.days) {
                const today = getDayName(now, tz)
                if (!recurrence.days.includes(today)) return false
                // Check if already completed today
                const dayStart = getLocalDayStart(now, tz)
                const dayEnd = getLocalDayEnd(now, tz)
                const doneToday = completionsInPeriod.some(c => {
                    const ts = new Date(c.ts)
                    return ts >= dayStart && ts <= dayEnd
                })
                return !doneToday
            }
            if ('times' in recurrence && recurrence.times) {
                return completionsInPeriod.length < recurrence.times
            }
            return false

        case 'monthly':
            if ('day' in recurrence) {
                const localStr = now.toLocaleDateString('sv-SE', { timeZone: tz })
                const todayDay = parseInt(localStr.split('-')[2], 10)
                if (todayDay !== recurrence.day) return false
                const dayStart = getLocalDayStart(now, tz)
                const dayEnd = getLocalDayEnd(now, tz)
                const doneToday = completionsInPeriod.some(c => {
                    const ts = new Date(c.ts)
                    return ts >= dayStart && ts <= dayEnd
                })
                return !doneToday
            }
            return false

        case 'interval':
            if ('every' in recurrence && recurrence.every) {
                if (completionsInPeriod.length === 0) return true // never completed
                // Find the most recent completion
                const sorted = [...completionsInPeriod].sort((a, b) =>
                    new Date(b.ts).getTime() - new Date(a.ts).getTime()
                )
                const lastCompletion = new Date(sorted[0].ts)
                const daysSince = (now.getTime() - lastCompletion.getTime()) / (1000 * 60 * 60 * 24)
                return daysSince >= recurrence.every
            }
            return false

        default:
            return false
    }
}

/** Human-readable recurrence label */
export function formatRecurrenceLabel(recurrence: any): string {
    if (!recurrence || !recurrence.freq) return ''
    switch (recurrence.freq) {
        case 'daily': return 'daily'
        case 'weekly':
            if (recurrence.days) return recurrence.days.join('/')
            if (recurrence.times) return `${recurrence.times}x/week`
            return 'weekly'
        case 'monthly':
            if (recurrence.day) {
                const suffix = recurrence.day === 1 ? 'st' : recurrence.day === 2 ? 'nd' : recurrence.day === 3 ? 'rd' : 'th'
                return `monthly on the ${recurrence.day}${suffix}`
            }
            return 'monthly'
        case 'interval':
            if (recurrence.every && recurrence.unit) return `every ${recurrence.every} ${recurrence.unit}${recurrence.every > 1 ? 's' : ''}`
            return 'recurring'
        default: return 'recurring'
    }
}

/** Get the target count for a times-based recurrence, or undefined */
function getRecurrenceTarget(recurrence: any): number | undefined {
    if (recurrence?.freq === 'weekly' && recurrence.times) return recurrence.times
    return undefined
}

// ── Fetch context ────────────────────────────────────────────────────────────

/** Fetch todos context (summary) — reusable by prefetch and module fn */
export async function fetchTodosContext(): Promise<{
    overdue: any[];
    due_today: any[];
    upcoming_7d: any[];
    no_date: any[];
    total_active: number;
    recurring_due: any[];
}> {
    const tz = getUserTimezone()
    const now = new Date()
    const todayStart = getLocalDayStart(now, tz)
    const todayEnd = getLocalDayEnd(now, tz)
    const weekEnd = new Date(todayEnd)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)

    // Fetch all active todos
    const response = await getBackend().data.query(queries.getAllActiveTodos()) as any
    const todos = response.rows

    const overdue: any[] = []
    const due_today: any[] = []
    const upcoming_7d: any[] = []
    const no_date: any[] = []
    const recurring_due: any[] = []

    for (const todo of todos) {
        const dueDate = todo.data?.due_date ? new Date(todo.data.due_date) : null
        const recurrence = todo.data?.recurrence
        const item = { id: todo.id, title: todo.data?.title, due_date: todo.data?.due_date, priority: todo.data?.priority, category: todo.data?.category }

        // Evaluate recurrence
        if (recurrence && recurrence.freq) {
            const bounds = getPeriodBounds(recurrence, now, tz)
            let completions: any[] = []
            if (bounds) {
                const cRes = await getBackend().data.query(queries.getCompletionsInPeriod({
                    parentId: todo.id,
                    start: bounds.start.toISOString(),
                    end: bounds.end.toISOString(),
                })) as any
                completions = cRes.rows
            } else if (recurrence.freq === 'interval') {
                // For interval, just get the most recent completion
                const cRes = await getBackend().data.query(queries.getLastCompletion({ parentId: todo.id })) as any
                completions = cRes.rows
            }

            if (isDue(recurrence, completions, now, tz)) {
                recurring_due.push({
                    id: todo.id,
                    title: todo.data?.title,
                    pattern: formatRecurrenceLabel(recurrence),
                    done_this_period: completions.length,
                    target: getRecurrenceTarget(recurrence),
                })
            }
        }

        // Categorize by due date
        if (dueDate) {
            if (dueDate < todayStart) {
                overdue.push(item)
            } else if (dueDate >= todayStart && dueDate <= todayEnd) {
                due_today.push(item)
            } else if (dueDate <= weekEnd) {
                upcoming_7d.push(item)
            }
            // Todos with due dates beyond 7 days are counted in total_active but not bucketed
        } else if (!recurrence) {
            // Undated, non-recurring todos
            no_date.push(item)
        }
    }

    return { overdue, due_today, upcoming_7d, no_date, total_active: todos.length, recurring_due }
}

// ── System message ───────────────────────────────────────────────────────────

const TODOS_SYSTEM_MSG = `
## Todos

You can manage the user's todo list. Todos are stored in the user_data table with type "todo".

### Guidelines
- When the user mentions a task, reminder, or action item, save it as a todo
- Extract priority from context: urgent language = "urgent", deadlines = "high", casual = "medium" (default), someday = "low"
- For recurring patterns ("every Monday", "3 times a week", "daily"), set recurrence
- Do NOT ask for confirmation on obvious todos — just save and confirm briefly
- When completing a recurring todo, a completion record is created — the todo stays active for the next occurrence
- When completing: if the todo has a metric_link, also log the metric using save_metric

### Priorities
- urgent: time-sensitive, needs immediate attention
- high: important, has a deadline
- medium: normal importance (default)
- low: nice to have, no deadline pressure

### Recurrence Patterns
- Daily: { "freq": "daily" }
- Specific days: { "freq": "weekly", "days": ["mon", "wed", "fri"] }
- N times per week: { "freq": "weekly", "times": 3 }
- Monthly: { "freq": "monthly", "day": 1 }
- Every N days: { "freq": "interval", "every": 2, "unit": "day" }

### Viewing Todos
Call get_todos_context with display: true to show the interactive todo list visualization. The user can also check off items directly from the visualization.
`

// ── Module ───────────────────────────────────────────────────────────────────

export function createTodosModule() {
    return {
        id: 'todos',
        name: 'Todos',
        position: 44,
        system_msg: TODOS_SYSTEM_MSG,
        functions: [
            // ── save_todo ──
            {
                enabled: true,
                description: `Save a todo item. Supports priority, due date, recurrence rules, and metric linking.`,
                name: 'save_todo',
                return_shape: `Array of inserted todo row(s): [{ id: string, type: 'todo', status: 'active', data: { title, description?, priority?, recurrence? }, due_at?: string, ts: string, local_date: string }]. On error: { error: 'title is required' } or similar.`,
                parameters: {
                    title: 'string',
                    description: 'string',
                    priority: 'string',
                    category: 'string',
                    due_date: 'string',
                    recurrence: 'object',
                    metric_link: 'string',
                    source_text: 'string',
                    tags: 'array',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { title, description, priority, category, due_date, recurrence, metric_link, source_text, tags } = ops.params

                    if (!title || !title.trim()) {
                        return { error: 'title is required' }
                    }

                    log(`Saving todo: ${title}`)

                    const eventTime = nowEventTime()
                    // Due date is a separate semantic from creation time;
                    // falls back to creation `ts` when no due_date was given.
                    const dueTs = due_date && due_date.trim() ? due_date.trim() : null

                    const response = await getBackend().data.query(queries.insertTodo({
                        title: title.trim(),
                        description: description || null,
                        priority: priority || 'medium',
                        category: category || 'general',
                        due_date: dueTs,
                        recurrence: recurrence || null,
                        metric_link: metric_link || null,
                        source_text: source_text || '',
                        due_at: dueTs || eventTime.ts,
                        ...eventTime,
                        tags: tags || [],
                    })) as any
                    log(`save_todo response received`)
                    log(JSON.stringify(response?.data?.result?.result || response?.data))

                    try {
                        const stmts = response?.data?.result?.result
                        const stmt = Array.isArray(stmts) ? stmts[0] : stmts
                        if (stmt?.status === 'ERR') {
                            return { saved: false, error: `DB error: ${stmt.result}` }
                        }
                        const rows = response.rows
                        return rows.length > 0
                            ? { saved: true, id: rows[0]?.id != null ? String(rows[0].id) : null, title: title.trim(), priority: priority || 'medium', due_date: dueTs, recurrence: recurrence || null }
                            : { saved: false, error: 'No result from DB' }
                    } catch (error: any) {
                        return { error: `Error saving todo: ${JSON.stringify(error)}` }
                    }
                },
                return_type: 'object'
            },

            // ── manage_todo ──
            {
                enabled: true,
                description: `Manage a todo by id. Actions: complete, cancel, defer, reschedule, edit, delete.`,
                name: 'manage_todo',
                return_shape: `Shape depends on the action arg. complete: { completed: true, id, had_recurrence: boolean, title }. cancel: { cancelled: true, id }. defer: { deferred: true, id }. reschedule: { rescheduled: true, id, new_due_date?, new_recurrence? }. edit: { edited: true, id, updated_fields: string[] }. delete: { deleted: true, id }. Error variants: { error: string }.`,
                parameters: {
                    id: 'string',
                    action: 'string',
                    note: 'string',
                    updates: 'object',
                    new_due_date: 'string',
                    new_recurrence: 'object',
                },
                fn: async (ops: any) => {
                    const { log, event } = ops.util
                    const { id, action, note, updates, new_due_date, new_recurrence } = ops.params

                    if (!id) return { error: 'id is required' }
                    if (!action) return { error: 'action is required' }

                    // Helper: refresh the todo viz in place after any mutation
                    const refreshViz = async () => {
                        try {
                            const fresh = await fetchTodosContext()
                            event({ type: 'visualization_update', vizType: 'todo_list', props: fresh, vizId: 'todos' })
                        } catch { /* best effort */ }
                    }

                    const eventTime = nowEventTime()

                    log(`manage_todo: ${action} on ${id}`)

                    switch (action) {
                        case 'complete': {
                            // First, fetch the todo to check for recurrence
                            const fetchRes = await getBackend().data.query(queries.getTodoById(id)) as any
                            const todo = fetchRes.rows[0]

                            if (!todo) return { error: `Todo not found: ${id}` }

                            const hasRecurrence = !!todo.data?.recurrence?.freq

                            // Create completion record
                            await getBackend().data.query(queries.insertTodoCompletion({
                                parent_id: id,
                                note: note || null,
                                ...eventTime,
                            }))

                            // For non-recurring: mark the todo itself as completed
                            if (!hasRecurrence) {
                                await getBackend().data.query(queries.setTodoStatus({ recordId: id, status: 'completed' }))
                            }

                            log(`Todo ${hasRecurrence ? 'completion logged' : 'completed'}: ${id}`)
                            await refreshViz()
                            return { completed: true, id, had_recurrence: hasRecurrence, title: todo.data?.title }
                        }

                        case 'cancel': {
                            await getBackend().data.query(queries.setTodoStatus({ recordId: id, status: 'cancelled' }))
                            log(`Todo cancelled: ${id}`)
                            await refreshViz()
                            return { cancelled: true, id }
                        }

                        case 'defer': {
                            await getBackend().data.query(queries.setTodoStatus({ recordId: id, status: 'deferred' }))
                            log(`Todo deferred: ${id}`)
                            await refreshViz()
                            return { deferred: true, id }
                        }

                        case 'reschedule': {
                            const spec = queries.rescheduleTodo({ recordId: id, new_due_date, new_recurrence })
                            if (!spec) return { error: 'Provide new_due_date and/or new_recurrence to reschedule' }
                            await getBackend().data.query(spec)
                            log(`Todo rescheduled: ${id}`)
                            await refreshViz()
                            return { rescheduled: true, id, new_due_date, new_recurrence }
                        }

                        case 'edit': {
                            if (!updates || typeof updates !== 'object') return { error: 'updates object is required for edit action' }
                            const spec = queries.editTodo({ recordId: id, updates })
                            if (!spec) return { error: 'No valid fields to update' }
                            await getBackend().data.query(spec)
                            log(`Todo edited: ${id}`)
                            await refreshViz()
                            return { edited: true, id, updated_fields: Object.keys(updates) }
                        }

                        case 'delete': {
                            await getBackend().data.query(queries.deleteCompletionsForTodo({ parentId: id }))
                            await getBackend().data.query(queries.deleteTodoById(id))
                            log(`Todo deleted: ${id}`)
                            await refreshViz()
                            return { deleted: true, id }
                        }

                        default:
                            return { error: `Unknown action: ${action}. Use: complete, cancel, defer, reschedule, edit, delete` }
                    }
                },
                return_type: 'object'
            },

            // ── get_todos_context ──
            {
                enabled: true,
                description: `Get todo context (overdue, due today, upcoming, recurring due). Pass display:true to show the interactive todo list.`,
                name: 'get_todos_context',
                return_shape: `{ overdue: Todo[], due_today: Todo[], upcoming_7d: Todo[], no_date: Todo[], recurring_due: Todo[], total_active: number } where Todo = { id: string, title: string, description?: string, priority?: string, due_at?: string, recurrence?: object, ts: string }. Use total_active for count of all active todos.`,
                parameters: {
                    display: 'boolean',
                    category: 'string',
                },
                fn: async (ops: any) => {
                    const { log, event } = ops.util
                    const { display, category } = ops.params

                    log(`Fetching todos context${display ? ' (with display)' : ''}`)
                    const loaders = getStartupLoaders()
                    let context = loaders ? await loaders.todos_context.get() : await fetchTodosContext()

                    // Filter by category if provided
                    if (category) {
                        const cat = category.toLowerCase().trim()
                        context = {
                            ...context,
                            overdue: context.overdue.filter((t: any) => t.category === cat),
                            due_today: context.due_today.filter((t: any) => t.category === cat),
                            upcoming_7d: context.upcoming_7d.filter((t: any) => t.category === cat),
                            // recurring_due doesn't have category in summary, keep as-is
                            recurring_due: context.recurring_due,
                        }
                    }

                    log(`Got todos context: ${context.total_active} active`)

                    if (display) {
                        event({
                            type: 'visualization_update',
                            vizType: 'todo_list',
                            props: context,
                            vizId: 'todos',
                        })
                    }

                    return context
                },
                return_type: 'object'
            },
        ],
    }
}
