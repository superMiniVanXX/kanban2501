import { useState, useEffect } from 'react';
import { getTrash, restoreProject, restoreTask } from '../services/api';
import type { TrashData } from '../types';

const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress',
  review: 'Review', done: 'Done', verify: 'Verify', complete: 'Complete',
  cancelled: 'Cancelled',
};

function EmptyTrash() {
  return (
    <div className="text-center py-20">
      <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
      <p className="text-gray-400 text-sm">Trash is empty</p>
    </div>
  );
}

export default function TrashPage() {
  const [data, setData] = useState<TrashData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTrash = () => {
    setLoading(true);
    getTrash().then(setData).finally(() => setLoading(false));
  };

  useEffect(() => { fetchTrash(); }, []);

  const refreshTrash = () => {
    getTrash().then(setData).catch(() => {});
  };

  const handleRestoreProject = async (id: string) => {
    await restoreProject(id);
    refreshTrash();
  };

  const handleRestoreTask = async (id: string) => {
    await restoreTask(id);
    refreshTrash();
  };

  const formatDate = (d: string | null) => {
    if (!d) return '';
    return new Date(d + 'Z').toLocaleString();
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Trash</h1>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data || (data.projects.length === 0 && data.tasks.length === 0) ? (
        <EmptyTrash />
      ) : (
        <div className="space-y-6">
          {/* Deleted Projects */}
          {data.projects.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Deleted Projects ({data.projects.length})
              </h2>
              <div className="space-y-2">
                {data.projects.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Deleted {(p as any).deleted_at ? formatDate((p as any).deleted_at) : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRestoreProject(p.id)}
                      className="ml-4 px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Deleted Tasks */}
          {data.tasks.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Deleted Tasks ({data.tasks.length})
              </h2>
              <div className="space-y-2">
                {data.tasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">{t.project_id ? 'Has project' : 'No project'}</span>
                        {t.status && (
                          <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-500">
                            {STATUS_LABEL[t.status] ?? t.status}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRestoreTask(t.id)}
                      className="ml-4 px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
