import type { Task } from '../types';

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
}

export default function TaskCard({ task, onClick }: Props) {
  const ps = PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.medium;

  return (
    <div
      onClick={() => onClick(task)}
      className={`${ps.bg} rounded-lg shadow-sm border border-gray-200/80 border-l-4 ${ps.border} p-3 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all`}
    >
      <div className={`text-sm font-medium mb-1.5 ${ps.title}`}>
        {TYPE_ICON[task.task_type] ?? ''}{task.title}
      </div>
      <div className="flex items-center flex-wrap gap-1.5 text-xs">
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
          <span className="text-[10px] text-gray-400 font-medium tabular-nums">{task.progress}%</span>
        </div>
      )}
    </div>
  );
}
