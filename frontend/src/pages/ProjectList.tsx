import { useState, useEffect, useMemo } from 'react';
import { getProjectTree, createProject, deleteProject, updateProject } from '../services/api';
import type { ProjectTree as ProjectTreeType, Project } from '../types';
import CreateProjectModal from '../components/CreateProjectModal';
import ProjectBentoCard from '../components/ProjectBentoCard';
import RecentActivityBoard from '../components/RecentActivityBoard';
import { computeCardWidth } from '../utils/projectSizing';

const CARD_ACCENTS = [
  { bar: 'bg-indigo-500',  bg: 'bg-white', hover: 'hover:border-indigo-200' },
  { bar: 'bg-emerald-500', bg: 'bg-white', hover: 'hover:border-emerald-200' },
  { bar: 'bg-amber-500',   bg: 'bg-white', hover: 'hover:border-amber-200' },
  { bar: 'bg-rose-500',    bg: 'bg-white', hover: 'hover:border-rose-200' },
  { bar: 'bg-cyan-500',    bg: 'bg-white', hover: 'hover:border-cyan-200' },
  { bar: 'bg-violet-500',  bg: 'bg-white', hover: 'hover:border-violet-200' },
  { bar: 'bg-teal-500',    bg: 'bg-white', hover: 'hover:border-teal-200' },
];

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

  const handleToggleExclude = async (project: ProjectTreeType) => {
    await updateProject(project.id, { exclude_from_stats: !project.exclude_from_stats });
    await fetchTree();
  };

  // Sort by total tasks desc so the biggest project anchors the top-left of the wall.
  const sortedTree = useMemo(
    () => [...tree].sort((a, b) => b.task_counts.total - a.task_counts.total),
    [tree],
  );

  // Width is max-normalized: largest project gets CARD_MAX_PX, others scale linearly.
  const maxTasks = useMemo(
    () => sortedTree.reduce((m, p) => Math.max(m, p.task_counts.total), 0),
    [sortedTree],
  );

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

      <RecentActivityBoard />

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
        <div className="flex flex-wrap gap-4 items-start">
          {sortedTree.map((project, i) => (
            <ProjectBentoCard
              key={project.id}
              project={project}
              widthPx={computeCardWidth(project.task_counts.total, maxTasks)}
              accent={CARD_ACCENTS[i % CARD_ACCENTS.length]}
              onToggleExclude={handleToggleExclude}
              onDelete={handleDelete}
            />
          ))}
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
