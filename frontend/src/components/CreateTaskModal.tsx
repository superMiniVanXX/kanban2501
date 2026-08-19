import { useState, useEffect } from 'react';
import type { TaskCreate, WorktreeConfig, RemoteHost } from '../types';
import { getWorktreeConfigs, remoteHostApi } from '../services/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: TaskCreate) => Promise<void>;
  defaultStatus?: string;
}

export default function CreateTaskModal({ open, onClose, onSubmit, defaultStatus }: Props) {
  const [form, setForm] = useState<TaskCreate>({
    title: '',
    description: '',
    acceptance_criteria: '',
    priority: 'medium',
    assignee: '',
    estimated_hours: undefined,
    due_date: null,
  });
  const [loading, setLoading] = useState(false);
  const [wtConfigs, setWtConfigs] = useState<WorktreeConfig[]>([]);
  const [remoteHosts, setRemoteHosts] = useState<RemoteHost[]>([]);
  const [remoteHostId, setRemoteHostId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      getWorktreeConfigs().then(setWtConfigs).catch(() => {});
      remoteHostApi.list().then(setRemoteHosts).catch(console.error);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    await onSubmit({
      ...form,
      title: form.title.trim(),
      assignee: form.assignee?.trim() || undefined,
      estimated_hours: form.estimated_hours || undefined,
      remote_host_id: remoteHostId,
    });
    setForm({ title: '', description: '', acceptance_criteria: '', priority: 'medium', assignee: '', estimated_hours: undefined, due_date: null });
    setRemoteHostId(null);
    setLoading(false);
    onClose();
  };

  const set = (k: keyof TaskCreate, v: string | number | null) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">New Task {defaultStatus ? `→ ${defaultStatus}` : ''}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Task title"
            autoFocus
          />
          <textarea
            value={form.description || ''}
            onChange={(e) => set('description', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            placeholder="Description"
          />
          <textarea
            value={form.acceptance_criteria || ''}
            onChange={(e) => set('acceptance_criteria', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            rows={2}
            placeholder="Acceptance criteria (e.g. Given/When/Then)"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => set('priority', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Assignee</label>
              <input
                type="text"
                value={form.assignee || ''}
                onChange={(e) => set('assignee', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Name"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Est. Hours</label>
              <input
                type="number"
                value={form.estimated_hours ?? ''}
                onChange={(e) => set('estimated_hours', e.target.value ? Number(e.target.value) : null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                step="0.5"
                min="0"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Due Date</label>
              <input
                type="date"
                value={form.due_date || ''}
                onChange={(e) => set('due_date', e.target.value || null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Worktree 配置</label>
            <select
              value={form.worktree_config_id ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, worktree_config_id: e.target.value || undefined, worktree_branch: undefined, worktree_path: undefined, worktree_base_repo_path: undefined }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">请选择...</option>
              <option value="none">不使用 Worktree</option>
              <option value="manual">手动指定</option>
              {wtConfigs.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {form.worktree_config_id === 'manual' && (
            <div className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">主仓库路径</label>
                <input
                  type="text"
                  value={form.worktree_base_repo_path ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, worktree_base_repo_path: e.target.value || undefined }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  placeholder="/home/user/repo"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">分支名</label>
                <input
                  type="text"
                  value={form.worktree_branch ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, worktree_branch: e.target.value || undefined }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  placeholder="feature/my-branch"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">目录路径</label>
                <input
                  type="text"
                  value={form.worktree_path ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, worktree_path: e.target.value || undefined }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  placeholder="/home/user/worktrees/my-branch"
                />
              </div>
            </div>
          )}
          {remoteHosts.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Remote Host (optional)</label>
              <select
                value={remoteHostId || ''}
                onChange={(e) => setRemoteHostId(e.target.value || null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">None</option>
                {remoteHosts.map((h) => (
                  <option key={h.id} value={h.id}>{h.name} ({h.ssh_user}@{h.ssh_host})</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !form.title.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
