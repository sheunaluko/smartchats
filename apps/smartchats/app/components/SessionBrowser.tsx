'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Search, MessageSquare, ChevronDown, ChevronRight, ExternalLink, Trash2 } from 'lucide-react';
import { Drawer } from '../ui/Drawer';
import { SurfacePanel } from '../ui/recipes';
import { loadSessionFromSurreal, searchSessionsInSurreal } from '../modules/sessions';

interface SessionListItem {
  id: string;
  label: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface SessionBrowserProps {
  open: boolean;
  onClose: () => void;
  listSessions: () => Promise<any[]>;
  loadSession: (sessionId: string) => Promise<void>;
}

/** Format a timestamp as relative time (e.g. "2 hours ago") */
function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(dateStr).toLocaleDateString();
}

export const SessionBrowser: React.FC<SessionBrowserProps> = React.memo(({
  open,
  onClose,
  listSessions,
  loadSession,
}) => {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [expandedData, setExpandedData] = useState<any | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch sessions on open
  useEffect(() => {
    if (open) {
      setLoading(true);
      setSearchQuery('');
      setExpandedSessionId(null);
      setExpandedData(null);
      listSessions()
        .then((result) => setSessions(result))
        .finally(() => setLoading(false));
    }
  }, [open, listSessions]);

  // Debounced search
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    searchTimerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        if (query.trim()) {
          const results = await searchSessionsInSurreal(query.trim());
          setSessions(results);
        } else {
          const results = await listSessions();
          setSessions(results);
        }
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [listSessions]);

  // Expand/collapse a session
  const handleToggleExpand = useCallback(async (sessionId: string) => {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      setExpandedData(null);
      return;
    }

    setExpandedSessionId(sessionId);
    setExpandedData(null);
    setExpandedLoading(true);
    try {
      const data = await loadSessionFromSurreal(sessionId);
      setExpandedData(data);
    } finally {
      setExpandedLoading(false);
    }
  }, [expandedSessionId]);

  // Load a session
  const handleLoad = useCallback(async (sessionId: string) => {
    setLoadingSessionId(sessionId);
    try {
      await loadSession(sessionId);
      onClose();
    } finally {
      setLoadingSessionId(null);
    }
  }, [loadSession, onClose]);

  return (
    <Drawer anchor="right" open={open} onClose={onClose} width={420} title="Sessions">
      {/* Search bar */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-sc-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Search sessions..."
          className="w-full rounded-[10px] border border-[var(--sc-separator)] bg-[var(--sc-surface-secondary)] py-2 pl-9 pr-3 text-sm text-sc-text placeholder:text-sc-text-muted focus:border-[var(--sc-accent)] focus:outline-none"
        />
      </div>

      <hr className="surface-divider mb-4" />

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-sc-primary border-t-transparent" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-sc-text-muted py-8 text-center">
          {searchQuery ? 'No sessions found.' : 'No saved sessions yet.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((session) => {
            const isExpanded = expandedSessionId === session.id;

            return (
              <SurfacePanel
                key={session.id}
                variant="tertiary"
                className="px-3 py-2"
              >
                {/* Collapsed row — clickable to expand */}
                <button
                  className="flex w-full items-center gap-2 text-left"
                  onClick={() => handleToggleExpand(session.id)}
                >
                  {isExpanded ? (
                    <ChevronDown size={14} className="shrink-0 text-sc-text-muted" />
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-sc-text-muted" />
                  )}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-semibold text-sc-text truncate">
                      {session.label}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-sc-text-muted">
                      <span>{relativeTime(session.updated_at || session.created_at)}</span>
                      <span className="flex items-center gap-0.5">
                        <MessageSquare size={10} />
                        {session.message_count}
                      </span>
                    </div>
                  </div>
                </button>

                {/* Expanded preview */}
                {isExpanded && (
                  <div className="mt-3 border-t border-[var(--sc-separator)] pt-3">
                    {expandedLoading ? (
                      <div className="flex justify-center py-4">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-sc-primary border-t-transparent" />
                      </div>
                    ) : expandedData?.chat_history ? (
                      <>
                        {/* Scrollable conversation preview */}
                        <div className="max-h-64 overflow-y-auto space-y-2 mb-3 pr-1">
                          {expandedData.chat_history
                            .filter((m: any) => m.role !== 'system')
                            .map((msg: any, i: number) => (
                              <div
                                key={i}
                                className={`text-xs leading-relaxed rounded-lg px-2.5 py-1.5 ${
                                  msg.role === 'user'
                                    ? 'bg-[var(--sc-accent-soft)] text-[var(--sc-accent-soft-foreground)] ml-6'
                                    : 'bg-[var(--sc-surface-secondary)] text-sc-text mr-6'
                                }`}
                              >
                                {(msg.content || '').length > 200
                                  ? msg.content.slice(0, 200) + '...'
                                  : msg.content}
                              </div>
                            ))}
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2">
                          <button
                            className="status-focused status-disabled flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--sc-separator)] px-3 py-1.5 text-sm font-medium text-sc-text transition-colors hover:bg-[var(--sc-default-hover)]"
                            disabled={loadingSessionId !== null}
                            onClick={() => handleLoad(session.id)}
                          >
                            {loadingSessionId === session.id ? (
                              <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-sc-primary border-t-transparent" />
                            ) : (
                              <ExternalLink size={14} />
                            )}
                            Load Session
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-sc-text-muted text-center py-2">
                        No conversation data available.
                      </p>
                    )}
                  </div>
                )}
              </SurfacePanel>
            );
          })}
        </div>
      )}
    </Drawer>
  );
});
