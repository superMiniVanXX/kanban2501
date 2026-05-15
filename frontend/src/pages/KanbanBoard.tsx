import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { getBoard, getProjectTree, changeTaskStatus, moveTask, createTask, updateTask, deleteTask, updateProject, createProject, createSubProject } from '../services/api';
import type { Board, ProjectTree as ProjectTreeType, Task, TaskCreate } from '../types';
import KanbanColumn from '../components/KanbanColumn';
import CreateTaskModal from '../components/CreateTaskModal';
import ProjectTree from '../components/ProjectTree';

export default function KanbanBoard() {
  const { id: projectId } = useParams<{ id: string }>();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createStatus, setCreateStatus] = useState<string>('backlog');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [projectTree, setProjectTree] = useState<ProjectTreeType[]>([]);

  const fetchBoard = useCallback(async (showLoading = true) => {
    if (!projectId) return;
    if (showLoading) setLoading(true);
    const data = await getBoard(projectId);
    setBoard(data);
    if (showLoading) setLoading(false);
  }, [projectId]);

  useEffect(() => { fetchBoard(); fetchTree(); }, [fetchBoard]);

  const fetchTree = useCallback(async () => {
    const tree = await getProjectTree();
    setProjectTree(tree);
  }, []);

  const silentRefresh = useCallback(() => fetchBoard(false), [fetchBoard]);

  const handleDetach = async (projectId: string) => {
    await updateProject(projectId, { parent_id: null });
    await fetchTree();
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || !board) return;

    const taskId = result.draggableId;
    const newStatus = result.destination.droppableId as Task['status'];
    const newIndex = result.destination.index;

    const prevBoard = board;
    const sourceId = result.source.droppableId;
    const isSameColumn = sourceId === newStatus;

    const updatedColumns = board.columns.map((col) => {
      if (isSameColumn && col.column_status === sourceId) {
        const reordered = [...col.tasks];
        const [moved] = reordered.splice(result.source.index, 1);
        reordered.splice(newIndex, 0, moved);
        return { ...col, tasks: reordered };
      }
      if (!isSameColumn && col.column_status === sourceId) {
        return { ...col, tasks: col.tasks.filter((t) => t.id !== taskId) };
      }
      if (!isSameColumn && col.column_status === newStatus) {
        const destTasks = [...col.tasks];
        const task = prevBoard.columns
          .flatMap((c) => c.tasks)
          .find((t) => t.id === taskId)!;
        destTasks.splice(newIndex, 0, { ...task, status: newStatus });
        return { ...col, tasks: destTasks };
      }
      return col;
    });
    setBoard({ ...board, columns: updatedColumns });

    try {
      await changeTaskStatus(taskId, newStatus);
      await moveTask(taskId, newIndex);
      await silentRefresh();
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
    await silentRefresh();
  };

  const handleSaveTask = async (data: Partial<Task>) => {
    if (!editingTask) return;
    await updateTask(editingTask.id, data);
    setEditingTask(null);
    await silentRefresh();
  };

  const [subProjectName, setSubProjectName] = useState('');
  const [creatingSubProject, setCreatingSubProject] = useState(false);

  const [showAddSubProject, setShowAddSubProject] = useState(false);
  const [newSubProjectName, setNewSubProjectName] = useState('');
  const [addingSubProject, setAddingSubProject] = useState(false);

  const handleAddSubProject = async () => {
    if (!projectId || !newSubProjectName.trim()) return;
    setAddingSubProject(true);
    await createProject({ name: newSubProjectName.trim(), parent_id: projectId });
    setNewSubProjectName('');
    setAddingSubProject(false);
    setShowAddSubProject(false);
    await fetchTree();
  };

  const handleCreateSubProject = async () => {
    if (!editingTask || !subProjectName.trim()) return;
    setCreatingSubProject(true);
    const updated = await createSubProject(editingTask.id, { name: subProjectName.trim() });
    setEditingTask(updated);
    setSubProjectName('');
    setCreatingSubProject(false);
    await fetchTree();
    await silentRefresh();
  };

  const handleDeleteTask = async () => {
    if (!editingTask) return;
    await deleteTask(editingTask.id);
    setEditingTask(null);
    await silentRefresh();
  };

  if (loading) return <div className="text-gray-400">Loading board...</div>;
  if (!board) return <div className="text-gray-400">Board not found</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">&larr; Projects</Link>
        <h1 className="text-xl font-bold">{board.name}</h1>
        {!showAddSubProject ? (
          <button
            onClick={() => setShowAddSubProject(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-purple-600 hover:bg-purple-50 border border-purple-200 rounded-md transition-colors"
            title="Add sub-project"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Sub-project
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newSubProjectName}
              onChange={(e) => setNewSubProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddSubProject()}
              placeholder="Sub-project name"
              className="border border-purple-300 rounded-md px-2.5 py-1 text-sm focus:ring-2 focus:ring-purple-400 focus:outline-none w-48"
              autoFocus
            />
            <button
              onClick={handleAddSubProject}
              disabled={addingSubProject || !newSubProjectName.trim()}
              className="px-2.5 py-1 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              {addingSubProject ? '...' : 'Add'}
            </button>
            <button
              onClick={() => { setShowAddSubProject(false); setNewSubProjectName(''); }}
              className="px-2 py-1 text-gray-400 hover:text-gray-600 text-sm"
            >
              &times;
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 border-r border-gray-200 overflow-y-auto flex-shrink-0 pb-4">
          <ProjectTree projects={projectTree} onDetach={handleDetach} />
        </aside>

        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-auto flex-1 pb-4 pl-4">
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
      </div>

      <CreateTaskModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreateTask}
        defaultStatus={createStatus}
      />

      {/* Task detail sidebar */}
      {editingTask && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => { setEditingTask(null); fetchBoard(); }}>
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
                <button onClick={() => { setEditingTask(null); fetchBoard(); }} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Status</label>
                    <select
                      value={editingTask.status}
                      onChange={(e) => {
                        const newStatus = e.target.value as Task['status'];
                        changeTaskStatus(editingTask.id, newStatus).then((updated) => {
                          setEditingTask({ ...editingTask, status: updated.status, completed_at: updated.completed_at, progress: updated.progress });
                        });
                      }}
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
                {editingTask.acceptance_criteria && (
                  <div>
                    <h4 className="text-xs font-medium text-gray-400 mb-1">Acceptance Criteria</h4>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap bg-emerald-50 rounded-lg p-3 border border-emerald-100">{editingTask.acceptance_criteria}</p>
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
                <div className="border-t pt-4">
                  <h4 className="text-xs font-medium text-gray-400 mb-2">Sub-Project</h4>
                  {editingTask.sub_project_id ? (
                    <Link
                      to={`/projects/${editingTask.sub_project_id}/board`}
                      onClick={() => setEditingTask(null)}
                      className="flex items-center gap-2 text-sm text-purple-700 bg-purple-50 rounded-lg px-3 py-2 hover:bg-purple-100 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                      Open sub-project &rarr;
                    </Link>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={subProjectName}
                        onChange={(e) => setSubProjectName(e.target.value)}
                        placeholder="New sub-project name"
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-purple-400 focus:outline-none"
                      />
                      <button
                        onClick={handleCreateSubProject}
                        disabled={creatingSubProject || !subProjectName.trim()}
                        className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium transition-colors"
                      >
                        {creatingSubProject ? '...' : 'Create'}
                      </button>
                    </div>
                  )}
                </div>
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
