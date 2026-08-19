import axios from 'axios';
import type { Project, ActivityTask, ProjectCreate, ProjectTree, Task, TaskCreate, TaskUpdate, Board, ExecutionConfig, ExecutionConfigCreate, ExecuteResult, ActivityLog, SearchResult, CodeProject, CodeProjectCreate, Statistics, ProjectProgress, TrashData, WorktreeConfig, WorktreeConfigCreate, Worktree, WorktreeCreateParams, RemoteHost, RemoteHostCreate, SyncRequest, SyncResult, NotificationChannel, NotificationChannelCreate, NotificationChannelUpdate, NotificationLog, NotificationItem, AgentEventResult, SyncHooksResult } from '../types';

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

export const updateTask = (taskId: string, data: TaskUpdate) =>
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
export const createTaskWorktree = (taskId: string, params: WorktreeCreateParams) =>
  api.post<Worktree>(`/tasks/${taskId}/worktree`, params).then((r) => r.data);

export const getTaskWorktree = (taskId: string) =>
  api.get<Worktree>(`/tasks/${taskId}/worktree`).then((r) => r.data);

export const importTaskWorktree = (taskId: string, path: string) =>
  api.post<Worktree>(`/tasks/${taskId}/worktree/import`, { path }).then((r) => r.data);

export const rebuildTaskWorktree = (taskId: string, params: WorktreeCreateParams) =>
  api.put<Worktree>(`/tasks/${taskId}/worktree`, params).then((r) => r.data);

export const openTaskWorktree = (taskId: string) =>
  api.post(`/tasks/${taskId}/worktree/open`);

export const deleteTaskWorktree = (taskId: string) =>
  api.delete(`/tasks/${taskId}/worktree`);

// Remote Hosts
export const remoteHostApi = {
  list: () => api.get<RemoteHost[]>('/remote-hosts').then(r => r.data),
  create: (data: RemoteHostCreate) =>
    api.post<RemoteHost>('/remote-hosts', data).then(r => r.data),
  update: (id: string, data: Partial<RemoteHostCreate>) =>
    api.put<RemoteHost>(`/remote-hosts/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/remote-hosts/${id}`),
};

export const syncTask = (taskId: string, body: SyncRequest) =>
  api.post<SyncResult>(`/tasks/${taskId}/sync`, body).then(r => r.data);

// Recent tasks
export const getRecentTasks = (limit = 15) =>
  api.get<SearchResult[]>('/tasks/recent', { params: { limit } }).then((r) => r.data);

// Recent activity board
export const getRecentActivity = (days: number = 7) =>
  api.get<ActivityTask[]>('/tasks/activity', { params: { days } }).then((r) => r.data);

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

// Notification Channels
export async function getNotificationChannels(): Promise<NotificationChannel[]> {
  const r = await api.get('/notification-channels');
  return r.data;
}

export async function createNotificationChannel(
  payload: NotificationChannelCreate,
): Promise<NotificationChannel> {
  const r = await api.post('/notification-channels', payload);
  return r.data;
}

export async function updateNotificationChannel(
  id: string,
  payload: NotificationChannelUpdate,
): Promise<NotificationChannel> {
  const r = await api.put(`/notification-channels/${id}`, payload);
  return r.data;
}

export async function deleteNotificationChannel(id: string): Promise<void> {
  await api.delete(`/notification-channels/${id}`);
}

export async function testNotificationChannel(
  id: string,
): Promise<{ matched: number; status: string; detail: string | null; log_id: string | null }> {
  const r = await api.post(`/notification-channels/${id}/test`);
  return r.data;
}

export async function getNotificationLogs(
  channelId?: string,
  limit = 100,
): Promise<NotificationLog[]> {
  const params: Record<string, unknown> = { limit };
  if (channelId) params.channel_id = channelId;
  const r = await api.get('/notification-logs', { params });
  return r.data;
}

export async function postAgentEvent(payload: {
  event_type?: string;
  hook_event_name?: string;
  task_id?: string;
  project_id?: string;
  agent?: string;
  message?: string;
  cwd?: string;
}): Promise<AgentEventResult> {
  const r = await api.post('/agent-events', payload);
  return r.data;
}

// Hook sync
export async function syncHooks(): Promise<SyncHooksResult> {
  const r = await api.post('/hooks/sync');
  return r.data;
}

// Notification Queue (in-app notifications)
export async function getNotifications(opts?: {
  unreadOnly?: boolean;
  limit?: number;
}): Promise<NotificationItem[]> {
  const params: Record<string, unknown> = { limit: opts?.limit ?? 50 };
  if (opts?.unreadOnly) params.unread_only = true;
  const r = await api.get('/notifications', { params });
  return r.data;
}

export async function getUnreadNotificationCount(): Promise<{ count: number }> {
  const r = await api.get('/notifications/unread-count');
  return r.data;
}

export async function markNotificationRead(id: string): Promise<NotificationItem> {
  const r = await api.put(`/notifications/${id}/read`);
  return r.data;
}

export async function markAllNotificationsRead(): Promise<{ count: number }> {
  const r = await api.put('/notifications/read-all');
  return r.data;
}

export async function dismissNotification(id: string): Promise<void> {
  await api.delete(`/notifications/${id}`);
}

export async function clearReadNotifications(): Promise<{ count: number }> {
  const r = await api.delete('/notifications');
  return r.data;
}
