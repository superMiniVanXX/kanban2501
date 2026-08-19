import { useState } from 'react';
import type { NotificationChannel, NotificationChannelCreate, NotificationChannelType } from '../types';

interface Props {
  initial?: NotificationChannel | null;
  onSave: (payload: NotificationChannelCreate) => Promise<void>;
  onCancel: () => void;
}

const TYPE_OPTIONS: { value: NotificationChannelType; label: string; hint: string }[] = [
  { value: 'desktop', label: 'Desktop', hint: 'notify-send (Linux)' },
  { value: 'webhook', label: 'Webhook', hint: 'Slack / Discord / Feishu / generic HTTP' },
  { value: 'sound', label: 'Sound', hint: 'Play an audio file (paplay)' },
  { value: 'email', label: 'Email', hint: 'SMTP relay' },
];

const EVENT_OPTIONS = ['Stop', 'Notification', 'SubagentStop', 'SessionEnd', 'task.done', 'task.complete', 'task.cancelled', 'task.review'];

export default function NotificationChannelEditor({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [channelType, setChannelType] = useState<NotificationChannelType>(initial?.channel_type ?? 'desktop');
  const [configText, setConfigText] = useState(JSON.stringify(initial?.config ?? {}, null, 2));
  const [eventFilters, setEventFilters] = useState<string[]>(initial?.event_filters ?? []);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  function toggleEvent(ev: string) {
    setEventFilters(prev => prev.includes(ev) ? prev.filter(x => x !== ev) : [...prev, ev]);
  }

  async function handleSave() {
    setError(null);
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(configText || '{}');
    } catch {
      setError('Config is not valid JSON');
      return;
    }
    try {
      await onSave({
        name, channel_type: channelType, config,
        event_filters: eventFilters,
        enabled,
      });
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? String(e));
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-[640px] max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{initial ? 'Edit channel' : 'New channel'}</h2>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
            <select value={channelType} onChange={e => setChannelType(e.target.value as NotificationChannelType)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} — {o.hint}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Config (JSON) — see docs for shape per type
            </label>
            <textarea value={configText} onChange={e => setConfigText(e.target.value)} rows={8}
              className="w-full font-mono text-xs border border-gray-200 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">
              Fire on events (empty = all events)
            </label>
            <div className="flex flex-wrap gap-2">
              {EVENT_OPTIONS.map(ev => (
                <label key={ev} className={`px-3 py-1 rounded-full text-xs cursor-pointer border ${eventFilters.includes(ev) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                  <input type="checkbox" checked={eventFilters.includes(ev)} onChange={() => toggleEvent(ev)}
                    className="hidden" />
                  {ev}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            Enabled
          </label>
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">Save</button>
        </div>
      </div>
    </div>
  );
}
