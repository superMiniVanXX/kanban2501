import { useState, useRef, useEffect } from 'react';
import type { Task } from '../types';
import { createSubTask, updateSubTask, deleteSubTask } from '../services/api';

const PRIORITY_STYLE: Record<string, { bg: string; border: string; badge: string; title: string; bar: string }> = {
  critical: { bg: 'bg-red-50',      border: 'border-l-red-500',   badge: 'bg-red-200/80 text-red-800',   title: 'text-red-900', bar: 'bg-red-500' },
  high:     { bg: 'bg-orange-50',   border: 'border-l-orange-500', badge: 'bg-orange-200/80 text-orange-800', title: 'text-orange-900', bar: 'bg-orange-500' },
  medium:   { bg: 'bg-sky-50',      border: 'border-l-sky-400',    badge: 'bg-sky-100 text-sky-700',    title: 'text-gray-900', bar: 'bg-sky-400' },
  low:      { bg: 'bg-gray-50',     border: 'border-l-gray-300',   badge: 'bg-gray-200/80 text-gray-600', title: 'text-gray-700', bar: 'bg-gray-300' },
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
  onRefresh: () => void;
}

export default function TaskCard({ task, onClick, onRefresh }: Props) {
  const ps = PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.medium;
  const [expanded, setExpanded] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  const doneCount = task.subtasks.filter((s) => s.done).length;
  const totalCount = task.subtasks.length;

  const handleToggleSubtask = async (subtaskId: string, done: boolean) => {
    await updateSubTask(subtaskId, { done: !done });
    onRefresh();
  };

  const handleDeleteSubtask = async (subtaskId: string) => {
    await deleteSubTask(subtaskId);
    onRefresh();
  };

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await createSubTask(task.id, { title: newTitle.trim() });
    setNewTitle('');
    onRefresh();
  };

  return (
    <div className={`${ps.bg} rounded-lg shadow-sm border border-gray-200/80 border-l-4 ${ps.border} transition-all`}>
      {/* Header row */}
      <div
        className="p-3 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all rounded-lg"
        onClick={() => onClick(task)}
      >
        <div className="flex items-start justify-between">
          <div className={`text-sm font-medium ${ps.title}`}>
            {TYPE_ICON[task.task_type] ?? ''}{task.title}
          </div>
          {totalCount > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/70 text-gray-500 hover:bg-white hover:text-gray-700 flex-shrink-0 transition-colors"
            >
              {doneCount}/{totalCount} ✓
            </button>
          )}
        </div>
        <div className="flex items-center flex-wrap gap-1.5 text-xs mt-1">
          <span className={`inline-block px-1.5 py-0.5 rounded font-medium ${ps.badge}`}>
            {PRIORITY_LABELS[task.priority]}
          </span>
          {task.due_date && (
            <span className="text-gray-400 flex items-center gap-0.5">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              {new Date(task.due_date).toLocaleDateString()}
            </span>
          )}
          {task.assignee && (
            <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-medium">{task.assignee}</span>
          )}
        </div>
        {task.progress > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-white/50 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${ps.bar}`} style={{ width: `${task.progress}%` }} />
            </div>
            <span className="text-[10px] text-gray-400 font-medium tabular-nums">
              {totalCount > 0 ? `${doneCount}/${totalCount}` : `${task.progress}%`}
            </span>
          </div>
        )}
      </div>

      {/* Expand button for tasks without subtasks */}
      {totalCount === 0 && (
        <div className="px-3 pb-2">
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="text-[11px] text-gray-400 hover:text-blue-500 transition-colors"
          >
            + Add subtask
          </button>
        </div>
      )}

      {/* Expanded subtask area */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-200/60 pt-2" onClick={(e) => e.stopPropagation()}>
          {task.subtasks.map((st) => (
            <div key={st.id} className="flex items-center gap-2 py-1 group">
              <input
                type="checkbox"
                checked={st.done}
                onChange={() => handleToggleSubtask(st.id, st.done)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-400 cursor-pointer flex-shrink-0"
              />
              <span className={`text-xs flex-1 ${st.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                {st.title}
              </span>
              <button
                onClick={() => handleDeleteSubtask(st.id)}
                className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs transition-opacity"
              >
                ×
              </button>
            </div>
          ))}
          <form onSubmit={handleAddSubtask} className="mt-1">
            <input
              ref={inputRef}
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Add subtask..."
              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white/70 focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-gray-300"
            />
          </form>
        </div>
      )}
    </div>
  );
}
