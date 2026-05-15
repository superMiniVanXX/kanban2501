import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ProjectTree as ProjectTreeType } from '../types';

interface TreeProps {
  projects: ProjectTreeType[];
  onDetach: (id: string) => Promise<void>;
}

export default function ProjectTree({ projects, onDetach }: TreeProps) {
  return (
    <div className="text-sm">
      <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
        Projects
      </div>
      {projects.map((p) => (
        <TreeNode key={p.id} project={p} depth={0} onDetach={onDetach} />
      ))}
    </div>
  );
}

function TreeNode({
  project,
  depth,
  onDetach,
}: {
  project: ProjectTreeType;
  depth: number;
  onDetach: (id: string) => Promise<void>;
}) {
  const { id: activeId } = useParams<{ id: string }>();
  const [expanded, setExpanded] = useState(true);
  const hasChildren = project.children.length > 0;
  const isActive = activeId === project.id;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 pr-2 cursor-pointer hover:bg-gray-100 transition-colors ${
          isActive ? 'bg-blue-50 border-r-2 border-blue-500' : ''
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className={`w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 flex-shrink-0 transition-transform ${
            !hasChildren ? 'invisible' : expanded ? 'rotate-0' : '-rotate-90'
          }`}
        >
          ▼
        </button>

        <Link
          to={`/projects/${project.id}/board`}
          className={`flex-1 py-1.5 truncate ${
            isActive ? 'text-blue-700 font-medium' : 'text-gray-700'
          }`}
        >
          {project.name}
        </Link>

        {project.parent_id && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDetach(project.id); }}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-orange-500 text-xs flex-shrink-0 transition-all"
            title="Detach from parent"
          >
            ↗
          </button>
        )}
      </div>

      {hasChildren && expanded && (
        <div>
          {project.children.map((child) => (
            <TreeNode key={child.id} project={child} depth={depth + 1} onDetach={onDetach} />
          ))}
        </div>
      )}
    </div>
  );
}
