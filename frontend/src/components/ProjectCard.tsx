import { Link } from 'react-router-dom';
import type { Project } from '../types';

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  on_hold: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-gray-100 text-gray-600',
  archived: 'bg-gray-100 text-gray-400',
};

export default function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      to={`/projects/${project.id}/board`}
      className="block bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-semibold text-gray-900">{project.name}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[project.status] || 'bg-gray-100'}`}>
          {project.status}
        </span>
      </div>
      {project.description && (
        <p className="text-sm text-gray-500 line-clamp-2">{project.description}</p>
      )}
      <div className="mt-3 text-xs text-gray-400">
        Created {new Date(project.created_at).toLocaleDateString()}
      </div>
    </Link>
  );
}
