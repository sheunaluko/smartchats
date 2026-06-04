/**
 * Regression test for the prod incident on 2026-06-04: SurrealDB Cloud
 * (v3) auto-coerced a `local_date` parameter value that looked like
 * `"2026-06-04"` into a `d'2026-06-04T00:00:00Z'` datetime when binding
 * the variable, and the schema's `local_date TYPE string` rejected the
 * coerced datetime. Fix: every INSERT / UPDATE binding of `$local_date`
 * and `$local_tz` must include an explicit `<string>` cast so the
 * value is forced back to string regardless of how Surreal interprets
 * the wire value.
 *
 * If you find yourself updating this test because a builder no longer
 * casts, check the prod-bug history before "fixing" — the cast is
 * load-bearing on SurrealDB Cloud v3.
 */

import { describe, it, expect } from 'vitest';
import {
    insertLog,
    updateLog,
    insertSession,
    updateSession,
    insertTodo,
    insertTodoCompletion,
    insertMetric,
} from '../../src/queries/index.js';

const PLACEHOLDER_EVENT_TIME = {
    ts: '2026-06-04T05:00:00.000Z',
    local_date: '2026-06-04',
    local_tz: 'America/Chicago',
};

function expectStringCastsPresent(query: string, label: string) {
    expect(query, `${label}: local_date must be cast to <string> $local_date`).toMatch(/local_date\s*[:=]\s*<string>\s*\$local_date/);
    expect(query, `${label}: local_tz must be cast to <string> $local_tz`).toMatch(/local_tz\s*[:=]\s*<string>\s*\$local_tz/);
}

describe('event-time binding casts (SurrealDB v3 auto-coercion guard)', () => {
    it('insertLog casts $local_date and $local_tz to <string>', () => {
        const { query } = insertLog({
            content: 'hi',
            category: 'test',
            embedding: null,
            ...PLACEHOLDER_EVENT_TIME,
        });
        expectStringCastsPresent(query, 'insertLog');
    });

    it('updateLog patch SET clauses cast $local_date and $local_tz to <string>', () => {
        const spec = updateLog({
            recordId: 'logs:abc',
            patch: { local_date: '2026-06-04', local_tz: 'America/Chicago' },
        });
        expect(spec).not.toBeNull();
        expectStringCastsPresent(spec!.query, 'updateLog');
    });

    it('insertSession casts $local_date and $local_tz to <string>', () => {
        const { query } = insertSession({
            label: 'x',
            message_count: 0,
            chat_history: [],
            workspace: {},
            thought_history: [],
            execution_history: [],
            settings: {},
            ...PLACEHOLDER_EVENT_TIME,
        });
        expectStringCastsPresent(query, 'insertSession');
    });

    it('updateSession casts $local_date and $local_tz to <string>', () => {
        const { query } = updateSession('sessions:abc', {
            label: 'x',
            message_count: 0,
            chat_history: [],
            workspace: {},
            thought_history: [],
            execution_history: [],
            settings: {},
            ...PLACEHOLDER_EVENT_TIME,
        });
        expectStringCastsPresent(query, 'updateSession');
    });

    it('insertTodo casts $local_date and $local_tz to <string>', () => {
        const { query } = insertTodo({
            description: 'task',
            priority: 'normal',
            category: null,
            due_date: null,
            recurrence: null,
            metric_link: null,
            source_text: '',
            due_at: '2026-06-04T05:00:00.000Z',
            tags: [],
            ...PLACEHOLDER_EVENT_TIME,
        });
        expectStringCastsPresent(query, 'insertTodo');
    });

    it('insertTodoCompletion casts $local_date and $local_tz to <string>', () => {
        const { query } = insertTodoCompletion({
            parent_id: 'user_data:abc',
            note: null,
            ...PLACEHOLDER_EVENT_TIME,
        });
        expectStringCastsPresent(query, 'insertTodoCompletion');
    });

    it('insertMetric casts $local_date and $local_tz to <string>', () => {
        const { query } = insertMetric({
            metric_name: 'pushups',
            value: 10,
            unit: 'reps',
            metric_type: 'numeric',
            source: 'user_conversation',
            source_text: '',
            source_log_id: null,
            category: 'general',
            time_shift_quantity: null,
            time_shift_unit: null,
            note: null,
            ...PLACEHOLDER_EVENT_TIME,
        });
        expectStringCastsPresent(query, 'insertMetric');
    });
});
