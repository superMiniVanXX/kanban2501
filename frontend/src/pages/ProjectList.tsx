import { useState, useEffect } from 'react';
import { getProjects, createProject, deleteProject } from '../services/api';
import type { Project } from '../types';
import ProjectCard from '../components/ProjectCard';
import CreateProjectModal from '../components/CreateProjectModal';

export default function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchProjects = async () => {
    setLoading(true);
    const data = await getProjects();
    setProjects(data);
    setLoading(false);
  };

  useEffect(() => { fetchProjects(); }, []);

  const handleCreate = async (data: { name: string; description: string }) => {
    await createProject(data);
    await fetchProjects();
  };

  const handleDelete = async (id: string) => {
    await deleteProject(id);
    await fetchProjects();
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
      ) : projects.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg mb-2">No projects yet</p>
          <p className="text-sm">Click "New Project" to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div key={p.id} className="relative group">
              <ProjectCard project={p} />
              <button
                onClick={(e) => { e.preventDefault(); handleDelete(p.id); }}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity text-sm"
                title="Delete project"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <CreateProjectModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}
