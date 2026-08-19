import { useEffect, useState } from 'react';
import { getNotificationLogs } from '../services/api';
import type { NotificationLog } from '../types';

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

export default function NotificationLogList({ refreshTrigger }: { refreshTrigger: number }) {
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    getNotificationLogs(undefined, 100).then(setLogs);
  }, [refreshTrigger]);

  if (logs.length === 0) {
    return <div className="text-sm text-gray-400 py-4 text-center">No notifications dispatched yet.</div>;
  }

  return (
    <div className="space-y-1">
      {logs.map(log => (
        <div key={log.id} className="border-l-2 px-3 py-2 text-xs bg-gray-50/40"
          style={{ borderColor: log.status === 'success' ? '#10b981' : '#ef4444' }}>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-700">{log.channel_name}</span>
            <span className="text-gray-400">·</span>
            <span className="font-mono text-gray-600">{log.event_type}</span>
            <span className="text-gray-400">·</span>
            <span className={log.status === 'success' ? 'text-emerald-600' : 'text-red-600'}>{log.status}</span>
            {log.http_status && <span className="text-gray-500">HTTP {log.http_status}</span>}
            <span className="text-gray-400 ml-auto tabular-nums">{log.duration_ms}ms · {relativeTime(log.created_at)}</span>
          </div>
          {log.detail && (
            <button onClick={() => setExpanded(expanded === log.id ? null : log.id)}
              className="text-gray-400 hover:text-gray-600 mt-1 text-[11px]">
              {expanded === log.id ? '▾ hide detail' : '▸ show detail'}
            </button>
          )}
          {expanded === log.id && log.detail && (
            <pre className="mt-1 p-2 bg-white border border-gray-200 rounded text-[11px] overflow-x-auto whitespace-pre-wrap">{log.detail}</pre>
          )}
        </div>
      ))}
    </div>
  );
}
