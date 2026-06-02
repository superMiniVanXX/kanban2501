import { Link } from 'react-router-dom';
import type { Project } from '../types';
import { updateProject } from '../services/api';

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
  onUpdate?: (project: Project) => void;
}

export default function ProjectCard({ project, isChild, onUpdate }: Props) {
  const toggleExclude = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const updated = await updateProject(project.id, { exclude_from_stats: !project.exclude_from_stats });
    onUpdate?.(updated);
  };

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
          <button
            onClick={toggleExclude}
            title={project.exclude_from_stats ? 'Include in statistics' : 'Exclude from statistics'}
            className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
              project.exclude_from_stats
                ? 'text-amber-500 hover:text-amber-600'
                : 'text-gray-300 hover:text-gray-400'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </button>
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
      {project.exclude_from_stats && (
        <span className="inline-flex items-center gap-0.5 text-xs text-amber-600 font-medium mt-1">
          Excluded from stats
        </span>
      )}
      {!isChild && (
        <div className="mt-2 text-xs text-gray-400">
          Created {new Date(project.created_at).toLocaleDateString()}
        </div>
      )}
    </Link>
  );
}
