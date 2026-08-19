import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { Task, ExecutionConfig, ExecuteResult, RemoteHost, SyncResult } from '../types';
import { executeTask, updateCodeProject, updateTask, openTaskWorktree, remoteHostApi, syncTask } from '../services/api';
import { useFixedDropdown } from '../hooks/useFixedDropdown';

const PRIORITY_STYLE: Record<string, { bar: string; bg: string; badge: string; title: string; progress: string }> = {
  critical: { bar: 'bg-red-500',    bg: 'bg-white',   badge: 'bg-red-100 text-red-700 border-red-200',   title: 'text-gray-900', progress: 'bg-red-500' },
  high:     { bar: 'bg-orange-500', bg: 'bg-white',   badge: 'bg-orange-100 text-orange-700 border-orange-200', title: 'text-gray-900', progress: 'bg-orange-500' },
  medium:   { bar: 'bg-sky-400',    bg: 'bg-white',   badge: 'bg-sky-50 text-sky-600 border-sky-200',    title: 'text-gray-900', progress: 'bg-sky-400' },
  low:      { bar: 'bg-gray-300',   bg: 'bg-white',   badge: 'bg-gray-100 text-gray-500 border-gray-200', title: 'text-gray-700', progress: 'bg-gray-300' },
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Med',
  low: 'Low',
};

const TYPE_ICON: Record<string, string> = {
  task: '',
  milestone: '◆ ',
  epic: '⚡ ',
};

/** Extract a human-readable detail string from an unknown error (typically axios). */
function getErrorDetail(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: unknown }).response;
    if (resp && typeof resp === 'object' && 'data' in resp) {
      const data = (resp as { data?: unknown }).data;
      if (data && typeof data === 'object' && 'detail' in data) {
        const detail = (data as { detail?: unknown }).detail;
        if (typeof detail === 'string') return detail;
      }
    }
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

interface PathModalState {
  codeProjectId: string;
  codeProjectName: string;
  configId: string;
}

interface Props {
  task: Task;
  onClick: (task: Task) => void;
  executionConfigs: ExecutionConfig[];
  isPendingDeletion?: boolean;
  onConfirmDelete?: (taskId: string) => void;
  onUndoDelete?: (taskId: string) => void;
}

