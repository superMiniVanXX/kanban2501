import { Droppable, Draggable } from '@hello-pangea/dnd';
import type { Column, Task } from '../types';
import TaskCard from './TaskCard';

interface Props {
  column: Column;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onQuickCreate: (status: Column['column_status']) => void;
}

export default function KanbanColumn({ column, tasks, onTaskClick, onQuickCreate }: Props) {
  return (
    <div className="flex flex-col w-72 min-w-[288px] bg-gray-100 rounded-xl">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">{column.name}</h3>
          <span className="text-xs text-gray-400 bg-white rounded-full px-2 py-0.5">
            {tasks.length}
          </span>
          {column.wip_limit && (
            <span className="text-xs text-gray-400">
              (WIP: {tasks.length}/{column.wip_limit})
            </span>
          )}
        </div>
        <button
          onClick={() => onQuickCreate(column.column_status)}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
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
            className={`flex-1 px-2 pb-2 space-y-2 min-h-[100px] overflow-y-auto transition-colors ${snapshot.isDraggingOver ? 'bg-blue-50' : ''}`}
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
                    <TaskCard task={task} onClick={onTaskClick} />
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
