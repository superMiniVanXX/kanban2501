import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  clearReadNotifications,
} from '../services/api';
import type { NotificationItem } from '../types';

const SEVERITY_DOT: Record<string, string> = {
  info: 'bg-blue-400',
  warning: 'bg-amber-400',
  error: 'bg-red-500',
};

const SEVERITY_BG: Record<string, string> = {
  info: 'bg-blue-50/50',
  warning: 'bg-amber-50/50',
  error: 'bg-red-50/50',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function NotificationQueue() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await getNotifications({ limit: 50 }));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUnread = useCallback(async () => {
    try {
      const { count } = await getUnreadNotificationCount();
      setUnread(count);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchUnread();
    const timer = setInterval(fetchUnread, 30_000);
    return () => clearInterval(timer);
  }, [fetchUnread]);

  useEffect(() => {
    if (!open) return;
    fetchItems();
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, fetchItems]);

  const handleClick = async (item: NotificationItem) => {
    if (item.read_at === null) {
      try {
        await markNotificationRead(item.id);
        setUnread((u) => Math.max(0, u - 1));
        setItems((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)),
        );
      } catch {
        /* ignore */
      }
    }
    if (item.project_id) {
      setOpen(false);
      navigate(`/projects/${item.project_id}/board`);
    }
  };

  const handleDismiss = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await dismissNotification(id);
      setItems((prev) => prev.filter((n) => n.id !== id));
      fetchUnread();
    } catch {
      /* ignore */
    }
  };

  const handleMarkAll = async () => {
    try {
      await markAllNotificationsRead();
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    } catch {
      /* ignore */
    }
  };

  const handleClearRead = async () => {
    try {
      await clearReadNotifications();
      setItems((prev) => prev.filter((n) => n.read_at === null));
    } catch {
      /* ignore */
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          open
            ? 'text-white bg-white/15'
            : 'text-gray-400 hover:text-white hover:bg-white/10'
        }`}
        title="通知队列"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-96 bg-white rounded-xl shadow-2xl border border-gray-200 z-[100] max-h-[28rem] flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 flex-shrink-0">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              通知队列
              {unread > 0 && <span className="ml-1.5 text-red-500">{unread} 未读</span>}
            </span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  onClick={handleMarkAll}
                  className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
                >
                  全部已读
                </button>
              )}
              {items.some((n) => n.read_at !== null) && (
                <button
                  onClick={handleClearRead}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  清除已读
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="py-8 text-center">
                <svg className="w-5 h-5 text-gray-300 animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}

            {!loading && items.length === 0 && (
              <div className="py-10 text-center">
                <svg className="w-8 h-8 text-gray-200 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <p className="text-sm text-gray-400">暂无通知</p>
              </div>
            )}

            {!loading && items.map((item) => (
              <div
                key={item.id}
                onClick={() => handleClick(item)}
                className={`group relative px-4 py-2.5 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-blue-50/50 transition-colors ${
                  item.read_at === null ? SEVERITY_BG[item.severity] ?? 'bg-gray-50/30' : ''
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${SEVERITY_DOT[item.severity] ?? 'bg-gray-300'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm truncate ${item.read_at === null ? 'font-semibold text-gray-900' : 'font-normal text-gray-600'}`}>
                        {item.title}
                      </span>
                      {item.read_at === null && (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                      )}
                    </div>
                    {item.message && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.message}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] font-mono text-gray-400">{item.event_type}</span>
                      {item.source && (
                        <span className="text-[11px] text-gray-400">from {item.source}</span>
                      )}
                      <span className="text-[11px] text-gray-400 ml-auto tabular-nums">{relativeTime(item.created_at)}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDismiss(e, item.id)}
                    className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    title="忽略"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {!loading && items.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 flex-shrink-0">
              <button
                onClick={() => { fetchItems(); fetchUnread(); }}
                className="text-xs text-gray-400 hover:text-blue-500 transition-colors"
              >
                刷新
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
