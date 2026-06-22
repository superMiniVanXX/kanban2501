import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { getBoard, getProjectTree, changeTaskStatus, moveTask, createTask, updateTask, deleteTask, updateProject, createProject, createSubProject, getExecutionConfigs, getCodeProjects, getWorktreeConfigs, createTaskWorktree, deleteTaskWorktree, openTaskWorktree } from '../services/api';
import type { Board, ProjectTree as ProjectTreeType, Task, TaskCreate, ExecutionConfig, CodeProject, WorktreeConfig } from '../types';
import KanbanColumn from '../components/KanbanColumn';
import CreateTaskModal from '../components/CreateTaskModal';
import ProjectTree from '../components/ProjectTree';
import ActivityLog from '../components/ActivityLog';
import { useFixedDropdown } from '../hooks/useFixedDropdown';

export default function KanbanBoard() {
  const { id: projectId } = useParams<{ id: string }>();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createStatus, setCreateStatus] = useState<string>('backlog');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [projectTree, setProjectTree] = useState<ProjectTreeType[]>([]);
  const [executionConfigs, setExecutionConfigs] = useState<ExecutionConfig[]>([]);
  const [codeProjects, setCodeProjects] = useState<CodeProject[]>([]);
  const [wtConfigs, setWtConfigs] = useState<WorktreeConfig[]>([]);
  const [showWtDropdown, setShowWtDropdown] = useState(false);
  const [logRefresh, setLogRefresh] = useState(0);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<Set<string>>(new Set());

  const [editingImplPlan, setEditingImplPlan] = useState(false);
  const [implPlanDraft, setImplPlanDraft] = useState('');

  const [showCodeProjectDropdown, setShowRelatedDropdown] = useState(false);
  const [codeProjectSearch, setCodeProjectSearch] = useState('');
  const { triggerRef: codeProjectTriggerRef, elRef: codeProjectElRef, style: codeProjectDropdownStyle } = useFixedDropdown(showCodeProjectDropdown, { align: 'left' });
  const codeProjectMenuRef = useRef<HTMLDivElement>(null);

  const [statusError, setStatusError] = useState<string | null>(null);

  // Auto-dismiss status error after 5s
  useEffect(() => {
    if (!statusError) return;
    const t = setTimeout(() => setStatusError(null), 5000);
    return () => clearTimeout(t);
  }, [statusError]);

  useEffect(() => {
    if (!showCodeProjectDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !codeProjectElRef.current?.contains(target) &&
        !codeProjectMenuRef.current?.contains(target)
      ) {
        setShowRelatedDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCodeProjectDropdown]);

  // Fetch board
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    if (!board) setLoading(true);

    getBoard(projectId)
      .then((data) => {
        if (cancelled) return;
        setBoard(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to fetch board:', err);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [projectId]);

  // Fetch tree and configs only once on mount
  useEffect(() => {
    getProjectTree().then(setProjectTree);
    getExecutionConfigs().then(setExecutionConfigs);
    getCodeProjects().then(setCodeProjects);
    getWorktreeConfigs().then(setWtConfigs);
  }, []);

  const silentRefresh = useCallback(async () => {
    if (!projectId) return;
    const data = await getBoard(projectId);
    setBoard(data);
  }, [projectId]);

  const refreshTree = useCallback(async () => {
    const tree = await getProjectTree();
    setProjectTree(tree);
  }, []);

  const handleDetach = async (projectId: string) => {
    await updateProject(projectId, { parent_id: null });
    await refreshTree();
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
      // Client-side pre-validation
      if (sourceId === 'backlog' && newStatus === 'todo') {
        const task = prevBoard.columns.flatMap((c) => c.tasks).find((t) => t.id === taskId);
        if (task && (!task.implementation_plan || !task.implementation_plan.trim())) {
          setBoard(prevBoard);
          setStatusError('Cannot move to To Do: implementation plan is required.');
          return;
        }
      }
      if (sourceId === 'in_progress' && newStatus === 'done') {
        setBoard(prevBoard);
        setStatusError('Cannot move from In Progress to Done: must go through Review first.');
        return;
      }
      if (sourceId === 'in_progress' && (newStatus === 'verify' || newStatus === 'complete')) {
        setBoard(prevBoard);
        setStatusError('Cannot skip stages: must go through Review and Done first.');
        return;
      }
      if (sourceId === 'review' && (newStatus === 'verify' || newStatus === 'complete')) {
        setBoard(prevBoard);
        setStatusError('Cannot skip stages: must go through Done first.');
        return;
      }
      if (sourceId === 'done' && newStatus === 'complete') {
        setBoard(prevBoard);
        setStatusError('Cannot skip Verify: must go through Verify first.');
        return;
      }
      await changeTaskStatus(taskId, newStatus);
      await moveTask(taskId, newIndex);
      await silentRefresh();
      setLogRefresh((c) => c + 1);
    } catch (err: any) {
      setBoard(prevBoard);
      const message = err.response?.data?.detail || 'Failed to move task';
      setStatusError(message);
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
    setLogRefresh((c) => c + 1);
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

  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const [editingBoardName, setEditingBoardName] = useState(false);
  const [boardNameDraft, setBoardNameDraft] = useState('');

  const handleAddSubProject = async () => {
    if (!projectId || !newSubProjectName.trim()) return;
    setAddingSubProject(true);
    await createProject({ name: newSubProjectName.trim(), parent_id: projectId });
    setNewSubProjectName('');
    setAddingSubProject(false);
    setShowAddSubProject(false);
    await refreshTree();
  };

  const handleCreateSubProject = async () => {
    if (!editingTask || !subProjectName.trim()) return;
    setCreatingSubProject(true);
    const updated = await createSubProject(editingTask.id, { name: subProjectName.trim() });
    setEditingTask(updated);
    setSubProjectName('');
    setCreatingSubProject(false);
    await refreshTree();
    await silentRefresh();
  };

  const handleDeleteTask = () => {
    if (!editingTask) return;
    setPendingDeletion((prev) => new Set(prev).add(editingTask.id));
    setEditingTask(null);
  };

  const handleConfirmDelete = async (taskId: string) => {
    await deleteTask(taskId);
    setPendingDeletion((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
    await silentRefresh();
    setLogRefresh((c) => c + 1);
  };

  const handleUndoDelete = (taskId: string) => {
    setPendingDeletion((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  };

  const filteredCodeProjects = useMemo(() => {
    const selectedIds = new Set((editingTask?.code_projects || []).map((p) => p.id));
    const searchLower = codeProjectSearch.toLowerCase();
    return codeProjects.filter(
      (p) => !selectedIds.has(p.id) && (!searchLower || p.name.toLowerCase().includes(searchLower))
    );
  }, [codeProjects, codeProjectSearch, editingTask?.code_projects]);

  // Build sidebar: when inside a sub-project, show back-to-parent link + siblings
  const { sidebarParent, sidebarItems } = useMemo(() => {
    if (!projectId) return { sidebarParent: null as ProjectTreeType | null, sidebarItems: projectTree };
    const isRoot = projectTree.some((n) => n.id === projectId);
    if (isRoot) {
      const root = projectTree.find((n) => n.id === projectId)!;
      return { sidebarParent: null, sidebarItems: [root] };
    }
    const findParent = (nodes: ProjectTreeType[], id: string): { parent: ProjectTreeType; siblings: ProjectTreeType[] } | null => {
      for (const node of nodes) {
        for (const child of node.children) {
          if (child.id === id) return { parent: node, siblings: node.children };
        }
        const found = findParent(node.children, id);
        if (found) return found;
      }
      return null;
    };
    const result = findParent(projectTree, projectId);
    if (result) return { sidebarParent: result.parent, sidebarItems: result.siblings };
    return { sidebarParent: null, sidebarItems: projectTree };
  }, [projectTree, projectId]);

  // Find parent project from tree data
  const findParentId = (nodes: ProjectTreeType[], targetId: string): string | null => {
    for (const node of nodes) {
      for (const child of node.children) {
        if (child.id === targetId) return node.id;
      }
      const found = findParentId(node.children, targetId);
      if (found) return found;
    }
    return null;
  };
  const parentId = projectId ? findParentId(projectTree, projectId) : null;

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!board) return <div className="text-gray-400 text-center py-20">Board not found</div>;

  return (
    <div className="flex flex-col h-full">
      {/* Board header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-3 mb-4">
        <div className="flex items-center gap-3">
          {parentId ? (
            <Link to={`/projects/${parentId}/board`} className="flex items-center gap-1 text-gray-400 hover:text-blue-600 transition-colors group/breadcrumb">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              <span className="text-sm max-w-[160px] truncate group-hover/breadcrumb:text-blue-600">
                {(() => {
                  const findName = (nodes: ProjectTreeType[], id: string): string | null => {
                    for (const n of nodes) {
                      if (n.id === id) return n.name;
                      const found = findName(n.children, id);
                      if (found) return found;
                    }
                    return null;
                  };
                  return findName(projectTree, parentId);
                })()}
              </span>
            </Link>
          ) : (
            <Link to="/" className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Link>
          )}
          {editingBoardName ? (
            <input
              type="text"
              value={boardNameDraft}
              onChange={(e) => setBoardNameDraft(e.target.value)}
              onBlur={async () => {
                if (boardNameDraft.trim() && boardNameDraft.trim() !== board.name && projectId) {
                  await updateProject(projectId, { name: boardNameDraft.trim() });
                  setBoard({ ...board, name: boardNameDraft.trim() });
                  await refreshTree();
                }
                setEditingBoardName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                if (e.key === 'Escape') { setEditingBoardName(false); }
              }}
              autoFocus
              className="text-xl font-bold text-gray-900 bg-white border border-blue-300 rounded px-2 py-0.5 focus:ring-2 focus:ring-blue-400 focus:outline-none"
            />
          ) : (
            <h1
              className="text-xl font-bold text-gray-900 truncate cursor-pointer hover:text-blue-600 transition-colors"
              onDoubleClick={() => { setEditingBoardName(true); setBoardNameDraft(board.name); }}
              title="Double-click to edit"
            >
              {board.name}
            </h1>
          )}
          {board.is_completed && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm shadow-emerald-100">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              Completed
            </span>
          )}
          <div className="flex-1" />

          {/* Activity log button */}
          {projectId && (
            <button
              onClick={() => { setShowActivityLog(true); setLogRefresh((c) => c + 1); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
              title="View activity log"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Activity
            </button>
          )}

          {!showAddSubProject ? (
            <button
              onClick={() => setShowAddSubProject(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-50 border border-purple-200 rounded-lg transition-colors"
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
                className="border border-purple-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-purple-400 focus:outline-none w-48"
                autoFocus
              />
              <button
                onClick={handleAddSubProject}
                disabled={addingSubProject || !newSubProjectName.trim()}
                className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium transition-colors"
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
      </div>

      {/* Main area: sidebar tree + kanban columns */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 border-r border-gray-200 bg-gray-50/80 overflow-y-auto flex-shrink-0 pb-4">
          <ProjectTree projects={sidebarItems} parentProject={sidebarParent} onDetach={handleDetach} />
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
                executionConfigs={executionConfigs}
                pendingDeletion={pendingDeletion}
                onConfirmDelete={handleConfirmDelete}
                onUndoDelete={handleUndoDelete}
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

      {/* Activity log modal */}
      {showActivityLog && projectId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowActivityLog(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <ActivityLog projectId={projectId} refreshTrigger={logRefresh} onClose={() => setShowActivityLog(false)} />
          </div>
        </div>
      )}

      {/* Task detail modal */}
      {editingTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6" onClick={() => { setEditingTask(null); silentRefresh(); }}>
          <div className="bg-white w-full max-w-2xl max-h-[90vh] shadow-2xl overflow-hidden rounded-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className={`flex-shrink-0 px-6 py-4 border-b flex items-center justify-between ${
              editingTask.status === 'done' ? 'bg-emerald-50/50' :
              editingTask.status === 'review' ? 'bg-violet-50/50' :
              editingTask.status === 'in_progress' ? 'bg-amber-50/50' :
              editingTask.status === 'todo' ? 'bg-blue-50/50' : 'bg-slate-50/50'
            }`}>
              <div className="flex items-center gap-3 min-w-0">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  editingTask.status === 'done' ? 'bg-emerald-500' :
                  editingTask.status === 'review' ? 'bg-violet-500' :
                  editingTask.status === 'in_progress' ? 'bg-amber-500' :
                  editingTask.status === 'todo' ? 'bg-blue-500' : 'bg-slate-500'
                }`} />
                {editingTitle ? (
                  <input
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => {
                      if (titleDraft.trim() && titleDraft.trim() !== editingTask.title) {
                        handleSaveTask({ title: titleDraft.trim() });
                        setEditingTask({ ...editingTask, title: titleDraft.trim() });
                      }
                      setEditingTitle(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                      if (e.key === 'Escape') { setEditingTitle(false); }
                    }}
                    autoFocus
                    className="text-lg font-bold text-gray-900 bg-white border border-blue-300 rounded px-2 py-0.5 focus:ring-2 focus:ring-blue-400 focus:outline-none min-w-0 flex-1"
                  />
                ) : (
                  <h2
                    className="text-lg font-bold text-gray-900 truncate cursor-pointer hover:text-blue-600 transition-colors"
                    onDoubleClick={() => { setEditingTitle(true); setTitleDraft(editingTask.title); }}
                    title="Double-click to edit"
                  >
                    {editingTask.title}
                  </h2>
                )}
              </div>
              <button onClick={() => { setEditingTask(null); silentRefresh(); }} className="text-gray-400 hover:text-gray-600 text-2xl leading-none p-1 flex-shrink-0 ml-4 transition-colors">&times;</button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-6 space-y-5">
              {statusError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                  <p className="text-sm text-red-700 flex-1">{statusError}</p>
                  <button onClick={() => setStatusError(null)} className="text-red-400 hover:text-red-600 text-lg leading-none">&times;</button>
                </div>
              )}

              {/* Status + Priority + Type */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Status</label>
                  <select
                    value={editingTask.status}
                    onChange={(e) => {
                      const newStatus = e.target.value as Task['status'];
                      changeTaskStatus(editingTask.id, newStatus).then((updated) => {
                        setEditingTask({ ...editingTask, status: updated.status, completed_at: updated.completed_at, progress: updated.progress });
                        silentRefresh();
                        setLogRefresh((c) => c + 1);
                        setStatusError(null);
                      }).catch((err) => {
                        const message = err.response?.data?.detail || 'Failed to change status';
                        setStatusError(message);
                      });
                    }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none font-medium"
                  >
                    <option value="backlog">Backlog</option>
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="review">Review</option>
                    <option value="done">Done</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Priority</label>
                  <select
                    value={editingTask.priority}
                    onChange={(e) => { handleSaveTask({ priority: e.target.value as Task['priority'] }); setEditingTask({ ...editingTask, priority: e.target.value as Task['priority'] }); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none font-medium"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Type</label>
                  <select
                    value={editingTask.task_type}
                    onChange={(e) => { handleSaveTask({ task_type: e.target.value as Task['task_type'] }); setEditingTask({ ...editingTask, task_type: e.target.value as Task['task_type'] }); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none font-medium"
                  >
                    <option value="task">Task</option>
                    <option value="milestone">Milestone</option>
                    <option value="epic">Epic</option>
                  </select>
                </div>
              </div>

              {/* Exclude from stats toggle */}
              <div className="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-lg">
                <button
                  onClick={() => {
                    const newVal = !editingTask.exclude_from_stats;
                    handleSaveTask({ exclude_from_stats: newVal });
                    setEditingTask({ ...editingTask, exclude_from_stats: newVal });
                  }}
                  className={`relative w-9 h-5 rounded-full transition-colors ${editingTask.exclude_from_stats ? 'bg-amber-400' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${editingTask.exclude_from_stats ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
                <span className="text-xs text-gray-600 font-medium">Exclude from statistics</span>
                {editingTask.exclude_from_stats && (
                  <span className="text-xs text-amber-600 font-medium">Excluded</span>
                )}
              </div>

              {/* Assignee + Estimate + Due Date */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Assignee</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={editingTask.assignee || ''}
                      onChange={(e) => { handleSaveTask({ assignee: e.target.value || null }); setEditingTask({ ...editingTask, assignee: e.target.value || null }); }}
                      onBlur={() => silentRefresh()}
                      placeholder="Add assignee..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Est. Hours</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={editingTask.estimated_hours ?? ''}
                    onChange={(e) => { const v = e.target.value ? parseFloat(e.target.value) : null; handleSaveTask({ estimated_hours: v }); setEditingTask({ ...editingTask, estimated_hours: v }); }}
                    onBlur={() => silentRefresh()}
                    placeholder="Hours"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Due Date</label>
                  <input
                    type="date"
                    value={editingTask.due_date ? editingTask.due_date.slice(0, 10) : ''}
                    onChange={(e) => { const v = e.target.value || null; handleSaveTask({ due_date: v }); setEditingTask({ ...editingTask, due_date: v }); }}
                    onBlur={() => silentRefresh()}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none ${
                      editingTask.due_date && new Date(editingTask.due_date) < new Date() && editingTask.status !== 'done'
                        ? 'border-red-300 bg-red-50'
                        : 'border-gray-200'
                    }`}
                  />
                </div>
              </div>

              {/* Description & Implementation Plan side by side */}
              <div className="grid grid-cols-2 gap-4">
                {/* Description */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</h4>
                    {!editingDescription && (
                      <button
                        onClick={() => { setEditingDescription(true); setDescriptionDraft(editingTask.description || ''); }}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                        title="Edit description"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                    )}
                  </div>
                  {editingDescription ? (
                    <div className="space-y-2">
                      <textarea
                        value={descriptionDraft}
                        onChange={(e) => setDescriptionDraft(e.target.value)}
                        rows={5}
                        autoFocus
                        className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none resize-y"
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingDescription(false)}
                          className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                        >Cancel</button>
                        <button
                          onClick={() => {
                            handleSaveTask({ description: descriptionDraft || null });
                            setEditingTask({ ...editingTask, description: descriptionDraft || null });
                            setEditingDescription(false);
                          }}
                          className="px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
                        >Save</button>
                      </div>
                    </div>
                  ) : (
                    editingTask.description ? (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 border border-gray-100 min-h-[60px]">{editingTask.description}</p>
                    ) : (
                      <button
                        onClick={() => { setEditingDescription(true); setDescriptionDraft(''); }}
                        className="text-sm text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg px-3 py-3 w-full text-left transition-colors border border-dashed border-gray-200"
                      >Add description...</button>
                    )
                  )}
                </div>

                {/* Implementation Plan */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Impl. Plan</h4>
                    {!editingImplPlan && (
                      <button
                        onClick={() => { setEditingImplPlan(true); setImplPlanDraft(editingTask.implementation_plan || ''); }}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                        title="Edit implementation plan"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                    )}
                  </div>
                  {editingImplPlan ? (
                    <div className="space-y-2">
                      <textarea
                        value={implPlanDraft}
                        onChange={(e) => setImplPlanDraft(e.target.value)}
                        rows={5}
                        autoFocus
                        placeholder="Implementation approach..."
                        className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none resize-y"
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingImplPlan(false)}
                          className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                        >Cancel</button>
                        <button
                          onClick={() => {
                            handleSaveTask({ implementation_plan: implPlanDraft || null });
                            setEditingTask({ ...editingTask, implementation_plan: implPlanDraft || null });
                            setEditingImplPlan(false);
                          }}
                          className="px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
                        >Save</button>
                      </div>
                    </div>
                  ) : (
                    editingTask.implementation_plan ? (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap bg-blue-50 rounded-lg p-3 border border-blue-100 min-h-[60px]">{editingTask.implementation_plan}</p>
                    ) : (
                      <button
                        onClick={() => { setEditingImplPlan(true); setImplPlanDraft(''); }}
                        className="text-sm text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg px-3 py-3 w-full text-left transition-colors border border-dashed border-gray-200"
                      >Add implementation plan...</button>
                    )
                  )}
                  {editingTask.status === 'backlog' && !editingTask.implementation_plan && (
                    <p className="text-xs text-amber-600 mt-1">Required before moving to To Do</p>
                  )}
                </div>
              </div>

              {/* Acceptance Criteria */}
              {editingTask.acceptance_criteria && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Acceptance Criteria (开发验收)</h4>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap bg-emerald-50 rounded-lg p-3 border border-emerald-100">{editingTask.acceptance_criteria}</p>
                </div>
              )}

              {/* Verify Criteria */}
              {editingTask.verify_criteria && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Verify Criteria (质量验证)</h4>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap bg-cyan-50 rounded-lg p-3 border border-cyan-100">{editingTask.verify_criteria}</p>
                </div>
              )}

              {/* Sub-Project */}
              <div className="border-t border-gray-100 pt-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Sub-Project</h4>
                {editingTask.sub_project_id ? (
                  <Link
                    to={`/projects/${editingTask.sub_project_id}/board`}
                    onClick={() => setEditingTask(null)}
                    className="inline-flex items-center gap-2 text-sm text-purple-700 bg-purple-50 rounded-lg px-4 py-2.5 hover:bg-purple-100 border border-purple-100 transition-colors font-medium"
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
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400 focus:outline-none"
                    />
                    <button
                      onClick={handleCreateSubProject}
                      disabled={creatingSubProject || !subProjectName.trim()}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium transition-colors"
                    >
                      {creatingSubProject ? '...' : 'Create'}
                    </button>
                  </div>
                )}
              </div>

              {/* Code Projects */}
              <div className="border-t border-gray-100 pt-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Code Projects</h4>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(editingTask.code_projects || []).map((rp) => (
                    <span
                      key={rp.id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-teal-50 text-teal-700 border border-teal-200 font-medium"
                    >
                      {rp.name}
                      <button
                        onClick={async () => {
                          const newIds = (editingTask.code_projects || [])
                            .filter((p) => p.id !== rp.id)
                            .map((p) => p.id);
                          await updateTask(editingTask.id, { code_project_ids: newIds });
                          setEditingTask({
                            ...editingTask,
                            code_projects: (editingTask.code_projects || []).filter((p) => p.id !== rp.id),
                          });
                          await silentRefresh();
                        }}
                        className="text-teal-400 hover:text-teal-600 transition-colors"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
                <div className="relative inline-block">
                  <button
                    ref={codeProjectTriggerRef}
                    onClick={() => { setShowRelatedDropdown((v) => !v); setCodeProjectSearch(''); }}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Project
                  </button>
                  {showCodeProjectDropdown && (
                    <div ref={codeProjectMenuRef} className="w-56 bg-white rounded-lg shadow-xl border border-gray-200" style={codeProjectDropdownStyle}>
                      <div className="px-2 py-1.5 border-b border-gray-100">
                        <input
                          type="text"
                          value={codeProjectSearch}
                          onChange={(e) => setCodeProjectSearch(e.target.value)}
                          placeholder="Filter projects..."
                          className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-400 focus:border-transparent"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="max-h-48 overflow-y-auto py-1">
                      {filteredCodeProjects.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-gray-400">No matching projects</div>
                      ) : (
                        filteredCodeProjects.map((p) => (
                            <button
                              key={p.id}
                              onClick={async () => {
                                const newIds = [
                                  ...(editingTask.code_projects || []).map((rp) => rp.id),
                                  p.id,
                                ];
                                await updateTask(editingTask.id, { code_project_ids: newIds });
                                setEditingTask({
                                  ...editingTask,
                                  code_projects: [
                                    ...(editingTask.code_projects || []),
                                    { id: p.id, name: p.name },
                                  ],
                                });
                                await silentRefresh();
                              }}
                              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-teal-50 hover:text-teal-700 transition-colors flex items-center gap-2"
                            >
                              <svg className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                              {p.name}
                            </button>
                          ))
                      )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Worktree */}
              <div className="border-t border-gray-100 pt-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Worktree</h4>
                {editingTask.worktree ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    {editingTask.worktree.status === 'pending' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        待创建 — {editingTask.worktree.branch}
                      </span>
                    )}
                    {editingTask.worktree.status === 'active' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-green-50 text-green-700 border border-green-200 font-medium">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        {editingTask.worktree.branch}
                      </span>
                    )}
                    {editingTask.worktree.status === 'removed' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-gray-50 text-gray-500 border border-gray-200 font-medium">
                        已移除
                      </span>
                    )}
                    {editingTask.worktree.status === 'error' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-red-50 text-red-700 border border-red-200 font-medium" title={editingTask.worktree.error_message ?? ''}>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                        错误
                      </span>
                    )}
                    <span className="text-xs text-gray-400 truncate max-w-xs" title={editingTask.worktree.path}>{editingTask.worktree.path}</span>
                    {editingTask.worktree.status === 'active' && (
                      <button
                        onClick={async () => {
                          try { await openTaskWorktree(editingTask.id); } catch { /* ignore */ }
                        }}
                        className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
                        title={`Open ${editingTask.worktree.path}`}
                      >
                        打开
                      </button>
                    )}
                    {editingTask.worktree.status !== 'removed' && (
                      <button
                        onClick={async () => {
                          await deleteTaskWorktree(editingTask.id);
                          setEditingTask({ ...editingTask, worktree: null });
                          await silentRefresh();
                        }}
                        className="text-xs text-red-400 hover:text-red-600 transition-colors ml-auto"
                      >
                        移除
                      </button>
                    )}
                  </div>
                ) : wtConfigs.length > 0 ? (
                  <div className="flex items-center gap-2">
                    {showWtDropdown ? (
                      <>
                        <select
                          autoFocus
                          defaultValue=""
                          onChange={async (e) => {
                            const configId = e.target.value;
                            setShowWtDropdown(false);
                            if (!configId) return;
                            try {
                              const wt = await createTaskWorktree(editingTask.id, configId);
                              setEditingTask({ ...editingTask, worktree: wt });
                              await silentRefresh();
                            } catch (err: any) {
                              alert(err.response?.data?.detail || 'Failed to create worktree');
                            }
                          }}
                          onBlur={() => setShowWtDropdown(false)}
                          className="flex-1 border border-green-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-400 focus:outline-none"
                        >
                          <option value="">选择配置...</option>
                          {wtConfigs.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => setShowWtDropdown(false)}
                          className="text-gray-400 hover:text-gray-600 text-sm"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setShowWtDropdown(true)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-green-600 border border-green-200 rounded-lg hover:bg-green-50 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        配置 Worktree
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">暂无 Worktree 配置，请先在 设置 中添加</p>
                )}
              </div>

              {/* Timestamps */}
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-gray-400">
                <div>Created: {new Date(editingTask.created_at + 'Z').toLocaleString()}</div>
                <div>Updated: {new Date(editingTask.updated_at + 'Z').toLocaleString()}</div>
                {editingTask.start_date && (
                  <div>Start: {editingTask.start_date.slice(0, 10)}</div>
                )}
                {editingTask.completed_at && (
                  <div>Completed: {new Date(editingTask.completed_at + 'Z').toLocaleString()}</div>
                )}
              </div>

              <button
                onClick={handleDeleteTask}
                className="w-full mt-4 px-4 py-2.5 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 hover:border-red-300 text-sm font-medium transition-colors"
              >
                Delete Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
