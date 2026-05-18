import { useState, useEffect, useRef } from 'react';
import { getActivityLogs } from '../services/api';
import type { ActivityLog as ActivityLogType } from '../types';

const EVENT_STYLE: Record<string, { dot: string; border: string; bg: string }> = {
  task_created:           { dot: 'bg-emerald-500', border: 'border-l-emerald-400', bg: 'bg-emerald-50/30' },
  task_status_changed:    { dot: 'bg-blue-500',    border: 'border-l-blue-400',    bg: 'bg-blue-50/30' },
  task_executed:          { dot: 'bg-purple-500',  border: 'border-l-purple-400',  bg: 'bg-purple-50/30' },
  task_deleted:           { dot: 'bg-red-500',     border: 'border-l-red-400',     bg: 'bg-red-50/30' },
  project_status_changed: { dot: 'bg-amber-500',  border: 'border-l-amber-400',   bg: 'bg-amber-50/30' },
};

const EVENT_LABELS: Record<string, string> = {
  task_created: 'Created',
  task_status_changed: 'Status Changed',
  task_executed: 'Executed',
  task_deleted: 'Deleted',
  project_status_changed: 'Project Status',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

interface Props {
  projectId: string;
  refreshTrigger: number;
  onClose: () => void;
}

export default function ActivityLog({ projectId, refreshTrigger, onClose }: Props) {
  const [logs, setLogs] = useState<ActivityLogType[]>([]);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    getActivityLogs(projectId).then((data) => {
      setLogs(data);
      setLoading(false);
    });
  }, [projectId, refreshTrigger]);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <>
      {/* Modal header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Activity Log</h2>
            {logs.length > 0 && (
              <p className="text-xs text-gray-400">{logs.length} event{logs.length > 1 ? 's' : ''}</p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors text-xl"
        >
          &times;
        </button>
      </div>

      {/* Log list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 mx-auto mb-3 bg-gray-100 rounded-xl flex items-center justify-center">
              <svg className="w-7 h-7 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm text-gray-500 font-medium">No activity yet</p>
            <p className="text-xs text-gray-400 mt-1">Actions on tasks will appear here</p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => {
              const evStyle = EVENT_STYLE[log.event_type] ?? { dot: 'bg-gray-400', border: 'border-l-gray-300', bg: '' };
              const label = EVENT_LABELS[log.event_type] ?? log.event_type;
              return (
                <div key={log.id} className={`flex items-start gap-3 px-4 py-3 rounded-lg border-l-3 ${evStyle.border} ${evStyle.bg}`}>
                  <span className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${evStyle.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-gray-500">{label}</span>
                      <span className="text-xs text-gray-300">&middot;</span>
                      <span className="text-[11px] text-gray-400 tabular-nums">{relativeTime(log.created_at)}</span>
                    </div>
                    <p className="text-sm text-gray-700">{log.detail}</p>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </>
  );
}
