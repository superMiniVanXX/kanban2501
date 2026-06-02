export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'archived';
  parent_id: string | null;
  start_date: string | null;
  end_date: string | null;
  exclude_from_stats: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectTree extends Project {
  is_completed: boolean;
  progress: number;
  children: ProjectTree[];
}

export interface Task {
  id: string;
  project_id: string;
  wbs_element_id: string | null;
  sprint_id: string | null;
  title: string;
  description: string | null;
  status: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';
  priority: 'critical' | 'high' | 'medium' | 'low';
  task_type: 'task' | 'milestone' | 'epic';
  assignee: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  progress: number;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  sort_order: number;
  tags: string[] | null;
  sub_project_id: string | null;
  acceptance_criteria: string | null;
  implementation_plan: string | null;
  exclude_from_stats: boolean;
  code_projects: { id: string; name: string }[] | null;
  created_at: string;
  updated_at: string;
}

export interface Column {
  id: string;
  name: string;
  column_status: Task['status'];
  wip_limit: number | null;
  sort_order: number;
  tasks: Task[];
}

export interface Board {
  id: string;
  project_id: string;
  name: string;
  is_completed: boolean;
  columns: Column[];
}

export type ProjectCreate = Pick<Project, 'name'> & {
  description?: string;
  parent_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export interface CodeProject {
  id: string;
  name: string;
  description: string | null;
  repo_url: string | null;
  path: string | null;
  created_at: string;
  updated_at: string;
}

export type CodeProjectCreate = Pick<CodeProject, 'name'> & {
  description?: string;
  repo_url?: string;
  path?: string;
};

export interface ExecutionConfig {
  id: string;
  name: string;
  command_template: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export type ExecutionConfigCreate = Pick<ExecutionConfig, 'name' | 'command_template'> & {
  description?: string;
};

export interface ActivityLog {
  id: string;
  project_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  detail: string;
  extra_data: string | null;
  created_at: string;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  success: boolean;
}

export type TaskCreate = Pick<Task, 'title'> & {
  description?: string;
  priority?: Task['priority'];
  task_type?: Task['task_type'];
  assignee?: string;
  estimated_hours?: number;
  start_date?: string | null;
  due_date?: string | null;
  tags?: string[];
};

export interface SearchResult {
  id: string;
  project_id: string;
  title: string;
  status: Task['status'];
  priority: Task['priority'];
  task_type: Task['task_type'];
  assignee: string | null;
  due_date: string | null;
  sub_project_id: string | null;
  project_name: string;
}

export interface DailyStats {
  date: string;
  completed_count: number;
  progress_delta: number;
}

export interface WeeklyStats {
  week: string;
  completed_count: number;
  progress_delta: number;
}

export interface MonthlyStats {
  month: string;
  completed_count: number;
  progress_delta: number;
}

export interface ProjectProgress {
  total_estimated_hours: number;
  completed_estimated_hours: number;
  progress: number;
}

export interface TrashData {
  projects: Project[];
  tasks: Task[];
}

export interface Statistics {
  daily: DailyStats[];
  weekly: WeeklyStats[];
  monthly: MonthlyStats[];
}
