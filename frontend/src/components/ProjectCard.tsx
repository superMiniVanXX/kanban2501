import { Link } from 'react-router-dom';
import type { Project } from '../types';

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  on_hold: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-gray-100 text-gray-600',
  archived: 'bg-gray-100 text-gray-400',
};

interface Props {
  project: Project;
  isChild?: boolean;
}

export default function ProjectCard({ project, isChild }: Props) {
  return (
    <Link
      to={`/projects/${project.id}/board`}
      className={`block hover:bg-white/60 transition-colors ${isChild ? 'px-4 py-3 pl-6' : 'px-5 py-4'}`}
    >
      <div className="flex items-center justify-between">
        <h3 className={`font-semibold text-gray-900 ${isChild ? 'text-sm' : 'text-base'}`}>
          {isChild && <span className="text-gray-300 mr-1.5">└</span>}
          {project.name}
        </h3>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[project.status] || 'bg-gray-100'}`}>
            {project.status}
          </span>
        </div>
      </div>
      {project.description && (
        <p className={`text-gray-500 line-clamp-1 ${isChild ? 'text-xs mt-0.5' : 'text-sm mt-1'}`}>
          {project.description}
        </p>
      )}
      {!isChild && (
        <div className="mt-2 text-xs text-gray-400">
          Created {new Date(project.created_at).toLocaleDateString()}
        </div>
      )}
    </Link>
  );
}
