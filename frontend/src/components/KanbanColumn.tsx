import { Droppable, Draggable } from '@hello-pangea/dnd';
import type { Column, Task, ExecutionConfig } from '../types';
import TaskCard from './TaskCard';

const COLUMN_STYLE: Record<string, { header: string; bg: string; hover: string }> = {
  backlog:     { header: 'bg-slate-700',   bg: 'bg-slate-50/50',  hover: 'bg-slate-100/60' },
  todo:        { header: 'bg-blue-600',    bg: 'bg-blue-50/50',   hover: 'bg-blue-100/60' },
  in_progress: { header: 'bg-amber-600',   bg: 'bg-amber-50/50',  hover: 'bg-amber-100/60' },
  review:      { header: 'bg-violet-600',  bg: 'bg-violet-50/50', hover: 'bg-violet-100/60' },
  done:        { header: 'bg-emerald-600', bg: 'bg-emerald-50/50', hover: 'bg-emerald-100/60' },
  verify:      { header: 'bg-cyan-600',    bg: 'bg-cyan-50/50',   hover: 'bg-cyan-100/60' },
  complete:    { header: 'bg-teal-600',    bg: 'bg-teal-50/50',   hover: 'bg-teal-100/60' },
  cancelled:   { header: 'bg-gray-600',    bg: 'bg-gray-50/50',   hover: 'bg-gray-100/60' },
};

interface Props {
  column: Column;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onQuickCreate: (status: Column['column_status']) => void;
  executionConfigs: ExecutionConfig[];
  pendingDeletion: Set<string>;
  onConfirmDelete: (taskId: string) => void;
  onUndoDelete: (taskId: string) => void;
}

export default function KanbanColumn({ column, tasks, onTaskClick, onQuickCreate, executionConfigs, pendingDeletion, onConfirmDelete, onUndoDelete }: Props) {
  const style = COLUMN_STYLE[column.column_status] ?? COLUMN_STYLE.backlog;

  return (
    <div className={`flex flex-col w-[340px] min-w-[340px] ${style.bg} rounded-xl border border-gray-200/60`}>
      <div className={`flex items-center justify-between px-4 py-3 ${style.header} rounded-t-xl`}>
        <div className="flex items-center gap-2.5">
          <h3 className="text-sm font-bold text-white tracking-wide">{column.name}</h3>
          <span className="text-xs text-white/80 bg-white/20 rounded-full px-2.5 py-0.5 font-bold">
            {tasks.length}
          </span>
          {column.wip_limit && (
            <span className="text-xs text-white/60">
              (WIP: {tasks.length}/{column.wip_limit})
            </span>
          )}
        </div>
        <button
          onClick={() => onQuickCreate(column.column_status)}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/30 text-white text-lg leading-none transition-colors"
          title="Add task"
        >
          +
        </button>
      </div>

      <Droppable droppableId={column.column_status}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 px-2.5 pb-2.5 pt-2 space-y-2.5 min-h-[120px] overflow-y-auto transition-colors rounded-b-xl ${
              snapshot.isDraggingOver ? `${style.hover} ring-2 ring-dashed ring-gray-300/50 ring-inset` : ''
            }`}
          >
            {tasks.map((task, index) => (
              <Draggable key={task.id} draggableId={task.id} index={index}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={snapshot.isDragging ? 'opacity-90 rotate-1 shadow-xl' : ''}
                  >
                    <TaskCard task={task} onClick={onTaskClick} executionConfigs={executionConfigs} isPendingDeletion={pendingDeletion.has(task.id)} onConfirmDelete={onConfirmDelete} onUndoDelete={onUndoDelete} />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
