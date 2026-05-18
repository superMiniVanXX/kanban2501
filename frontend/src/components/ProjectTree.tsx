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
      <div className="px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200/60">
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
        className={`group flex items-center gap-1 pr-2 cursor-pointer transition-colors ${
          isActive
            ? 'bg-blue-50 border-l-[3px] border-blue-500'
            : 'hover:bg-gray-100/80 border-l-[3px] border-transparent'
        }`}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className={`w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-700 flex-shrink-0 transition-transform rounded hover:bg-gray-200/60 ${
            !hasChildren ? 'invisible' : expanded ? 'rotate-0' : '-rotate-90'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <Link
          to={`/projects/${project.id}/board`}
          className={`flex-1 py-2 min-w-0 ${isActive ? 'text-blue-700 font-semibold' : 'text-gray-700 hover:text-gray-900'} ${project.is_completed ? 'line-through opacity-50' : ''}`}
        >
          <span className="truncate block">{project.name}</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${project.is_completed ? 'bg-emerald-500' : 'bg-blue-500'}`}
                style={{ width: `${project.progress}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-400 font-medium tabular-nums flex-shrink-0">{project.progress}%</span>
          </div>
        </Link>

        {project.is_completed && (
          <span className="flex-shrink-0 text-emerald-500" title="Completed">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
          </span>
        )}

        {project.parent_id && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDetach(project.id); }}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-orange-500 text-xs flex-shrink-0 transition-all p-1 rounded hover:bg-orange-50"
            title="Detach from parent"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
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
