import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchTasks } from '../services/api';
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

export default function SearchBox() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const navigate = useNavigate();

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const data = await searchTasks(q.trim());
      setResults(data);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) { setResults([]); setOpen(false); return; }
    timerRef.current = setTimeout(() => doSearch(query), 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, doSearch]);

  useEffect(() => {
    if (!open) return;
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
    setQuery('');
    navigate(`/projects/${item.sub_project_id ?? item.project_id}/board`);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center bg-white/10 rounded-lg border border-white/10 focus-within:border-blue-400/50 focus-within:bg-white/15 transition-all">
        <svg className="w-4 h-4 text-gray-400 ml-2.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          placeholder="Search tasks..."
          className="bg-transparent text-white placeholder-gray-500 text-sm px-2.5 py-1.5 w-56 focus:outline-none"
        />
        {loading && (
          <svg className="w-4 h-4 text-gray-400 animate-spin mr-2.5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 z-[100] max-h-80 overflow-y-auto">
          {results.map((item) => (
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
        </div>
      )}

      {open && query.trim() && !loading && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 py-6 z-[100] text-center">
          <p className="text-sm text-gray-400">No tasks found</p>
        </div>
      )}
    </div>
  );
}
