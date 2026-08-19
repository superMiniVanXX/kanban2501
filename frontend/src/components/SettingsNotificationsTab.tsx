import { useEffect, useState } from 'react';
import {
  getNotificationChannels,
  createNotificationChannel,
  updateNotificationChannel,
  deleteNotificationChannel,
  testNotificationChannel,
  syncHooks,
} from '../services/api';
import type { NotificationChannel, NotificationChannelCreate } from '../types';
import NotificationChannelEditor from './NotificationChannelEditor';
import NotificationLogList from './NotificationLogList';

export default function SettingsNotificationsTab() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [editing, setEditing] = useState<NotificationChannel | null>(null);
  const [creating, setCreating] = useState(false);
  const [logRefresh, setLogRefresh] = useState(0);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function reload() {
    setChannels(await getNotificationChannels());
  }

  useEffect(() => { reload(); }, []);

  async function handleSaveCreate(payload: NotificationChannelCreate) {
    await createNotificationChannel(payload);
    setCreating(false);
    await reload();
    setLogRefresh(x => x + 1);
  }

  async function handleSaveEdit(payload: NotificationChannelCreate) {
    if (!editing) return;
    await updateNotificationChannel(editing.id, payload);
    setEditing(null);
    await reload();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this channel?')) return;
    await deleteNotificationChannel(id);
    await reload();
  }

  async function handleTest(id: string) {
    await testNotificationChannel(id);
    setLogRefresh(x => x + 1);
  }

  async function handleSync() {
    setSyncMsg(null);
    try {
      const result = await syncHooks();
      setSyncMsg(`Forwarder ${result.forwarder_updated ? 'updated' : 'missing'}. Synced ${result.worktrees_synced} worktree(s).`);
      if (result.errors.length > 0) {
        setSyncMsg(m => m + ` ${result.errors.length} error(s).`);
      }
    } catch (e: any) {
      setSyncMsg(e?.response?.data?.detail ?? String(e));
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Channels</h3>
          <button onClick={() => setCreating(true)}
            className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            + New channel
          </button>
        </div>
        {channels.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No channels configured.</p>
        ) : (
          <div className="space-y-2">
            {channels.map(ch => (
              <div key={ch.id} className="flex items-center gap-3 px-4 py-2 bg-white border border-gray-200 rounded-lg">
                <span className={`px-2 py-0.5 rounded text-[11px] font-mono ${ch.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {ch.channel_type}
                </span>
                <span className="text-sm font-medium text-gray-800">{ch.name}</span>
                <span className="text-xs text-gray-400">
                  {ch.event_filters.length === 0 ? 'all events' : ch.event_filters.join(', ')}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => handleTest(ch.id)}
                    className="px-2 py-1 text-xs rounded text-gray-600 hover:bg-gray-100">Test</button>
                  <button onClick={() => setEditing(ch)}
                    className="px-2 py-1 text-xs rounded text-gray-600 hover:bg-gray-100">Edit</button>
                  <button onClick={() => handleDelete(ch.id)}
                    className="px-2 py-1 text-xs rounded text-red-600 hover:bg-red-50">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent dispatches</h3>
        <NotificationLogList refreshTrigger={logRefresh} />
      </section>

      <section className="bg-blue-50/50 border border-blue-200 rounded-lg p-4 text-xs text-gray-600">
        <div className="flex items-center justify-between mb-1">
          <p className="font-semibold text-gray-700">How agent hooks work</p>
          <button onClick={handleSync}
            className="px-3 py-1 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            Sync hooks
          </button>
        </div>
        <p>When kanban creates a worktree it installs two parallel agent hooks so the same channels fire regardless of which tool you run from the worktree:</p>
        <ul className="list-disc ml-5 mt-1 space-y-0.5">
          <li><b>Claude Code</b> — writes <code className="font-mono bg-white px-1 py-0.5 rounded">.claude/settings.json</code> entries pointing at a forwarder script in <code className="font-mono bg-white px-1 py-0.5 rounded">~/.config/kanban/hooks/</code>.</li>
          <li><b>opencode</b> — drops a self-contained plugin into <code className="font-mono bg-white px-1 py-0.5 rounded">.opencode/plugins/</code>.</li>
        </ul>
        <p className="mt-1">opencode events are mapped to Claude Code-equivalent names (<code className="font-mono bg-white px-1 py-0.5 rounded">session.idle</code>→<code className="font-mono bg-white px-1 py-0.5 rounded">Stop</code>, <code className="font-mono bg-white px-1 py-0.5 rounded">permission.asked</code>→<code className="font-mono bg-white px-1 py-0.5 rounded">Notification</code>), so one filter set covers both.</p>
        {syncMsg && <p className="mt-2 text-gray-700">{syncMsg}</p>}
      </section>

      {(creating || editing) && (
        <NotificationChannelEditor
          initial={editing}
          onSave={editing ? handleSaveEdit : handleSaveCreate}
          onCancel={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
