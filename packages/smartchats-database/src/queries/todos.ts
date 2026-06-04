/**
 * Todo query builders.
 *
 * Todos are stored under `user_data` with `type = 'todo'`. The `data`
 * field holds the structured payload (title, description, priority,
 * due_date, recurrence). Sort by `lts DESC` (most recently
 * created/updated first); `data.due_date` was the previous sort but
 * SurrealDB requires special handling for nested-field ORDER BY and
 * many todos lack a due_date entirely, which silently broke the
 * legacy in-MCP query.
 */

import type { QuerySpec, AuditFields, EventTimeFields } from '../types.js';

export type TodoStatus = 'active' | 'completed' | 'cancelled' | 'deferred';

export interface TodoRow extends AuditFields {
    id: string;
    type: 'todo';
    status: TodoStatus;
    /** Structured payload — title, description, priority, due_date, recurrence, etc. */
    data: Record<string, unknown>;
    source_text?: string;
    tags?: string[];
}

export interface GetTodosArgs {
    /** Filter by status. Default: active. */
    status?: TodoStatus;
    limit?: number;
}

/**
 * Active todos (or filtered by status). Sort by `ts DESC` (real-UTC
 * creation time) so newest additions surface first. Consumers wanting
 * due-date-ordered output should sort the result rows client-side after
 * filtering for ones that have a due_date set.
 */
export function getTodos(args: GetTodosArgs = {}): QuerySpec {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const status: TodoStatus = args.status ?? 'active';
    return {
        query: `SELECT id, type, status, data, source_text, ts, local_date, local_tz, tags, created_at, updated_at FROM user_data WHERE type = 'todo' AND status = $status ORDER BY ts DESC LIMIT ${limit}`,
        variables: { status },
    };
}

/**
 * All active todos with full row payload, ordered by due date. Used by the
 * in-app todos context fetcher to bucket overdue / due-today / upcoming.
 */
export function getAllActiveTodos(): QuerySpec {
    return {
        query: `SELECT * FROM user_data WHERE type = 'todo' AND status = 'active' ORDER BY data.due_date ASC`,
        variables: {},
    };
}

/**
 * Completion records for a single todo within a real-time window. Used
 * by recurrence evaluation ("is this due in the current period?").
 * `start`/`end` are real-UTC ISO datetimes — caller computes them from
 * the user's tz-aware period bounds. Filter is on `ts` (real-UTC instant)
 * because the caller's bounds are real-UTC.
 */
export function getCompletionsInPeriod(args: { parentId: string; start: string; end: string }): QuerySpec {
    return {
        query: `SELECT * FROM user_data WHERE type = 'todo_completion' AND parent_id = $pid AND ts >= <datetime> $start AND ts <= <datetime> $end`,
        variables: { pid: args.parentId, start: args.start, end: args.end },
    };
}

/**
 * The most recent completion record for a todo (one row, ordered by real
 * UTC `timestamp` desc). Used by interval-based recurrence to compute days
 * since last completion.
 */
export function getLastCompletion(args: { parentId: string }): QuerySpec {
    return {
        query: `SELECT * FROM user_data WHERE type = 'todo_completion' AND parent_id = $pid ORDER BY timestamp DESC LIMIT 1`,
        variables: { pid: args.parentId },
    };
}

/**
 * Fetch a single todo (or any user_data record) by its full record id
 * (e.g. `user_data:abc123`). Returns the row.
 */
export function getTodoById(recordId: string): QuerySpec {
    const key = recordId.includes(':') ? recordId.slice(recordId.indexOf(':') + 1) : recordId;
    return {
        query: `SELECT * FROM type::record('user_data', $key)`,
        variables: { key },
    };
}

/**
 * INSERT a new todo row into `user_data`.
 *
 * `timestamp` is the real-UTC due time (or now if no due date). `lts` is
 * the logical fake-UTC local-wall-clock at write time. Both are passed in
 * pre-stringified ISO form; the cast happens server-side.
 */
/**
 * `due_at` (real UTC due time) is distinct from the bundle's `ts`
 * (real UTC creation time) for this builder — a todo can be created
 * today with a due date next week. Both are passed explicitly.
 */
export interface InsertTodoArgs extends EventTimeFields {
    title: string;
    description: string | null;
    priority: string;
    category: string;
    due_date: string | null;
    recurrence: unknown | null;
    metric_link: string | null;
    source_text: string;
    /** Real-UTC ISO datetime — due time if set, else equals `ts` (creation). */
    due_at: string;
    tags: unknown[];
}
export function insertTodo(args: InsertTodoArgs): QuerySpec {
    return {
        query: `INSERT INTO user_data {
            type: 'todo',
            status: 'active',
            data: {
                title: $title,
                description: $description,
                priority: $priority,
                category: $category,
                due_date: $due_date,
                recurrence: $recurrence,
                metric_link: $metric_link
            },
            source_text: $source_text,
            parent_id: NONE,
            due_at: <datetime> $due_at,
            ts: <datetime> $ts,
            local_date: <string> $local_date,
            local_tz: <string> $local_tz,
            tags: $tags,
            created_at: time::now(),
            updated_at: time::now()
        }`,
        variables: { ...args },
    };
}

