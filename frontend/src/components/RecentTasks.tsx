import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRecentTasks } from '../services/api';
import type { SearchResult } from '../types';

const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
  verify: 'Verify',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

const STATUS_STYLE: Record<string, string> = {
  backlog: 'bg-gray-100 text-gray-500',
  todo: 'bg-blue-50 text-blue-600',
  in_progress: 'bg-amber-50 text-amber-600',
  review: 'bg-violet-50 text-violet-600',
  done: 'bg-emerald-50 text-emerald-600',
  verify: 'bg-cyan-50 text-cyan-600',
  complete: 'bg-teal-50 text-teal-600',
  cancelled: 'bg-red-50 text-red-500',
};

const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-sky-400',
  low: 'bg-gray-300',
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  const months = Math.floor(days / 30);
  return `${months}个月前`;
}

export default function RecentTasks() {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const fetchRecent = async () => {
    setLoading(true);
    try {
      const data = await getRecentTasks();
      setTasks(data);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    fetchRecent();
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (item: SearchResult) => {
    setOpen(false);
    navigate(`/projects/${item.sub_project_id ?? item.project_id}/board`);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          open
            ? 'text-white bg-white/15'
            : 'text-gray-400 hover:text-white hover:bg-white/10'
        }`}
        title="最近活动任务"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>最近</span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 z-[100] max-h-96 overflow-y-auto">
          <div className="px-3.5 py-2 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">最近活动任务</span>
          </div>

          {loading && (
            <div className="py-8 text-center">
              <svg className="w-5 h-5 text-gray-300 animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}

          {!loading && tasks.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-400">暂无最近活动任务</p>
            </div>
          )}

          {!loading && tasks.map((item) => (
            <button
              key={item.id}
              onClick={() => handleSelect(item)}
              className="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 transition-colors flex items-start gap-3 group"
            >
              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${PRIORITY_DOT[item.priority] ?? 'bg-gray-300'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate group-hover:text-blue-700">{item.title}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-400 truncate">{item.project_name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_STYLE[item.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_LABEL[item.status] ?? item.status}
                  </span>
                </div>
              </div>
              <svg className="w-4 h-4 text-gray-300 group-hover:text-blue-400 mt-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}

          {!loading && tasks.length > 0 && (
            <div className="px-3.5 py-2 border-t border-gray-100">
              <button
                onClick={() => { setOpen(false); fetchRecent().then(() => setOpen(true)); }}
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
