import type { Task } from '../types';

// Reusable status color palette, aligned with KanbanColumn.tsx headers.
// `bar` = lighter shade for stacked-bar segments; `solid` = stronger for dots/badges.
export const STATUS_COLOR: Record<Task['status'], { bar: string; solid: string; text: string }> = {
  backlog:     { bar: 'bg-slate-300',   solid: 'bg-slate-500',   text: 'text-slate-600' },
  todo:        { bar: 'bg-blue-400',    solid: 'bg-blue-600',    text: 'text-blue-600' },
  in_progress: { bar: 'bg-amber-400',   solid: 'bg-amber-600',   text: 'text-amber-600' },
  review:      { bar: 'bg-violet-400',  solid: 'bg-violet-600',  text: 'text-violet-600' },
  done:        { bar: 'bg-emerald-400', solid: 'bg-emerald-600', text: 'text-emerald-600' },
  verify:      { bar: 'bg-cyan-400',    solid: 'bg-cyan-600',    text: 'text-cyan-600' },
  complete:    { bar: 'bg-teal-400',    solid: 'bg-teal-600',    text: 'text-teal-600' },
  cancelled:   { bar: 'bg-gray-300',    solid: 'bg-gray-500',    text: 'text-gray-500' },
};

// Order in which statuses appear in stacked bars and legends (left-to-right).
export const STATUS_ORDER: Task['status'][] = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'verify',
  'complete',
  'cancelled',
];
