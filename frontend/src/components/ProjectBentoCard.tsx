import { Link } from 'react-router-dom';
import type { ProjectTree, TaskStatusCounts } from '../types';
import { getDensity, type Density } from '../utils/projectSizing';
import { STATUS_COLOR, STATUS_ORDER } from '../utils/statusColors';

const STATUS_STYLE: Record<string, { badge: string; dot: string }> = {
  planning:  { badge: 'bg-blue-50 text-blue-700 border-blue-200',     dot: 'bg-blue-400' },
  active:    { badge: 'bg-green-50 text-green-700 border-green-200',   dot: 'bg-green-400' },
  on_hold:   { badge: 'bg-yellow-50 text-yellow-700 border-yellow-200', dot: 'bg-yellow-400' },
  completed: { badge: 'bg-gray-50 text-gray-500 border-gray-200',      dot: 'bg-gray-400' },
  archived:  { badge: 'bg-gray-50 text-gray-400 border-gray-200',      dot: 'bg-gray-300' },
};

interface Props {
  project: ProjectTree;
  widthPx: number;
  accent: { bar: string; bg: string; hover: string };
  onToggleExclude: (project: ProjectTree) => void;
  onDelete: (id: string) => void;
}

export default function ProjectBentoCard({ project, widthPx, accent, onToggleExclude, onDelete }: Props) {
  const statusStyle = STATUS_STYLE[project.status] ?? STATUS_STYLE.planning;
  const childCount = project.children.length;
  const counts = project.task_counts;
  const total = counts.total;
  const density: Density = getDensity(widthPx);
  const isCompact = density === 'compact';
  const isExpanded = density === 'expanded';

  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : null);
  const startDate = fmtDate(project.start_date);
  const endDate = fmtDate(project.end_date);
  const showDateRange = startDate || endDate;

  return (
    <div
      style={{ width: `${widthPx}px` }}
      className={`group relative ${accent.bg} rounded-xl border border-gray-200 ${accent.hover} shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col flex-shrink-0`}
    >
      <div className={`h-1 ${accent.bar}`} />

      <Link to={`/projects/${project.id}/board`} className="flex-1 block p-4">
        <div className="flex items-center gap-2 pr-14">
          <h3 className={`font-bold text-gray-900 truncate ${isExpanded ? 'text-xl' : 'text-base'}`}>
            {project.name}
          </h3>
          {project.is_completed && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex-shrink-0">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              Done
            </span>
          )}
        </div>

        {/* Description — hidden in compact, 1 line in normal, 3 lines in expanded */}
        {!isCompact && (
          project.description ? (
            <p className={`text-sm text-gray-500 mt-1.5 min-h-[2.5rem] ${isExpanded ? 'line-clamp-3' : 'line-clamp-1'}`}>
              {project.description}
            </p>
          ) : (
            <p className="text-sm text-gray-300 italic mt-1.5 min-h-[2.5rem]">No description</p>
          )
        )}

        {/* Count headline */}
        <div className={`flex items-baseline gap-2 ${isCompact ? 'mt-2' : 'mt-3'}`}>
          <span className={`font-bold tabular-nums text-gray-900 ${isExpanded ? 'text-3xl' : isCompact ? 'text-xl' : 'text-2xl'}`}>
            {total}
          </span>
          <span className="text-xs text-gray-500 font-medium">
            {total === 1 ? 'task' : 'tasks'} · {project.progress}%
          </span>
        </div>

        <StackedStatusBar counts={counts} total={total} />

        {/* Per-status legend — only expanded */}
        {isExpanded && (
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {STATUS_ORDER.map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-sm ${STATUS_COLOR[s].bar}`} />
                <span className="text-gray-500 capitalize truncate">{s.replace('_', ' ')}</span>
                <span className="ml-auto text-gray-700 font-medium tabular-nums">{counts[s]}</span>
              </div>
            ))}
          </div>
        )}

        {/* Badges — compact: only status dot + count, hide labels */}
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${statusStyle.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
            {!isCompact && (project.status.charAt(0).toUpperCase() + project.status.slice(1).replace('_', ' '))}
          </span>
          {childCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
              {!isCompact && `${childCount} sub${childCount > 1 ? 's' : ''}`}
            </span>
          )}
          {project.exclude_from_stats && (
            <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 font-medium">
              {!isCompact ? 'No stats' : '—'}
            </span>
          )}
        </div>

        {/* Dates — only normal/expanded */}
        {!isCompact && (
          <div className="mt-3 text-xs text-gray-400 space-y-1">
            <div className="flex items-center gap-1.5">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              Created {new Date(project.created_at).toLocaleDateString()}
            </div>
            {showDateRange && (
              <div className="flex items-center gap-1.5">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="truncate">
                  {startDate ?? '—'} <span className="text-gray-300 mx-0.5">→</span> {endDate ?? '—'}
                </span>
              </div>
            )}
          </div>
        )}
      </Link>

      {/* Hover actions — top-right corner */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleExclude(project); }}
          className={`p-1.5 rounded-lg border bg-white/90 backdrop-blur-sm shadow-sm transition-colors ${
            project.exclude_from_stats
              ? 'text-amber-600 hover:bg-amber-50 border-amber-200'
              : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50 border-gray-200 hover:border-amber-200'
          }`}
          title={project.exclude_from_stats ? 'Include in statistics' : 'Exclude from statistics'}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(project.id); }}
          className="p-1.5 rounded-lg border bg-white/90 backdrop-blur-sm shadow-sm text-gray-400 hover:text-red-600 hover:bg-red-50 border-gray-200 hover:border-red-200 transition-colors"
          title="Delete project"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function StackedStatusBar({ counts, total }: { counts: TaskStatusCounts; total: number }) {
  if (total === 0) {
    return <div className="mt-3 h-px bg-gray-200" />;
  }
  return (
    <div className="flex mt-3 h-1.5 rounded-full overflow-hidden bg-gray-100">
      {STATUS_ORDER.map((s) => {
        const v = counts[s];
        if (!v) return null;
        const width = (v / total) * 100;
        return (
          <div
            key={s}
            className={`${STATUS_COLOR[s].bar} transition-all duration-300`}
            style={{ width: `${width}%` }}
            title={`${s.replace('_', ' ')}: ${v}`}
          />
        );
      })}
    </div>
  );
}
