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

const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress',
  review: 'Review', done: 'Done', cancelled: 'Cancelled',
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
  const hasTooltip = task.description || task.acceptance_criteria;

  return (
    <div className={`${ps.bg} rounded-lg shadow-sm border border-gray-200/80 border-l-4 ${ps.border} transition-all group relative`}>
      <div
        className="p-3 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all rounded-lg"
        onClick={() => onClick(task)}
      >
        <div className="flex items-start justify-between">
          <div className={`text-sm font-medium ${ps.title}`}>
            {TYPE_ICON[task.task_type] ?? ''}{task.title}
          </div>
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
        {task.sub_project_id && (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-purple-600 bg-purple-50 rounded px-1.5 py-0.5 w-fit">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
            Sub-project
          </div>
        )}
        {task.progress > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-white/50 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${ps.bar}`} style={{ width: `${task.progress}%` }} />
            </div>
            <span className="text-[10px] text-gray-400 font-medium tabular-nums">
              {task.progress}%
            </span>
          </div>
        )}
      </div>

      {/* Hover tooltip */}
      {hasTooltip && (
        <div className="absolute left-full top-0 ml-2 w-72 bg-white rounded-lg shadow-xl border border-gray-200 p-4 z-50
                        opacity-0 invisible group-hover:opacity-100 group-hover:visible
                        transition-all duration-150 pointer-events-none">
          {task.description && (
            <div className="mb-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Description</div>
              <p className="text-xs text-gray-700 leading-relaxed line-clamp-4 whitespace-pre-wrap">{task.description}</p>
            </div>
          )}
          {task.acceptance_criteria && (
            <div className="mb-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Acceptance Criteria</div>
              <p className="text-xs text-gray-700 leading-relaxed line-clamp-4 whitespace-pre-wrap">{task.acceptance_criteria}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 text-[10px] text-gray-500 border-t pt-2">
            <span className="bg-gray-100 px-1.5 py-0.5 rounded">{STATUS_LABEL[task.status] || task.status}</span>
            {task.assignee && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{task.assignee}</span>}
            {task.estimated_hours && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{task.estimated_hours}h</span>}
            {task.due_date && <span className="bg-gray-100 px-1.5 py-0.5 rounded">Due {task.due_date}</span>}
            {task.progress > 0 && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{task.progress}%</span>}
          </div>
          <div className="absolute top-0 left-0 w-2 h-2 bg-white border-l border-b border-gray-200 transform -translate-x-1/2 rotate-45" style={{top: '12px'}} />
        </div>
      )}
    </div>
  );
}
