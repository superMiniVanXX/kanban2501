import axios from 'axios';
import type { Project, ProjectCreate, ProjectTree, Task, TaskCreate, Board, ExecutionConfig, ExecutionConfigCreate, ExecuteResult, ActivityLog, SearchResult, CodeProject, CodeProjectCreate, Statistics, ProjectProgress, TrashData, WorktreeConfig, WorktreeConfigCreate, Worktree } from '../types';

const api = axios.create({ baseURL: '/api/v1' });

// Projects
export const getProjects = (status?: string) =>
  api.get<Project[]>('/projects', { params: { status } }).then((r) => r.data);

export const getProject = (id: string) =>
  api.get<Project>(`/projects/${id}`).then((r) => r.data);

export const createProject = (data: ProjectCreate) =>
  api.post<Project>('/projects', data).then((r) => r.data);

export const updateProject = (id: string, data: Partial<ProjectCreate>) =>
  api.put<Project>(`/projects/${id}`, data).then((r) => r.data);

export const deleteProject = (id: string) =>
  api.delete(`/projects/${id}`);

export const getProjectTree = () =>
  api.get<ProjectTree[]>('/projects/tree').then((r) => r.data);

export const getProjectProgress = (projectId: string) =>
  api.get<ProjectProgress>(`/projects/${projectId}/progress`).then((r) => r.data);

// Tasks
export const getTasks = (projectId: string, status?: string) =>
  api.get<Task[]>(`/projects/${projectId}/tasks`, { params: { status } }).then((r) => r.data);

export const createTask = (projectId: string, data: TaskCreate) =>
  api.post<Task>(`/projects/${projectId}/tasks`, data).then((r) => r.data);

export const updateTask = (taskId: string, data: Partial<Task>) =>
  api.put<Task>(`/tasks/${taskId}`, data).then((r) => r.data);

export const deleteTask = (taskId: string) =>
  api.delete(`/tasks/${taskId}`);

export const changeTaskStatus = (taskId: string, status: Task['status']) =>
  api.put<Task>(`/tasks/${taskId}/status`, { status }).then((r) => r.data);

export const moveTask = (taskId: string, sort_order: number) =>
  api.put<Task>(`/tasks/${taskId}/move`, { sort_order }).then((r) => r.data);

export const createSubProject = (taskId: string, data: { name: string; description?: string }) =>
  api.post<Task>(`/tasks/${taskId}/create-sub-project`, data).then((r) => r.data);

// Execution Configs
export const getExecutionConfigs = () =>
  api.get<ExecutionConfig[]>('/execution-configs').then((r) => r.data);

export const createExecutionConfig = (data: ExecutionConfigCreate) =>
  api.post<ExecutionConfig>('/execution-configs', data).then((r) => r.data);

export const updateExecutionConfig = (id: string, data: Partial<ExecutionConfigCreate>) =>
  api.put<ExecutionConfig>(`/execution-configs/${id}`, data).then((r) => r.data);

export const deleteExecutionConfig = (id: string) =>
  api.delete(`/execution-configs/${id}`);

export const executeTask = (taskId: string, configId: string) =>
  api.post<ExecuteResult>(`/tasks/${taskId}/execute`, { config_id: configId }).then((r) => r.data);

// Activity Logs
export const getActivityLogs = (projectId: string, limit = 50) =>
  api.get<ActivityLog[]>(`/projects/${projectId}/activity-logs`, { params: { limit } }).then((r) => r.data);

// Board
export const getBoard = (projectId: string) =>
  api.get<Board>(`/projects/${projectId}/board`).then((r) => r.data);

// Code Projects
export const getCodeProjects = () =>
  api.get<CodeProject[]>('/code-projects').then((r) => r.data);

export const createCodeProject = (data: CodeProjectCreate) =>
  api.post<CodeProject>('/code-projects', data).then((r) => r.data);

export const updateCodeProject = (id: string, data: Partial<CodeProjectCreate>) =>
  api.put<CodeProject>(`/code-projects/${id}`, data).then((r) => r.data);

export const deleteCodeProject = (id: string) =>
  api.delete(`/code-projects/${id}`);

// Worktree Configs
export const getWorktreeConfigs = () =>
  api.get<WorktreeConfig[]>('/worktree-configs').then((r) => r.data);

export const createWorktreeConfig = (data: WorktreeConfigCreate) =>
  api.post<WorktreeConfig>('/worktree-configs', data).then((r) => r.data);

export const updateWorktreeConfig = (id: string, data: Partial<WorktreeConfigCreate>) =>
  api.put<WorktreeConfig>(`/worktree-configs/${id}`, data).then((r) => r.data);

export const deleteWorktreeConfig = (id: string) =>
  api.delete(`/worktree-configs/${id}`);

// Task Worktree
export const createTaskWorktree = (taskId: string, configId: string) =>
  api.post<Worktree>(`/tasks/${taskId}/worktree`, { config_id: configId }).then((r) => r.data);

export const getTaskWorktree = (taskId: string) =>
  api.get<Worktree>(`/tasks/${taskId}/worktree`).then((r) => r.data);

export const rebuildTaskWorktree = (taskId: string, configId: string) =>
  api.put<Worktree>(`/tasks/${taskId}/worktree`, { config_id: configId }).then((r) => r.data);

export const openTaskWorktree = (taskId: string) =>
  api.post(`/tasks/${taskId}/worktree/open`);

export const deleteTaskWorktree = (taskId: string) =>
  api.delete(`/tasks/${taskId}/worktree`);

// Recent tasks
export const getRecentTasks = (limit = 15) =>
  api.get<SearchResult[]>('/tasks/recent', { params: { limit } }).then((r) => r.data);

// Search
export const searchTasks = (q: string) =>
  api.get<SearchResult[]>('/tasks/search', { params: { q } }).then((r) => r.data);

// Statistics
export const getStatistics = (projectId?: string) =>
  api.get<Statistics>('/statistics', { params: projectId ? { project_id: projectId } : {} }).then((r) => r.data);

// Trash
export const getTrash = () =>
  api.get<TrashData>('/trash').then((r) => r.data);

export const restoreProject = (id: string) =>
  api.post<Project>(`/projects/${id}/restore`).then((r) => r.data);

export const restoreTask = (id: string) =>
  api.post<Task>(`/tasks/${id}/restore`).then((r) => r.data);
