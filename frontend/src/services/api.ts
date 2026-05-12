import axios from 'axios';
import type { Project, ProjectCreate, Task, TaskCreate, Board } from '../types';

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

// Board
export const getBoard = (projectId: string) =>
  api.get<Board>(`/projects/${projectId}/board`).then((r) => r.data);
