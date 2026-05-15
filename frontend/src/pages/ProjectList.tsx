import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getProjectTree, createProject, deleteProject } from '../services/api';
import type { ProjectTree as ProjectTreeType, Project } from '../types';
import CreateProjectModal from '../components/CreateProjectModal';

const CARD_COLORS = [
  { border: 'border-l-indigo-400', bg: 'bg-indigo-50/50', badge: 'bg-indigo-100 text-indigo-700' },
  { border: 'border-l-emerald-400', bg: 'bg-emerald-50/50', badge: 'bg-emerald-100 text-emerald-700' },
  { border: 'border-l-amber-400', bg: 'bg-amber-50/50', badge: 'bg-amber-100 text-amber-700' },
  { border: 'border-l-rose-400', bg: 'bg-rose-50/50', badge: 'bg-rose-100 text-rose-700' },
  { border: 'border-l-cyan-400', bg: 'bg-cyan-50/50', badge: 'bg-cyan-100 text-cyan-700' },
  { border: 'border-l-violet-400', bg: 'bg-violet-50/50', badge: 'bg-violet-100 text-violet-700' },
  { border: 'border-l-teal-400', bg: 'bg-teal-50/50', badge: 'bg-teal-100 text-teal-700' },
];

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  on_hold: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-gray-100 text-gray-600',
  archived: 'bg-gray-100 text-gray-400',
};

export default function ProjectList() {
  const [tree, setTree] = useState<ProjectTreeType[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  const collectProjects = (nodes: ProjectTreeType[]): Project[] => {
    const result: Project[] = [];
    for (const n of nodes) {
      const { children, ...project } = n;
      result.push(project as Project);
      if (children.length > 0) result.push(...collectProjects(children));
    }
    return result;
  };

  const fetchTree = async () => {
    setLoading(true);
    const data = await getProjectTree();
    setTree(data);
    setLoading(false);
  };

  useEffect(() => { fetchTree(); }, []);

  const handleCreate = async (data: { name: string; description: string; parent_id: string | null }) => {
    await createProject(data);
    await fetchTree();
  };

  const handleDelete = async (id: string) => {
    await deleteProject(id);
    await fetchTree();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          + New Project
        </button>
      </div>

      {loading ? (
        <div className="text-gray-400">Loading...</div>
      ) : tree.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg mb-2">No projects yet</p>
          <p className="text-sm">Click "New Project" to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tree.map((project, i) => {
            const color = CARD_COLORS[i % CARD_COLORS.length];
            const childCount = project.children.length;
            return (
              <div
                key={project.id}
                className={`rounded-lg border border-gray-200 border-l-4 ${color.border} ${color.bg}`}
              >
                <Link
                  to={`/projects/${project.id}/board`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-white/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900 text-base truncate">
                        {project.name}
                      </h3>
                      {childCount > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${color.badge}`}>
                          {childCount}
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <p className="text-sm text-gray-500 line-clamp-1 mt-1">
                        {project.description}
                      </p>
                    )}
                    <div className="mt-2 text-xs text-gray-400">
                      Created {new Date(project.created_at).toLocaleDateString()}
                      {childCount > 0 && (
                        <span className="ml-2">· {childCount} sub-project{childCount > 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[project.status] || 'bg-gray-100'}`}>
                      {project.status}
                    </span>
                  </div>
                </Link>
                <div className="flex justify-end px-5 pb-3">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(project.id); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 border border-gray-300 hover:border-red-300 rounded-md transition-colors"
                    title="Delete project"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateProjectModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreate}
        projects={collectProjects(tree)}
      />
    </div>
  );
}
