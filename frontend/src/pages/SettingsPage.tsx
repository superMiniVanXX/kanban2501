import { useState, useEffect } from 'react';
import type { ExecutionConfig, ExecutionConfigCreate, CodeProject, CodeCodeProjectCreate } from '../types';
import {
  getExecutionConfigs,
  createExecutionConfig,
  updateExecutionConfig,
  deleteExecutionConfig,
  getCodeProjects,
  createCodeProject,
  updateCodeProject,
  deleteCodeProject,
} from '../services/api';

const PLACEHOLDER_VARS = [
  '{task_id}', '{task_title}', '{task_status}', '{task_priority}', '{task_type}',
  '{task_assignee}', '{task_description}', '{task_acceptance_criteria}',
  '{task_due_date}', '{task_start_date}', '{task_estimated_hours}',
  '{task_actual_hours}', '{task_progress}', '{task_tags}', '{project_id}',
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'execution' | 'projects'>('execution');

  // Execution configs state
  const [configs, setConfigs] = useState<ExecutionConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ExecutionConfig | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ExecutionConfigCreate>({ name: '', command_template: '', description: '' });
  const [saving, setSaving] = useState(false);

  // Projects state
  const [codeProjects, setCodeProjects] = useState<CodeProject[]>([]);
  const [codeProjectLoading, setCodeProjectLoading] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [editingProject, setEditingProject] = useState<CodeProject | null>(null);
  const [projectForm, setProjectForm] = useState<CodeProjectCreate>({ name: '', description: '', repo_url: '' });
  const [projectSaving, setProjectSaving] = useState(false);

  const fetchConfigs = async () => {
    setLoading(true);
    setConfigs(await getExecutionConfigs());
    setLoading(false);
  };

  useEffect(() => { fetchConfigs(); }, []);

  const fetchCodeProjects = async () => {
    setCodeProjectLoading(true);
    setCodeProjects(await getCodeProjects());
    setCodeProjectLoading(false);
  };

  useEffect(() => { if (activeTab === 'projects') fetchCodeProjects(); }, [activeTab]);

  const resetForm = () => {
    setForm({ name: '', command_template: '', description: '' });
    setEditing(null);
    setShowForm(false);
  };

  const handleEdit = (config: ExecutionConfig) => {
    setForm({ name: config.name, command_template: config.command_template, description: config.description ?? '' });
    setEditing(config);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.command_template.trim()) return;
    setSaving(true);
    if (editing) {
      await updateExecutionConfig(editing.id, form);
    } else {
      await createExecutionConfig(form);
    }
    setSaving(false);
    resetForm();
    await fetchConfigs();
  };

  const handleDelete = async (id: string) => {
    await deleteExecutionConfig(id);
    await fetchConfigs();
  };

  // Project CRUD
  const resetProjectForm = () => {
    setProjectForm({ name: '', description: '', repo_url: '' });
    setEditingProject(null);
    setShowProjectForm(false);
  };

  const handleEditProject = (p: CodeProject) => {
    setProjectForm({ name: p.name, description: p.description ?? '', repo_url: p.repo_url ?? '' });
    setEditingProject(p);
    setShowProjectForm(true);
  };

  const handleSaveProject = async () => {
    if (!projectForm.name.trim()) return;
    setProjectSaving(true);
    if (editingProject) {
      await updateCodeProject(editingProject.id, projectForm);
    } else {
      await createCodeProject(projectForm);
    }
    setProjectSaving(false);
    resetProjectForm();
    await fetchCodeProjects();
  };

  const handleDeleteProject = async (id: string) => {
    await deleteCodeProject(id);
    await fetchCodeProjects();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Tab navigation */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => setActiveTab('execution')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'execution'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >Execution Configs</button>
        <button
          onClick={() => setActiveTab('projects')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'projects'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >Code Projects</button>
      </div>

      {/* Execution Configs tab */}
      {activeTab === 'execution' && (
        <>
          {/* Security warning */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6 text-sm text-amber-800">
            <span className="font-semibold">Security Notice:</span> Execution commands run as
            shell commands on the server. Only trusted administrators should configure and use
            execution commands.
          </div>

          {/* Available placeholders */}
          <details className="mb-6 bg-gray-50 rounded-lg px-4 py-3 border border-gray-200">
            <summary className="text-sm font-medium text-gray-600 cursor-pointer">
              Available Placeholder Variables
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {PLACEHOLDER_VARS.map((v) => (
                <code key={v} className="text-xs bg-gray-200 px-1.5 py-0.5 rounded text-gray-700">{v}</code>
              ))}
            </div>
          </details>

          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Execution Configurations</h2>
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                + Add Configuration
              </button>
            )}
          </div>

          {/* Add / Edit form */}
          {showForm && (
            <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Run CI Pipeline"
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Command Template</label>
                  <textarea
                    value={form.command_template}
                    onChange={(e) => setForm({ ...form, command_template: e.target.value })}
                    placeholder="e.g. curl -X POST https://ci.example.com/build -d 'task_id={task_id}&title={task_title}'"
                    rows={3}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Use placeholders like {'{task_id}'}, {'{task_title}'}, etc.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Description (optional)</label>
                  <input
                    type="text"
                    value={form.description ?? ''}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Brief description of what this does"
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleSave}
                  disabled={saving || !form.name.trim() || !form.command_template.trim()}
                  className="px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
                >
                  {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
                </button>
                <button
                  onClick={resetForm}
                  className="px-4 py-1.5 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Config list */}
          {loading ? (
            <div className="text-gray-400">Loading...</div>
          ) : configs.length === 0 ? (
            <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <p className="text-sm">No execution configurations yet</p>
              <p className="text-xs mt-1">Click "+ Add Configuration" to create one</p>
            </div>
          ) : (
            <div className="space-y-2">
              {configs.map((config) => (
                <div
                  key={config.id}
                  className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-start justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-gray-900 text-sm">{config.name}</h3>
                    <code className="text-xs text-gray-500 mt-1 block truncate bg-gray-50 rounded px-1.5 py-0.5">
                      {config.command_template}
                    </code>
                    {config.description && (
                      <p className="text-xs text-gray-400 mt-1">{config.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1.5 ml-3 flex-shrink-0">
                    <button
                      onClick={() => handleEdit(config)}
                      className="px-2.5 py-1 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 border border-gray-200 rounded-md transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(config.id)}
                      className="px-2.5 py-1 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 border border-gray-200 rounded-md transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Projects tab */}
      {activeTab === 'projects' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Code Projects</h2>
            {!showProjectForm && (
              <button
                onClick={() => setShowProjectForm(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                + Add Code Project
              </button>
            )}
          </div>

          {showProjectForm && (
            <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                  <input
                    type="text"
                    value={projectForm.name}
                    onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
                    placeholder="Project name"
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Description (optional)</label>
                  <input
                    type="text"
                    value={projectForm.description ?? ''}
                    onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
                    placeholder="Brief description"
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Repo URL (optional)</label>
                  <input
                    type="text"
                    value={projectForm.repo_url ?? ''}
                    onChange={(e) => setProjectForm({ ...projectForm, repo_url: e.target.value })}
                    placeholder="e.g. https://github.com/org/repo"
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleSaveProject}
                  disabled={projectSaving || !projectForm.name.trim()}
                  className="px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
                >
                  {projectSaving ? 'Saving...' : editingProject ? 'Update' : 'Create'}
                </button>
                <button
                  onClick={resetProjectForm}
                  className="px-4 py-1.5 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {codeProjectLoading ? (
            <div className="text-gray-400">Loading...</div>
          ) : codeProjects.length === 0 ? (
            <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <p className="text-sm">No code projects yet</p>
              <p className="text-xs mt-1">Click "+ Add Code Project" to create one</p>
            </div>
          ) : (
            <div className="space-y-2">
              {codeProjects.map((project) => (
                <div
                  key={project.id}
                  className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-start justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-gray-900 text-sm">{project.name}</h3>
                    {project.description && (
                      <p className="text-xs text-gray-400 mt-1">{project.description}</p>
                    )}
                    {project.repo_url && (
                      <a href={project.repo_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:text-blue-600 mt-1 block truncate">{project.repo_url}</a>
                    )}
                  </div>
                  <div className="flex gap-1.5 ml-3 flex-shrink-0">
                    <button
                      onClick={() => handleEditProject(project)}
                      className="px-2.5 py-1 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 border border-gray-200 rounded-md transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteProject(project.id)}
                      className="px-2.5 py-1 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 border border-gray-200 rounded-md transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
