import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getProjectTree, createProject, deleteProject } from '../services/api';
import type { ProjectTree as ProjectTreeType, Project } from '../types';
import CreateProjectModal from '../components/CreateProjectModal';

const CARD_ACCENTS = [
  { bar: 'bg-indigo-500',  bg: 'bg-white',       hover: 'hover:border-indigo-200' },
  { bar: 'bg-emerald-500', bg: 'bg-white',       hover: 'hover:border-emerald-200' },
  { bar: 'bg-amber-500',   bg: 'bg-white',       hover: 'hover:border-amber-200' },
  { bar: 'bg-rose-500',    bg: 'bg-white',       hover: 'hover:border-rose-200' },
  { bar: 'bg-cyan-500',    bg: 'bg-white',       hover: 'hover:border-cyan-200' },
  { bar: 'bg-violet-500',  bg: 'bg-white',       hover: 'hover:border-violet-200' },
  { bar: 'bg-teal-500',    bg: 'bg-white',       hover: 'hover:border-teal-200' },
];

const STATUS_STYLE: Record<string, { badge: string; dot: string }> = {
  planning:  { badge: 'bg-blue-50 text-blue-700 border-blue-200',   dot: 'bg-blue-400' },
  active:    { badge: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-400' },
  on_hold:   { badge: 'bg-yellow-50 text-yellow-700 border-yellow-200', dot: 'bg-yellow-400' },
  completed: { badge: 'bg-gray-50 text-gray-500 border-gray-200',   dot: 'bg-gray-400' },
  archived:  { badge: 'bg-gray-50 text-gray-400 border-gray-200',   dot: 'bg-gray-300' },
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your projects and track progress</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium shadow-sm shadow-blue-600/20 hover:shadow-md hover:shadow-blue-600/25 transition-all active:scale-[0.98]"
        >
          + New Project
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tree.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-2xl border-2 border-dashed border-gray-200">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-2xl flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <p className="text-lg font-medium text-gray-600 mb-1">No projects yet</p>
          <p className="text-sm text-gray-400">Click "New Project" to get started</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tree.map((project, i) => {
            const accent = CARD_ACCENTS[i % CARD_ACCENTS.length];
            const childCount = project.children.length;
            const statusStyle = STATUS_STYLE[project.status] ?? STATUS_STYLE.planning;
            return (
              <div
                key={project.id}
                className={`group relative ${accent.bg} rounded-xl border border-gray-200 ${accent.hover} shadow-sm hover:shadow-lg transition-all duration-200 overflow-hidden`}
              >
                {/* Top accent bar */}
                <div className={`h-1 ${accent.bar}`} />

                <Link
                  to={`/projects/${project.id}/board`}
                  className="flex items-center justify-between px-6 py-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-bold text-gray-900 text-lg truncate">
                        {project.name}
                      </h3>
                      {project.is_completed && (
                        <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                          Done
                        </span>
                      )}
                      {childCount > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                          {childCount} sub{childCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <p className="text-sm text-gray-500 line-clamp-1 mt-1.5">
                        {project.description}
                      </p>
                    )}
                    <div className="mt-3 text-xs text-gray-400 flex items-center gap-3">
                      <span>Created {new Date(project.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${project.is_completed ? 'bg-emerald-500' : 'bg-blue-500'}`}
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 font-semibold tabular-nums">{project.progress}%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                    <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border font-medium ${statusStyle.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                      {project.status.charAt(0).toUpperCase() + project.status.slice(1).replace('_', ' ')}
                    </span>
                    <svg className="w-5 h-5 text-gray-300 group-hover:text-gray-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>

                {/* Delete — visible on hover */}
                <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(project.id); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-red-600 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg transition-colors"
                    title="Delete project"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
