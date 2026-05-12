import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { getBoard, changeTaskStatus, moveTask, createTask, updateTask, deleteTask } from '../services/api';
import type { Board, Task, TaskCreate } from '../types';
import KanbanColumn from '../components/KanbanColumn';
import CreateTaskModal from '../components/CreateTaskModal';

export default function KanbanBoard() {
  const { id: projectId } = useParams<{ id: string }>();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createStatus, setCreateStatus] = useState<string>('backlog');
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const fetchBoard = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const data = await getBoard(projectId);
    setBoard(data);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || !board) return;

    const taskId = result.draggableId;
    const newStatus = result.destination.droppableId as Task['status'];
    const newIndex = result.destination.index;

    // Optimistic update
    const prevBoard = board;
    const updatedColumns = board.columns.map((col) => {
      if (col.column_status === result.source.droppableId) {
        return { ...col, tasks: col.tasks.filter((t) => t.id !== taskId) };
      }
      if (col.column_status === newStatus) {
        const newTasks = [...col.tasks];
        const task = prevBoard.columns
          .flatMap((c) => c.tasks)
          .find((t) => t.id === taskId)!;
        task.status = newStatus;
        newTasks.splice(newIndex, 0, task);
        return { ...col, tasks: newTasks };
      }
      return col;
    });
    setBoard({ ...board, columns: updatedColumns });

    try {
      await changeTaskStatus(taskId, newStatus);
      await moveTask(taskId, newIndex);
    } catch {
      setBoard(prevBoard);
    }
  };

  const handleQuickCreate = (status: string) => {
    setCreateStatus(status);
    setShowCreate(true);
  };

  const handleCreateTask = async (data: TaskCreate) => {
    if (!projectId) return;
    await createTask(projectId, data);
    await fetchBoard();
  };

  const handleSaveTask = async (data: Partial<Task>) => {
    if (!editingTask) return;
    await updateTask(editingTask.id, data);
    setEditingTask(null);
    await fetchBoard();
  };

  const handleDeleteTask = async () => {
    if (!editingTask) return;
    await deleteTask(editingTask.id);
    setEditingTask(null);
    await fetchBoard();
  };

  if (loading) return <div className="text-gray-400">Loading board...</div>;
  if (!board) return <div className="text-gray-400">Board not found</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">&larr; Projects</Link>
        <h1 className="text-xl font-bold">{board.name}</h1>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto flex-1 pb-4">
          {board.columns.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              tasks={col.tasks}
              onTaskClick={setEditingTask}
              onQuickCreate={handleQuickCreate}
            />
          ))}
        </div>
      </DragDropContext>

      <CreateTaskModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreateTask}
        defaultStatus={createStatus}
      />

      {/* Task detail sidebar */}
      {editingTask && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => setEditingTask(null)}>
          <div className="bg-white w-full max-w-md h-full shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* colored header strip */}
            <div className={`h-2 ${
              editingTask.status === 'done' ? 'bg-emerald-500' :
              editingTask.status === 'review' ? 'bg-violet-500' :
              editingTask.status === 'in_progress' ? 'bg-amber-500' :
              editingTask.status === 'todo' ? 'bg-blue-500' : 'bg-slate-500'
            }`} />
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-lg font-semibold">{editingTask.title}</h2>
                <button onClick={() => setEditingTask(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Status</label>
                    <select
                      value={editingTask.status}
                      onChange={(e) => { handleSaveTask({ status: e.target.value as Task['status'] }); setEditingTask({ ...editingTask, status: e.target.value as Task['status'] }); }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    >
                      <option value="backlog">Backlog</option>
                      <option value="todo">To Do</option>
                      <option value="in_progress">In Progress</option>
                      <option value="review">Review</option>
                      <option value="done">Done</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Priority</label>
                    <select
                      value={editingTask.priority}
                      onChange={(e) => { handleSaveTask({ priority: e.target.value as Task['priority'] }); setEditingTask({ ...editingTask, priority: e.target.value as Task['priority'] }); }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                </div>
                {editingTask.description && (
                  <div>
                    <h4 className="text-xs font-medium text-gray-400 mb-1">Description</h4>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{editingTask.description}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {editingTask.assignee && (
                    <div className="bg-indigo-50 rounded-lg px-3 py-2">
                      <span className="text-xs text-indigo-400">Assignee</span>
                      <div className="text-indigo-700 font-medium">{editingTask.assignee}</div>
                    </div>
                  )}
                  {editingTask.estimated_hours && (
                    <div className="bg-sky-50 rounded-lg px-3 py-2">
                      <span className="text-xs text-sky-400">Estimated</span>
                      <div className="text-sky-700 font-medium">{editingTask.estimated_hours}h</div>
                    </div>
                  )}
                  {editingTask.due_date && (
                    <div className="bg-amber-50 rounded-lg px-3 py-2">
                      <span className="text-xs text-amber-400">Due Date</span>
                      <div className="text-amber-700 font-medium">{new Date(editingTask.due_date).toLocaleDateString()}</div>
                    </div>
                  )}
                </div>
                {editingTask.progress > 0 && (
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-400">Progress</span>
                      <span className="font-medium text-gray-600">{editingTask.progress}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${editingTask.progress}%` }} />
                    </div>
                  </div>
                )}
                <button
                  onClick={handleDeleteTask}
                  className="w-full mt-6 px-4 py-2.5 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 text-sm font-medium transition-colors"
                >
                  Delete Task
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
