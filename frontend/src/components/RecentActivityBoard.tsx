import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRecentActivity } from '../services/api';
import type { ActivityTask, Task } from '../types';
import { STATUS_COLOR } from '../utils/statusColors';

const DAYS_OPTIONS = [1, 3, 7] as const;

const COLUMN_STATUSES: Task['status'][] = [
  'todo', 'in_progress', 'review', 'done', 'verify', 'complete',
];

const COLUMN_LABELS: Record<Task['status'], string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
  verify: 'Verify',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

const PRIORITY_BAR: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-sky-400',
  low: 'bg-gray-300',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso + 'Z').getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function RecentActivityBoard() {
  const [days, setDays] = useState<number>(7);
  const [tasks, setTasks] = useState<ActivityTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRecentActivity(days)
      .then((data) => { if (!cancelled) setTasks(data); })
      .catch(() => { if (!cancelled) setError('加载活跃任务失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const buckets = useMemo(() => {
    const m: Record<string, ActivityTask[]> = {};
    for (const s of COLUMN_STATUSES) m[s] = [];
    for (const t of tasks) {
      if (m[t.status]) m[t.status].push(t);
    }
    return m;
  }, [tasks]);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">近期活跃任务</h2>
          <p className="text-xs text-gray-500">按状态变更时间聚合，跨所有项目</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {DAYS_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                days === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {d} 天
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="text-center py-8 text-sm text-red-500 bg-red-50 rounded-xl border border-red-100">{error}</div>
      ) : loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-400 bg-white rounded-xl border border-gray-100">
          近 {days} 天无状态变更
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-3">
          {COLUMN_STATUSES.map((s) => {
            const color = STATUS_COLOR[s];
            const list = buckets[s] ?? [];
            return (
              <div key={s} className="bg-gray-50 rounded-xl p-2 min-h-[120px]">
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <span className={`w-2 h-2 rounded-full ${color.solid}`} />
                  <span className="text-xs font-semibold text-gray-600">{COLUMN_LABELS[s]}</span>
                  <span className="text-xs text-gray-400 ml-auto">{list.length}</span>
                </div>
                <div className="space-y-2">
                  {list.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => navigate(`/projects/${t.project_id}/board`)}
                      className="w-full text-left bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all overflow-hidden"
                    >
                      <div className={`h-1 ${PRIORITY_BAR[t.priority] ?? 'bg-gray-300'}`} />
                      <div className="p-2">
                        <div className="text-xs font-semibold text-gray-900 leading-snug line-clamp-2">{t.title}</div>
                        <div className="text-[11px] text-gray-400 mt-1 truncate">{t.project_name}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5">{relativeTime(t.last_changed_at)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
