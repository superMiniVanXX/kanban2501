export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'archived';
  parent_id: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectTree extends Project {
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
  columns: Column[];
}

export type ProjectCreate = Pick<Project, 'name'> & {
  description?: string;
  parent_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

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
