import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { Task, ExecutionConfig, ExecuteResult } from '../types';
import { executeTask, updateCodeProject } from '../services/api';
import { useFixedDropdown } from '../hooks/useFixedDropdown';

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

interface PathModalState {
  codeProjectId: string;
  codeProjectName: string;
  configId: string;
}

interface Props {
  task: Task;
  onClick: (task: Task) => void;
  executionConfigs: ExecutionConfig[];
  isPendingDeletion?: boolean;
  onConfirmDelete?: (taskId: string) => void;
  onUndoDelete?: (taskId: string) => void;
}

export default function TaskCard({ task, onClick, executionConfigs, isPendingDeletion, onConfirmDelete, onUndoDelete }: Props) {
  const ps = PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.medium;
  const [showDropdown, setShowDropdown] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [pathModal, setPathModal] = useState<PathModalState | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [pathSaving, setPathSaving] = useState(false);
  const { triggerRef, elRef, style: dropdownStyle } = useFixedDropdown(showDropdown, { align: 'right' });
  const menuRef = useRef<HTMLDivElement>(null);
  const showExecute = !task.sub_project_id && executionConfigs.length > 0;

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done';

  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !elRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
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

  const doExecute = async (configId: string) => {
    setExecuting(configId);
    try {
      const r = await executeTask(task.id, configId);
      setResult(r);
    } catch (err: any) {
      const detail: string = err.response?.data?.detail || err.message || 'Execution failed';
      setResult({ stdout: '', stderr: detail, exit_code: -1, success: false });
    } finally {
      setExecuting(null);
    }
  };

  const handleExecute = (configId: string) => {
    setShowDropdown(false);
    const cp = task.code_projects?.[0];
    if (cp) {
      setPathModal({ codeProjectId: cp.id, codeProjectName: cp.name, configId });
      setPathInput(cp.path || '');
      return;
    }
    doExecute(configId);
  };

  const handleConfirmExecute = async () => {
    if (!pathModal || !pathInput.trim()) return;
    setPathSaving(true);
    try {
      await updateCodeProject(pathModal.codeProjectId, { path: pathInput.trim() });
      setPathModal(null);
      setPathInput('');
      doExecute(pathModal.configId);
    } catch {
      alert('Failed to save path');
    } finally {
      setPathSaving(false);
    }
  };

  return (
    <div className={`${ps.bg} rounded-xl shadow-sm hover:shadow-lg border border-gray-200/80 transition-all duration-200 group relative ${isPendingDeletion ? 'opacity-50 grayscale' : ''}`}>
      {/* Priority top bar */}
      <div className={`h-1 ${ps.bar} rounded-t-xl`} />

      <div
        className={`p-3.5 transition-all duration-200 ${isPendingDeletion ? 'cursor-default' : 'cursor-pointer hover:-translate-y-0.5'}`}
        onClick={() => { if (!isPendingDeletion) onClick(task); }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className={`text-sm font-semibold ${ps.title} flex-1 min-w-0 leading-snug`}>
            {TYPE_ICON[task.task_type] ?? ''}{task.title}
          </div>
          {showExecute && (
            <div className="relative flex-shrink-0">
              <button
                ref={triggerRef}
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

              {showDropdown && createPortal(
                <div ref={menuRef} className="w-44 bg-white rounded-lg shadow-xl border border-gray-200 py-1" style={dropdownStyle}>
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
                </div>,
                document.body
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

        {isPendingDeletion && (
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={(e) => { e.stopPropagation(); onConfirmDelete?.(task.id); }}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
            >
              Confirm Delete
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onUndoDelete?.(task.id); }}
              className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-colors"
            >
              Undo
            </button>
          </div>
        )}

      </div>

      {/* Path configuration modal — portaled to document.body to escape Draggable containment */}
      {pathModal && createPortal(
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={(e) => { e.stopPropagation(); setPathModal(null); setPathInput(''); }}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-96 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-900 mb-1">确认工作目录</h3>
            <p className="text-xs text-gray-500 mb-4">
              代码项目 <span className="font-medium text-gray-700">{pathModal.codeProjectName}</span> 的工作目录：
            </p>
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="/home/user/project"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmExecute(); }}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setPathModal(null); setPathInput(''); }}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmExecute}
                disabled={!pathInput.trim() || pathSaving}
                className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {pathSaving ? '执行中...' : '执行'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
