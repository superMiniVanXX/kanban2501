import type { Task } from '../types';

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'border-l-red-500',
  high: 'border-l-orange-400',
  medium: 'border-l-blue-400',
  low: 'border-l-gray-300',
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Med',
  low: 'Low',
};

interface Props {
  task: Task;
  onClick: (task: Task) => void;
}

export default function TaskCard({ task, onClick }: Props) {
  return (
    <div
      onClick={() => onClick(task)}
      className={`bg-white rounded-md shadow-sm border border-gray-200 border-l-4 ${PRIORITY_COLORS[task.priority]} p-3 cursor-pointer hover:shadow-md transition-shadow`}
    >
      <div className="text-sm font-medium text-gray-900 mb-1">{task.title}</div>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className={`inline-block px-1.5 py-0.5 rounded ${task.priority === 'critical' ? 'bg-red-50 text-red-600' : task.priority === 'high' ? 'bg-orange-50 text-orange-600' : 'bg-gray-50 text-gray-500'}`}>
          {PRIORITY_LABELS[task.priority]}
        </span>
        {task.due_date && (
          <span>Due {new Date(task.due_date).toLocaleDateString()}</span>
        )}
        {task.assignee && (
          <span className="bg-gray-100 px-1.5 py-0.5 rounded">{task.assignee}</span>
        )}
      </div>
      {task.progress > 0 && (
        <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${task.progress}%` }} />
        </div>
      )}
    </div>
  );
}