/**
 * INSERT a completion record linked to a todo. `parent_id` is the full
 * todo record id (e.g. `user_data:abc123`).
 */
/**
 * For completion records, the bundle's `ts` IS the completion time —
 * there's no separate due time to worry about.
 */
export interface InsertTodoCompletionArgs extends EventTimeFields {
    parent_id: string;
    note: string | null;
}
export function insertTodoCompletion(args: InsertTodoCompletionArgs): QuerySpec {
    return {
        query: `INSERT INTO user_data {
            type: 'todo_completion',
            status: 'completed',
            data: { note: $note },
            source_text: '',
            parent_id: $parent_id,
            ts: <datetime> $ts,
            local_date: <string> $local_date,
            local_tz: <string> $local_tz,
            tags: [],
            created_at: time::now(),
            updated_at: time::now()
        }`,
        variables: { ...args },
    };
}

/**
 * UPDATE the top-level `status` field of a todo (cancel / defer / complete).
 * Always bumps `updated_at`.
 */
export function setTodoStatus(args: { recordId: string; status: TodoStatus }): QuerySpec {
    const key = args.recordId.includes(':') ? args.recordId.slice(args.recordId.indexOf(':') + 1) : args.recordId;
    return {
        query: `UPDATE type::record('user_data', $key) SET status = $status, updated_at = time::now()`,
        variables: { key, status: args.status },
    };
}

/**
 * Reschedule a todo: optionally set a new due date and/or recurrence rule.
 * At least one of the two must be present — caller validates.
 *
 * `timestamp` is bumped to the new due date when provided (the schema
 * keeps a parallel `timestamp` field to make recurring + ordering work).
 */
export function rescheduleTodo(args: {
    recordId: string;
    new_due_date?: string;
    new_recurrence?: unknown;
}): QuerySpec | null {
    const key = args.recordId.includes(':') ? args.recordId.slice(args.recordId.indexOf(':') + 1) : args.recordId;
    const setClauses: string[] = ['updated_at = time::now()'];
    const variables: Record<string, unknown> = { key };

    if (args.new_due_date) {
        setClauses.push('data.due_date = $new_due_date');
        setClauses.push('timestamp = <datetime> $new_due_date');
        variables.new_due_date = args.new_due_date;
    }
    if (args.new_recurrence !== undefined) {
        setClauses.push('data.recurrence = $new_recurrence');
        variables.new_recurrence = args.new_recurrence;
    }
    if (setClauses.length === 1) return null; // caller handles "nothing to update"
    return {
        query: `UPDATE type::record('user_data', $key) SET ${setClauses.join(', ')}`,
        variables,
    };
}

/**
 * Edit an existing todo's `data.<field>` projections. Only whitelisted
 * keys are accepted; unknown keys are silently dropped (caller decides
 * whether to surface a "no valid fields" error). When `due_date` is in
 * the patch, the parallel top-level `timestamp` is also updated.
 */
const EDITABLE_TODO_FIELDS = [
    'title', 'description', 'priority', 'category',
    'due_date', 'recurrence', 'metric_link',
] as const;
export function editTodo(args: {
    recordId: string;
    updates: Record<string, unknown>;
}): QuerySpec | null {
    const key = args.recordId.includes(':') ? args.recordId.slice(args.recordId.indexOf(':') + 1) : args.recordId;
    const setClauses: string[] = ['updated_at = time::now()'];
    const variables: Record<string, unknown> = { key };

    for (const field of EDITABLE_TODO_FIELDS) {
        if (field in args.updates) {
            setClauses.push(`data.${field} = $${field}`);
            variables[field] = args.updates[field];
        }
    }
    if (args.updates.due_date) {
        setClauses.push('timestamp = <datetime> $due_date_top');
        variables.due_date_top = args.updates.due_date;
    }
    if (setClauses.length === 1) return null;
    return {
        query: `UPDATE type::record('user_data', $key) SET ${setClauses.join(', ')}`,
        variables,
    };
}

/**
 * DELETE all completion records linked to a todo (cleanup before
 * deleting the todo itself).
 */
export function deleteCompletionsForTodo(args: { parentId: string }): QuerySpec {
    return {
        query: `DELETE FROM user_data WHERE type = 'todo_completion' AND parent_id = $pid`,
        variables: { pid: args.parentId },
    };
}

/**
 * DELETE a single user_data record by full id.
 */
export function deleteTodoById(recordId: string): QuerySpec {
    const key = recordId.includes(':') ? recordId.slice(recordId.indexOf(':') + 1) : recordId;
    return {
        query: `DELETE type::record('user_data', $key)`,
        variables: { key },
    };
}
