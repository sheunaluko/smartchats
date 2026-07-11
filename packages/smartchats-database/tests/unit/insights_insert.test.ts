import { describe, it, expect } from 'vitest';
import { insertInsightEvent } from '../../src/queries/insights.js';

describe('insertInsightEvent', () => {
    it('builds the minimal shape with time::now() default', () => {
        const spec = insertInsightEvent({
            event_type: 'issue_status_change',
            event_id: 'evt_abc123',
            payload: { issue_kind: 'foo', status: 'fixed' },
        });
        expect(spec.query).toContain('INSERT INTO insights_events');
        expect(spec.query).toContain('event_id: $event_id');
        expect(spec.query).toContain('event_type: $event_type');
        expect(spec.query).toContain('payload: $payload');
        expect(spec.query).toContain('timestamp: time::now()');
        expect(spec.variables).toEqual({
            event_id: 'evt_abc123',
            event_type: 'issue_status_change',
            payload: { issue_kind: 'foo', status: 'fixed' },
        });
    });

    it('binds an explicit ISO timestamp as <datetime>', () => {
        const spec = insertInsightEvent({
            event_type: 'error_status_change',
            event_id: 'evt_xyz',
            payload: {},
            timestamp: '2026-07-11T00:00:00Z',
        });
        expect(spec.query).toContain('timestamp: <datetime> $timestamp');
        expect(spec.variables.timestamp).toBe('2026-07-11T00:00:00Z');
    });

    it('accepts a Date and serializes to ISO', () => {
        const d = new Date('2026-01-02T03:04:05Z');
        const spec = insertInsightEvent({
            event_type: 'foo',
            event_id: 'evt_1',
            payload: {},
            timestamp: d,
        });
        expect(spec.variables.timestamp).toBe(d.toISOString());
    });

    it('emits optional session_id / trace_id / user_id / app_name when provided', () => {
        const spec = insertInsightEvent({
            event_type: 'foo',
            event_id: 'evt_1',
            payload: {},
            session_id: 'ses_abc',
            trace_id: 'trc_def',
            user_id: 'user_1',
            app_name: 'smartchats',
        });
        expect(spec.query).toContain('session_id: $session_id');
        expect(spec.query).toContain('trace_id: $trace_id');
        expect(spec.query).toContain('user_id: $user_id');
        expect(spec.query).toContain('app_name: $app_name');
        expect(spec.variables.session_id).toBe('ses_abc');
        expect(spec.variables.trace_id).toBe('trc_def');
        expect(spec.variables.user_id).toBe('user_1');
        expect(spec.variables.app_name).toBe('smartchats');
    });

    it('omits optional fields entirely when not provided', () => {
        const spec = insertInsightEvent({
            event_type: 'foo',
            event_id: 'evt_1',
            payload: {},
        });
        expect(spec.query).not.toContain('session_id');
        expect(spec.query).not.toContain('trace_id');
        expect(spec.query).not.toContain('user_id');
        expect(spec.query).not.toContain('app_name');
    });
});
