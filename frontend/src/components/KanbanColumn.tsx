import { Droppable, Draggable } from '@hello-pangea/dnd';
import type { Column, Task } from '../types';
import TaskCard from './TaskCard';

const COLUMN_STYLE: Record<string, { header: string; bg: string; dot: string; hover: string }> = {
  backlog:     { header: 'bg-slate-600',   bg: 'bg-slate-50',   dot: 'bg-slate-400',   hover: 'bg-slate-100' },
  todo:        { header: 'bg-blue-500',    bg: 'bg-blue-50',    dot: 'bg-blue-400',    hover: 'bg-blue-100' },
  in_progress: { header: 'bg-amber-500',   bg: 'bg-amber-50',   dot: 'bg-amber-400',   hover: 'bg-amber-100' },
  review:      { header: 'bg-violet-500',  bg: 'bg-violet-50',  dot: 'bg-violet-400',  hover: 'bg-violet-100' },
  done:        { header: 'bg-emerald-500', bg: 'bg-emerald-50', dot: 'bg-emerald-400', hover: 'bg-emerald-100' },
  cancelled:   { header: 'bg-gray-500',    bg: 'bg-gray-50',    dot: 'bg-gray-400',    hover: 'bg-gray-100' },
};

interface Props {
  column: Column;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onQuickCreate: (status: Column['column_status']) => void;
  onRefresh: () => void;
}

export default function KanbanColumn({ column, tasks, onTaskClick, onQuickCreate, onRefresh }: Props) {
  const style = COLUMN_STYLE[column.column_status] ?? COLUMN_STYLE.backlog;

  return (
    <div className={`flex flex-col w-72 min-w-[288px] ${style.bg} rounded-xl border border-gray-200/60`}>
      <div className={`flex items-center justify-between px-3 py-2.5 ${style.header} rounded-t-xl`}>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${style.dot} ring-2 ring-white/40`} />
          <h3 className="text-sm font-semibold text-white">{column.name}</h3>
          <span className="text-xs text-white/70 bg-white/20 rounded-full px-2 py-0.5">
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
          className="text-white/60 hover:text-white text-lg leading-none transition-colors"
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
            className={`flex-1 px-2 pb-2 space-y-2 min-h-[100px] overflow-y-auto transition-colors rounded-b-xl ${snapshot.isDraggingOver ? style.hover : ''}`}
          >
            {tasks.map((task, index) => (
              <Draggable key={task.id} draggableId={task.id} index={index}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={snapshot.isDragging ? 'opacity-90 shadow-lg' : ''}
                  >
                    <TaskCard task={task} onClick={onTaskClick} onRefresh={onRefresh} />
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
