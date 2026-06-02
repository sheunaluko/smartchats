'use client';

import React, { useState, useCallback } from 'react';
import { SurfacePanel } from '../ui/recipes/SurfacePanel';
import { Chip } from '../ui/Chip';
import { useSmartChatsStore } from '../store/useSmartChatsStore';
import { fetchTodosContext } from '../modules/todos';
import type { TodoListProps, TodoItem, RecurringTodoItem } from './types';
import { getBackend } from '@/lib/backend';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Event-time bundle imported from the shared helper so this file uses
// the same convention as every other write site.
import { nowEventTime } from '../modules/system';

function formatDueDate(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const priorityVariant: Record<string, 'danger' | 'warning' | 'primary' | 'default'> = {
    urgent: 'danger',
    high: 'warning',
    medium: 'primary',
    low: 'default',
}

// ── Checkbox ─────────────────────────────────────────────────────────────────

function Checkbox({ checked, onClick }: { checked: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border transition-colors duration-200
                ${checked
                    ? 'border-transparent bg-[var(--sc-success)] text-white'
                    : 'border-[var(--sc-separator)] bg-transparent hover:border-[var(--sc-primary)]'
                }`}
            aria-label={checked ? 'Completed' : 'Mark complete'}
        >
            {checked && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            )}
        </button>
    )
}

// ── Todo Row ─────────────────────────────────────────────────────────────────

function TodoRow({ item, completed, onComplete }: {
    item: TodoItem;
    completed: boolean;
    onComplete: () => void;
}) {
    return (
        <SurfacePanel variant="secondary" className="flex items-center gap-2.5 px-3 py-2">
            <Checkbox checked={completed} onClick={onComplete} />
            <div className={`flex-1 min-w-0 transition-opacity duration-300 ${completed ? 'opacity-40' : ''}`}>
                <span className={`text-xs text-sc-text ${completed ? 'line-through' : ''}`}>
                    {item.title}
                </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
                {item.due_date && (
                    <span className="text-[0.625rem] text-sc-text-muted">
                        {formatDueDate(item.due_date)}
                    </span>
                )}
                {item.priority && item.priority !== 'medium' && (
                    <Chip label={item.priority} size="sm" variant={priorityVariant[item.priority] || 'default'} />
                )}
            </div>
        </SurfacePanel>
    )
}

// ── Recurring Row ────────────────────────────────────────────────────────────

function RecurringRow({ item, completed, onComplete }: {
    item: RecurringTodoItem;
    completed: boolean;
    onComplete: () => void;
}) {
    const progress = item.target
        ? `${Math.min(item.done_this_period + (completed ? 1 : 0), item.target)}/${item.target}`
        : `${item.done_this_period + (completed ? 1 : 0)} done`

    return (
        <SurfacePanel variant="secondary" className="flex items-center gap-2.5 px-3 py-2">
            <Checkbox checked={completed} onClick={onComplete} />
            <div className={`flex-1 min-w-0 transition-opacity duration-300 ${completed ? 'opacity-40' : ''}`}>
                <span className={`text-xs text-sc-text ${completed ? 'line-through' : ''}`}>
                    {item.title}
                </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[0.625rem] text-sc-text-muted">{progress}</span>
                <Chip label={item.pattern} size="sm" variant="primary" />
            </div>
        </SurfacePanel>
    )
}

// ── Section ──────────────────────────────────────────────────────────────────

function Section({ title, color, children }: {
    title: string;
    color?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-1.5">
            <h4 className={`text-[0.625rem] font-semibold uppercase tracking-wider ${color || 'text-sc-text-muted'}`}>
                {title}
            </h4>
            <div className="space-y-1">
                {children}
            </div>
        </div>
    )
}

// ── Main component ───────────────────────────────────────────────────────────

export function TodoList({ overdue, due_today, upcoming_7d, no_date, total_active, recurring_due }: TodoListProps) {
    const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())

    const handleComplete = useCallback(async (id: string, title: string, isRecurring: boolean) => {
        if (completedIds.has(id)) return
        setCompletedIds(prev => new Set(prev).add(id))

        const eventTime = nowEventTime()

        try {
            // Create completion record. Dual-writes legacy lts and the 1.5.0
            // event-time triple (ts/local_date/local_tz).
            const compQuery = `INSERT INTO user_data {
                type: 'todo_completion',
                status: 'completed',
                data: { note: NONE },
                source_text: '',
                parent_id: $parent_id,
                timestamp: d'${eventTime.ts}',
                lts: d'${eventTime.lts}',
                ts: d'${eventTime.ts}',
                local_date: $local_date,
                local_tz: $local_tz,
                tags: [],
                created_at: time::now(),
                updated_at: time::now()
            }`
            await getBackend().data.query({
                query: compQuery,
                variables: { parent_id: id, local_date: eventTime.local_date, local_tz: eventTime.local_tz }
            })

            // For non-recurring: mark the todo as completed
            if (!isRecurring) {
                await getBackend().data.query({
                    query: `UPDATE ${id} SET status = 'completed', updated_at = time::now()`
                })
            }

            // Refresh the todo viz in place
            try {
                const fresh = await fetchTodosContext()
                useSmartChatsStore.getState().handleVisualizationUpdate({
                    vizType: 'todo_list', props: fresh, vizId: 'todos',
                })
            } catch { /* best effort */ }

            // Notify agent
            useSmartChatsStore.getState().sendMessageSync(
                `[Todo completed: "${title}"]`
            )
        } catch (err) {
            // Revert optimistic update on failure
            setCompletedIds(prev => {
                const next = new Set(prev)
                next.delete(id)
                return next
            })
        }
    }, [completedIds])

    const isEmpty = overdue.length === 0 && due_today.length === 0 && upcoming_7d.length === 0 && (no_date || []).length === 0 && recurring_due.length === 0

    return (
        <div className="w-full space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-sc-text">Your Todos</h3>
                <Chip label={`${total_active} active`} size="sm" variant="default" />
            </div>

            {isEmpty ? (
                <p className="text-xs text-sc-text-muted py-2">No todos due right now.</p>
            ) : (
                <>
                    {overdue.length > 0 && (
                        <Section title="Overdue" color="text-[var(--sc-danger)]">
                            {overdue.map(item => (
                                <TodoRow
                                    key={item.id}
                                    item={item}
                                    completed={completedIds.has(item.id)}
                                    onComplete={() => handleComplete(item.id, item.title, false)}
                                />
                            ))}
                        </Section>
                    )}

                    {due_today.length > 0 && (
                        <Section title="Due Today" color="text-[var(--sc-primary)]">
                            {due_today.map(item => (
                                <TodoRow
                                    key={item.id}
                                    item={item}
                                    completed={completedIds.has(item.id)}
                                    onComplete={() => handleComplete(item.id, item.title, false)}
                                />
                            ))}
                        </Section>
                    )}

                    {upcoming_7d.length > 0 && (
                        <Section title="Upcoming" color="text-sc-text-muted">
                            {upcoming_7d.map(item => (
                                <TodoRow
                                    key={item.id}
                                    item={item}
                                    completed={completedIds.has(item.id)}
                                    onComplete={() => handleComplete(item.id, item.title, false)}
                                />
                            ))}
                        </Section>
                    )}

                    {(no_date || []).length > 0 && (
                        <Section title="No Due Date" color="text-sc-text-muted">
                            {(no_date || []).map(item => (
                                <TodoRow
                                    key={item.id}
                                    item={item}
                                    completed={completedIds.has(item.id)}
                                    onComplete={() => handleComplete(item.id, item.title, false)}
                                />
                            ))}
                        </Section>
                    )}

                    {recurring_due.length > 0 && (
                        <Section title="Recurring" color="text-[var(--sc-accent)]">
                            {recurring_due.map(item => (
                                <RecurringRow
                                    key={item.id}
                                    item={item}
                                    completed={completedIds.has(item.id)}
                                    onComplete={() => handleComplete(item.id, item.title, true)}
                                />
                            ))}
                        </Section>
                    )}
                </>
            )}
        </div>
    )
}
