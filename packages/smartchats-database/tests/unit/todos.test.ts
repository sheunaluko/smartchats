import { describe, it, expect } from 'vitest';
import {
    getTodos,
    getTodoById,
    setTodoStatus,
    deleteTodoById,
    rescheduleTodo,
    editTodo,
    insertTodo,
} from '../../src/queries/index.js';

describe('getTodos', () => {
    it('defaults to active todos sorted by lts DESC with a 50-row cap', () => {
        const spec = getTodos();
        expect(spec.query).toContain("type = 'todo'");
        expect(spec.query).toContain('status = $status');
        expect(spec.query).toContain('ORDER BY lts DESC');
        expect(spec.query).toMatch(/LIMIT 50$/);
        expect(spec.variables).toEqual({ status: 'active' });
    });

    it('clamps the limit to the 1..200 range', () => {
        expect(getTodos({ limit: 9999 }).query).toMatch(/LIMIT 200$/);
        expect(getTodos({ limit: 0 }).query).toMatch(/LIMIT 1$/);
    });

    it('binds an explicit status filter', () => {
        expect(getTodos({ status: 'completed' }).variables).toEqual({ status: 'completed' });
    });
});

describe('record-id prefix handling', () => {
    it('strips the table prefix off a full record id', () => {
        expect(getTodoById('user_data:abc').variables.key).toBe('abc');
        expect(setTodoStatus({ recordId: 'user_data:abc', status: 'cancelled' }).variables.key).toBe('abc');
        expect(deleteTodoById('user_data:abc').variables.key).toBe('abc');
    });

    it('leaves a bare id untouched and splits on the first colon only', () => {
        expect(getTodoById('abc').variables.key).toBe('abc');
        expect(getTodoById('user_data:a:b').variables.key).toBe('a:b');
    });
});

describe('setTodoStatus', () => {
    it('bumps updated_at alongside the status change', () => {
        const spec = setTodoStatus({ recordId: 'user_data:x', status: 'deferred' });
        expect(spec.query).toContain('status = $status');
        expect(spec.query).toContain('updated_at = time::now()');
        expect(spec.variables.status).toBe('deferred');
    });
});

describe('rescheduleTodo', () => {
    it('returns null when neither a due date nor a recurrence is supplied', () => {
        expect(rescheduleTodo({ recordId: 'user_data:x' })).toBeNull();
    });

    it('updates both data.due_date and the parallel top-level timestamp', () => {
        const spec = rescheduleTodo({ recordId: 'user_data:x', new_due_date: '2026-07-01T09:00:00Z' })!;
        expect(spec.query).toContain('data.due_date = $new_due_date');
        expect(spec.query).toContain('timestamp = <datetime> $new_due_date');
        expect(spec.variables.new_due_date).toBe('2026-07-01T09:00:00Z');
    });

    it('updates data.recurrence on its own', () => {
        const spec = rescheduleTodo({ recordId: 'user_data:x', new_recurrence: { every: 'week' } })!;
        expect(spec.query).toContain('data.recurrence = $new_recurrence');
    });
});

describe('editTodo', () => {
    it('returns null when no whitelisted field is present', () => {
        expect(editTodo({ recordId: 'user_data:x', updates: { bogus: 1 } })).toBeNull();
    });

    it('sets whitelisted fields and silently drops unknown keys', () => {
        const spec = editTodo({ recordId: 'user_data:x', updates: { title: 'new', bogus: 1 } })!;
        expect(spec.query).toContain('data.title = $title');
        expect(spec.query).not.toContain('bogus');
        expect(spec.variables.title).toBe('new');
    });

    it('also writes the parallel timestamp when due_date is edited', () => {
        const spec = editTodo({ recordId: 'user_data:x', updates: { due_date: '2026-07-01T09:00:00Z' } })!;
        expect(spec.query).toContain('timestamp = <datetime> $due_date_top');
        expect(spec.variables.due_date_top).toBe('2026-07-01T09:00:00Z');
    });
});

describe('insertTodo', () => {
    const args = {
        title: 'water plants',
        description: null,
        priority: 'normal',
        category: 'home',
        due_date: null,
        recurrence: null,
        metric_link: null,
        source_text: 'remind me to water plants',
        timestamp: '2026-07-01T09:00:00Z',
        lts: '2026-07-01T09:00:00Z',
        local_tz: 'UTC',
        tags: [],
    };

    it('tags the row as an active todo under user_data', () => {
        const spec = insertTodo(args);
        expect(spec.query).toContain("type: 'todo'");
        expect(spec.query).toContain("status: 'active'");
    });

    it('casts both timestamp and lts to datetime (dual-timestamp invariant)', () => {
        const spec = insertTodo(args);
        expect(spec.query).toContain('timestamp: <datetime> $timestamp');
        expect(spec.query).toContain('lts: <datetime> $lts');
    });
});