export default function TaskCard({ task, onClick, executionConfigs, isPendingDeletion, onConfirmDelete, onUndoDelete }: Props) {
  const ps = PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.medium;
  const [showDropdown, setShowDropdown] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [pathModal, setPathModal] = useState<PathModalState | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [pathSaving, setPathSaving] = useState(false);
  const { triggerRef, elRef, style: dropdownStyle } = useFixedDropdown(showDropdown, { align: 'right' });
  const menuRef = useRef<HTMLDivElement>(null);
  const showExecute = !task.sub_project_id && executionConfigs.length > 0;
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  // Remote sync state (button + modal live on the card)
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncHostId, setSyncHostId] = useState<string | null>(null);
  const [syncPassword, setSyncPassword] = useState('');
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [remoteHosts, setRemoteHosts] = useState<RemoteHost[]>([]);

  useEffect(() => {
    remoteHostApi.list().then(setRemoteHosts).catch((err) => console.error('Failed to load remote hosts', err));
  }, []);

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && !['done', 'verify', 'complete', 'cancelled'].includes(task.status);

  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !elRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(t);
  }, [result]);

  const doExecute = async (configId: string) => {
    setExecuting(configId);
    try {
      const r = await executeTask(task.id, configId);
      setResult(r);
    } catch (err: any) {
      const detail: string = err.response?.data?.detail || err.message || 'Execution failed';
      setResult({ stdout: '', stderr: detail, exit_code: -1, success: false });
    } finally {
      setExecuting(null);
    }
  };

  const handleExecute = (configId: string) => {
    setShowDropdown(false);
    if (!task.worktree_config_id) {
      setResult({ stdout: '', stderr: '任务执行前必须配置 Worktree。请在任务详情中选择「不使用 Worktree」或指定一个 Worktree 配置。', exit_code: -1, success: false });
      return;
    }
    const cp = task.code_projects?.[0];
    if (cp) {
      setPathModal({ codeProjectId: cp.id, codeProjectName: cp.name, configId });
      setPathInput(cp.path || '');
      return;
    }
    doExecute(configId);
  };

  const handleConfirmExecute = async () => {
    if (!pathModal || !pathInput.trim()) return;
    setPathSaving(true);
    try {
      await updateCodeProject(pathModal.codeProjectId, { path: pathInput.trim() });
      setPathModal(null);
      setPathInput('');
      doExecute(pathModal.configId);
    } catch {
      alert('Failed to save path');
    } finally {
      setPathSaving(false);
    }
  };

  return (
    <div className={`${ps.bg} rounded-xl shadow-sm hover:shadow-lg border border-gray-200/80 transition-all duration-200 group relative ${isPendingDeletion ? 'opacity-50 grayscale' : ''}`}>
      {/* Priority top bar */}
      <div className={`h-1 ${ps.bar} rounded-t-xl`} />

      <div
        className={`p-3.5 transition-all duration-200 ${isPendingDeletion ? 'cursor-default' : 'cursor-pointer hover:-translate-y-0.5'}`}
        onClick={() => { if (!isPendingDeletion) onClick(task); }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className={`text-sm font-semibold ${ps.title} flex-1 min-w-0 leading-snug`}>
            {editingTitle ? (
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={async () => {
                  if (titleDraft.trim() && titleDraft.trim() !== task.title) {
                    await updateTask(task.id, { title: titleDraft.trim() });
                  }
                  setEditingTitle(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                  if (e.key === 'Escape') { setEditingTitle(false); }
                }}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                className="w-full text-sm font-semibold bg-white border border-blue-300 rounded px-1 py-0 focus:ring-2 focus:ring-blue-400 focus:outline-none"
              />
            ) : (
              <span
                onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); setTitleDraft(task.title); }}
              >
                {TYPE_ICON[task.task_type] ?? ''}{task.title}
              </span>
            )}
          </div>
          {showExecute && (
            <div className="relative flex-shrink-0">
              <button
                ref={triggerRef}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setShowDropdown((v) => !v); }}
                className={`w-6 h-6 flex items-center justify-center rounded-md text-xs transition-all ${
                  result
                    ? result.success
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      : 'bg-red-100 text-red-700 hover:bg-red-200'
                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
                }`}
                title={result ? (result.success ? 'Success' : `Error: ${result.stderr}`) : 'Execute'}
              >
                {executing ? (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {showDropdown && createPortal(
                <div ref={menuRef} className="w-44 bg-white rounded-lg shadow-xl border border-gray-200 py-1" style={dropdownStyle}>
                  {executionConfigs.map((config) => (
                    <button
                      key={config.id}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); handleExecute(config.id); }}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    >
                      {config.name}
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>
          )}
        </div>

        <div className="flex items-center flex-wrap gap-1.5 mt-2">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${ps.badge}`}>
            {PRIORITY_LABELS[task.priority]}
          </span>
          {task.exclude_from_stats && (
            <span className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-400 font-medium">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" /></svg>
              No stats
            </span>
          )}
          {task.due_date && (
            <span className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-md ${
              isOverdue ? 'text-red-600 bg-red-50 font-medium' : 'text-gray-400'
            }`}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              {new Date(task.due_date).toLocaleDateString()}
            </span>
          )}
          {task.assignee && (
            <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-md text-xs font-medium">{task.assignee}</span>
          )}
        </div>

        {task.code_projects && task.code_projects.length > 0 && (
          <div className="flex items-center flex-wrap gap-1 mt-1.5">
            {task.code_projects.slice(0, 3).map((rp) => (
              <span
                key={rp.id}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-md bg-teal-50 text-teal-700 border border-teal-200 font-medium"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                {rp.name}
              </span>
            ))}
            {task.code_projects.length > 3 && (
              <span className="text-xs text-gray-400 font-medium">
                +{task.code_projects.length - 3} more
              </span>
            )}
          </div>
        )}

        {task.worktree && task.worktree.status !== 'removed' && (
          <div className="flex items-center flex-wrap gap-1 mt-1.5">
            {task.worktree.status === 'pending' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Worktree 待创建
              </span>
            )}
            {task.worktree.status === 'active' && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try { await openTaskWorktree(task.id); } catch { /* ignore */ }
                }}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-md bg-green-50 text-green-700 border border-green-200 font-medium hover:bg-green-100 hover:border-green-300 transition-colors cursor-pointer"
                title={`Open ${task.worktree.path}`}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                {task.worktree.branch}
              </button>
            )}
            {task.worktree.status === 'active' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSyncHostId(task.remote_host_id || (remoteHosts[0]?.id ?? null));
                  setSyncPassword('');
                  setSyncResult(null);
                  setSyncOpen(true);
                }}
                disabled={remoteHosts.length === 0}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-md bg-purple-50 text-purple-700 border border-purple-200 font-medium hover:bg-purple-100 hover:border-purple-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title={remoteHosts.length === 0 ? 'No remote hosts configured — add one in Settings' : 'Sync worktree to remote host via rsync'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Sync
              </button>
            )}
            {task.worktree.status === 'error' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-md bg-red-50 text-red-700 border border-red-200 font-medium" title={task.worktree.error_message ?? ''}>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                Worktree 错误
              </span>
            )}
          </div>
        )}

        {task.sub_project_id && (
          <Link
            to={`/projects/${task.sub_project_id}/board`}
            onClick={(e) => e.stopPropagation()}
            className="mt-2 inline-flex items-center gap-1 text-xs text-purple-600 bg-purple-50 rounded-md px-2 py-1 border border-purple-100 hover:bg-purple-100 hover:border-purple-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
            Sub-project &rarr;
          </Link>
        )}

        {isPendingDeletion && (
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={(e) => { e.stopPropagation(); onConfirmDelete?.(task.id); }}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
            >
              Confirm Delete
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onUndoDelete?.(task.id); }}
              className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-colors"
            >
              Undo
            </button>
          </div>
        )}

      </div>

      {/* Path configuration modal — portaled to document.body to escape Draggable containment */}
      {pathModal && createPortal(
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={(e) => { e.stopPropagation(); setPathModal(null); setPathInput(''); }}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-96 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-900 mb-1">确认工作目录</h3>
            <p className="text-xs text-gray-500 mb-4">
              代码项目 <span className="font-medium text-gray-700">{pathModal.codeProjectName}</span> 的工作目录：
            </p>
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="/home/user/project"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmExecute(); }}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setPathModal(null); setPathInput(''); }}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmExecute}
                disabled={!pathInput.trim() || pathSaving}
                className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {pathSaving ? '执行中...' : '执行'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Sync worktree to remote host modal — portaled to document.body */}
      {syncOpen && createPortal(
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
          onClick={() => !syncLoading && setSyncOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Sync worktree to remote host</h3>
              <button
                onClick={() => !syncLoading && setSyncOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                disabled={syncLoading}
              >
                &times;
              </button>
            </div>

            {task.worktree?.status !== 'active' ? (
              <p className="text-sm text-red-600">
                This task no longer has an active worktree. Close this dialog and create one first.
              </p>
            ) : remoteHosts.length === 0 ? (
              <p className="text-sm text-red-600">
                No remote hosts configured.{' '}
                <Link to="/settings" onClick={() => setSyncOpen(false)} className="text-purple-600 hover:underline">
                  Add one in Settings
                </Link>.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <div className="font-semibold text-gray-700 mb-0.5">Source</div>
                  <div className="font-mono break-all">{task.worktree.path}/</div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Host</label>
                  <select
                    value={syncHostId || ''}
                    onChange={(e) => setSyncHostId(e.target.value || null)}
                    disabled={syncLoading}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400 focus:outline-none font-medium"
                  >
                    <option value="">Select a host…</option>
                    {remoteHosts.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} — {h.ssh_user}@{h.ssh_host}:{h.ssh_port}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Password
                  </label>
                  <input
                    type="password"
                    value={syncPassword}
                    onChange={(e) => setSyncPassword(e.target.value)}
                    disabled={syncLoading}
                    placeholder="Optional"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400 focus:outline-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">Leave empty to use SSH key authentication</p>
                </div>

                {syncResult && (
                  <div className={`rounded-lg border p-3 text-sm ${
                    syncResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                  }`}>
                    <div className={`font-medium mb-2 ${syncResult.success ? 'text-green-800' : 'text-red-800'}`}>
                      {syncResult.success ? '✓ Sync succeeded' : `✗ Sync failed (exit ${syncResult.exit_code})`}
                    </div>
                    {syncResult.dest_path && (
                      <div className="text-xs text-gray-600 mb-2 font-mono break-all">
                        Destination: {syncResult.dest_path}
                      </div>
                    )}
                    {syncResult.stdout && (
                      <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700 mb-2 max-h-40 overflow-y-auto">{syncResult.stdout}</pre>
                    )}
                    {syncResult.stderr && (
                      <pre className="text-xs font-mono whitespace-pre-wrap text-red-700 max-h-40 overflow-y-auto">{syncResult.stderr}</pre>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setSyncOpen(false)}
                disabled={syncLoading}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                Close
              </button>
              <button
                disabled={!syncHostId || syncLoading || task.worktree?.status !== 'active' || remoteHosts.length === 0}
                onClick={async () => {
                  if (!syncHostId) return;
                  setSyncLoading(true);
                  setSyncResult(null);
                  try {
                    const result = await syncTask(task.id, {
                      host_id: syncHostId,
                      password: syncPassword || undefined,
                    });
                    setSyncResult(result);
                  } catch (err: unknown) {
                    setSyncResult({
                      success: false,
                      stdout: '',
                      stderr: getErrorDetail(err),
                      exit_code: -1,
                      command: '',
                      dest_path: '',
                      host_name: '',
                    });
                  } finally {
                    setSyncLoading(false);
                  }
                }}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {syncLoading && (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {syncLoading ? 'Syncing…' : 'Sync'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
