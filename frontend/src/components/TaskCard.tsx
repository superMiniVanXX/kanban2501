import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Task, ExecutionConfig, ExecuteResult } from '../types';
import { executeTask } from '../services/api';

const PRIORITY_STYLE: Record<string, { bar: string; bg: string; badge: string; title: string; progress: string }> = {
  critical: { bar: 'bg-red-500',    bg: 'bg-white',   badge: 'bg-red-100 text-red-700 border-red-200',   title: 'text-gray-900', progress: 'bg-red-500' },
  high:     { bar: 'bg-orange-500', bg: 'bg-white',   badge: 'bg-orange-100 text-orange-700 border-orange-200', title: 'text-gray-900', progress: 'bg-orange-500' },
  medium:   { bar: 'bg-sky-400',    bg: 'bg-white',   badge: 'bg-sky-50 text-sky-600 border-sky-200',    title: 'text-gray-900', progress: 'bg-sky-400' },
  low:      { bar: 'bg-gray-300',   bg: 'bg-white',   badge: 'bg-gray-100 text-gray-500 border-gray-200', title: 'text-gray-700', progress: 'bg-gray-300' },
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Med',
  low: 'Low',
};

const TYPE_ICON: Record<string, string> = {
  task: '',
  milestone: '◆ ',
  epic: '⚡ ',
};

interface Props {
  task: Task;
  onClick: (task: Task) => void;
  executionConfigs: ExecutionConfig[];
}

export default function TaskCard({ task, onClick, executionConfigs }: Props) {
  const ps = PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.medium;
  const [showDropdown, setShowDropdown] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const showExecute = !task.sub_project_id && executionConfigs.length > 0;

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done';

  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(t);
  }, [result]);

  const handleExecute = async (configId: string) => {
    setExecuting(configId);
    setShowDropdown(false);
    const r = await executeTask(task.id, configId);
    setResult(r);
    setExecuting(null);
  };

  return (
    <div className={`${ps.bg} rounded-xl shadow-sm hover:shadow-lg border border-gray-200/80 transition-all duration-200 group relative`}>
      {/* Priority top bar */}
      <div className={`h-1 ${ps.bar} rounded-t-xl`} />

      <div
        className="p-3.5 cursor-pointer hover:-translate-y-0.5 transition-all duration-200"
        onClick={() => onClick(task)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className={`text-sm font-semibold ${ps.title} flex-1 min-w-0 leading-snug`}>
            {TYPE_ICON[task.task_type] ?? ''}{task.title}
          </div>
          {showExecute && (
            <div ref={dropdownRef} className="relative flex-shrink-0">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setShowDropdown((v) => !v); }}
                className={`w-6 h-6 flex items-center justify-center rounded-md text-xs transition-all ${
                  result
                    ? result.success
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      : 'bg-red-100 text-red-700 hover:bg-red-200'
                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
                }`}
                title={result ? (result.success ? 'Success' : `Error: ${result.stderr}`) : 'Execute'}
              >
                {executing ? (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {showDropdown && (
                <div className="absolute top-full right-0 mt-1 w-44 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
                  {executionConfigs.map((config) => (
                    <button
                      key={config.id}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); handleExecute(config.id); }}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    >
                      {config.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center flex-wrap gap-1.5 mt-2">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${ps.badge}`}>
            {PRIORITY_LABELS[task.priority]}
          </span>
          {task.due_date && (
            <span className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-md ${
              isOverdue ? 'text-red-600 bg-red-50 font-medium' : 'text-gray-400'
            }`}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              {new Date(task.due_date).toLocaleDateString()}
            </span>
          )}
          {task.assignee && (
            <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-md text-xs font-medium">{task.assignee}</span>
          )}
        </div>

        {task.code_projects && task.code_projects.length > 0 && (
          <div className="flex items-center flex-wrap gap-1 mt-1.5">
            {task.code_projects.slice(0, 3).map((rp) => (
              <span
                key={rp.id}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-md bg-teal-50 text-teal-700 border border-teal-200 font-medium"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                {rp.name}
              </span>
            ))}
            {task.code_projects.length > 3 && (
              <span className="text-xs text-gray-400 font-medium">
                +{task.code_projects.length - 3} more
              </span>
            )}
          </div>
        )}

        {task.sub_project_id && (
          <Link
            to={`/projects/${task.sub_project_id}/board`}
            onClick={(e) => e.stopPropagation()}
            className="mt-2 inline-flex items-center gap-1 text-xs text-purple-600 bg-purple-50 rounded-md px-2 py-1 border border-purple-100 hover:bg-purple-100 hover:border-purple-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
            Sub-project &rarr;
          </Link>
        )}

      </div>
    </div>
  );
}
