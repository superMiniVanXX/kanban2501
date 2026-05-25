import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { getStatistics, getProjects, getProjectProgress } from '../services/api';
import type { Statistics, Project, ProjectProgress } from '../types';

interface ProjectStats {
  project: Project;
  progress: ProjectProgress | null;
  dailyCompleted: number;
  weeklyCompleted: number;
  monthlyCompleted: number;
  dailyDelta: number;
  weeklyDelta: number;
  monthlyDelta: number;
}

function MiniBar({ value, maxValue, color }: { value: number; maxValue: number; color: string }) {
  const pct = maxValue > 0 ? Math.min((Math.abs(value) / maxValue) * 100, 100) : 0;
  return (
    <div className="flex-1 h-4 bg-gray-100 rounded-sm overflow-hidden">
      <div
        className={`h-full rounded-sm transition-all duration-500 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20">
      <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
      <p className="text-gray-400 text-sm">No statistics yet</p>
      <p className="text-gray-300 text-xs mt-1">Change task statuses to see data here</p>
    </div>
  );
}

export default function StatisticsPage() {
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [projectStatsList, setProjectStatsList] = useState<ProjectStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    getProjects().then((projects) => {
      setAllProjects(projects);
      const topLevelIds = projects
        .filter((p) => p.parent_id === null)
        .map((p) => p.id);
      setSelectedProjectIds(topLevelIds.length > 0 ? topLevelIds : projects.map((p) => p.id));
      initializedRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (!initializedRef.current) return;
    setLoading(true);

    const ids = selectedProjectIds.length > 0 ? selectedProjectIds : [''];
    Promise.all(
      ids.map((id) =>
        Promise.all([
          id ? getStatistics(id) : getStatistics(),
          id ? getProjectProgress(id).catch(() => null) : Promise.resolve(null),
        ]),
      ),
    )
      .then((results) => {
        const projectMap = new Map(allProjects.map((p) => [p.id, p]));
        const list: ProjectStats[] = [];
        for (let i = 0; i < results.length; i++) {
          const [stats, progress] = results[i];
          const pid = ids[i];
          const project = pid ? projectMap.get(pid) : null;
          if (pid && !project) continue;

          let dc = 0; let wc = 0; let mc = 0;
          let dd = 0; let wd = 0; let md = 0;
          for (const d of stats.daily) { dc += d.completed_count; dd += d.progress_delta; }
          for (const d of stats.weekly) { wc += d.completed_count; wd += d.progress_delta; }
          for (const d of stats.monthly) { mc += d.completed_count; md += d.progress_delta; }

          list.push({
            project: project ?? { id: '', name: 'All Projects', parent_id: null } as Project,
            progress,
            dailyCompleted: dc,
            weeklyCompleted: wc,
            monthlyCompleted: mc,
            dailyDelta: dd,
            weeklyDelta: wd,
            monthlyDelta: md,
          });
        }
        setProjectStatsList(list);
      })
      .catch((err) => {
        console.error('Failed to fetch statistics:', err);
      })
      .finally(() => setLoading(false));
  }, [selectedProjectIds, allProjects]);

  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchOpen]);

  const topLevelIds = useMemo(
    () => allProjects.filter((p) => p.parent_id === null).map((p) => p.id),
    [allProjects],
  );

  const selectedProjects = useMemo(
    () => allProjects.filter((p) => selectedProjectIds.includes(p.id)),
    [allProjects, selectedProjectIds],
  );

  const availableProjects = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return allProjects.filter(
      (p) => !selectedProjectIds.includes(p.id) && p.name.toLowerCase().includes(q),
    );
  }, [allProjects, selectedProjectIds, searchQuery]);

  const addProject = useCallback((id: string) => {
    setSelectedProjectIds((prev) => [...prev, id]);
    setSearchQuery('');
    setSearchOpen(false);
  }, []);

  const removeProject = useCallback((id: string) => {
    setSelectedProjectIds((prev) => prev.filter((pid) => pid !== id));
  }, []);

  const selectAll = useCallback(() => {
    setSelectedProjectIds(allProjects.map((p) => p.id));
  }, [allProjects]);

  const selectTopLevel = useCallback(() => {
    setSelectedProjectIds(topLevelIds);
  }, [topLevelIds]);

  const isAllSelected = selectedProjectIds.length === allProjects.length;
  const isTopLevelOnly = selectedProjectIds.length === topLevelIds.length &&
    topLevelIds.every((id) => selectedProjectIds.includes(id));

  const maxValues = useMemo(() => {
    const maxDaily = Math.max(...projectStatsList.map((p) => p.dailyCompleted), 1);
    const maxWeekly = Math.max(...projectStatsList.map((p) => p.weeklyCompleted), 1);
    const maxMonthly = Math.max(...projectStatsList.map((p) => p.monthlyCompleted), 1);
    return { maxDaily, maxWeekly, maxMonthly };
  }, [projectStatsList]);

  const totalCompleted = projectStatsList.reduce((s, p) => s + p.dailyCompleted, 0);
  const totalHours = projectStatsList.reduce((s, p) => s + (p.progress?.total_estimated_hours ?? 0), 0);
  const totalDoneHours = projectStatsList.reduce((s, p) => s + (p.progress?.completed_estimated_hours ?? 0), 0);
  const overallProgress = totalHours > 0 ? Math.round((totalDoneHours / totalHours) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Statistics</h1>

      {/* Project filter area */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Projects</span>
          <div className="flex gap-1 ml-auto">
            <button
              onClick={selectTopLevel}
              disabled={isTopLevelOnly}
              className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                isTopLevelOnly
                  ? 'bg-blue-50 text-blue-600'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              Top-Level
            </button>
            <button
              onClick={selectAll}
              disabled={isAllSelected}
              className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                isAllSelected
                  ? 'bg-blue-50 text-blue-600'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              All
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {selectedProjects.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-sm font-medium rounded-full border border-blue-200 group"
            >
              {p.name}
              <button
                onClick={() => removeProject(p.id)}
                className="w-4 h-4 inline-flex items-center justify-center rounded-full hover:bg-blue-200 text-blue-400 hover:text-blue-600 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}

          <div ref={searchRef} className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => { if (availableProjects.length > 0 || searchQuery.trim()) setSearchOpen(true); }}
              placeholder="Search project..."
              className="w-36 px-2.5 py-1 text-sm border border-dashed border-gray-300 rounded-full bg-transparent focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 placeholder-gray-400"
            />
            {searchOpen && searchQuery.trim() && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 max-h-48 overflow-y-auto">
                {availableProjects.length > 0 ? (
                  availableProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addProject(p.id)}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-2"
                    >
                      <span className="truncate">{p.name}</span>
                      {p.parent_id && (
                        <span className="text-[10px] text-gray-400 flex-shrink-0">sub</span>
                      )}
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-2 text-sm text-gray-400">No matching projects</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Completed Tasks</p>
          <p className="text-3xl font-bold text-blue-600">{totalCompleted}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Done / Total Hours</p>
          <p className="text-3xl font-bold text-emerald-600">
            {totalDoneHours}<span className="text-lg text-gray-400 font-normal">/{totalHours}h</span>
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Progress</p>
          <p className="text-3xl font-bold text-emerald-600">{overallProgress}%</p>
        </div>
      </div>

      {/* Project card list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : projectStatsList.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {projectStatsList.map((ps) => (
            <div key={ps.project.id || '__global__'} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900 truncate">{ps.project.name || 'All Projects'}</h3>
                {ps.progress && (
                  <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                    {ps.progress.progress}%
                  </span>
                )}
              </div>

              {/* Daily row */}
              <div className="flex items-center gap-3 py-1.5">
                <span className="text-xs font-medium text-gray-500 w-16 flex-shrink-0">Daily</span>
                <MiniBar value={ps.dailyCompleted} maxValue={maxValues.maxDaily} color="bg-blue-400" />
                <span className="text-xs text-gray-600 w-10 text-right flex-shrink-0 tabular-nums">
                  {ps.dailyCompleted}
                </span>
                <span className="text-xs text-emerald-600 w-12 text-right flex-shrink-0 tabular-nums font-medium">
                  {ps.dailyDelta > 0 ? '+' : ''}{ps.dailyDelta}%
                </span>
              </div>

              {/* Weekly row */}
              <div className="flex items-center gap-3 py-1.5">
                <span className="text-xs font-medium text-gray-500 w-16 flex-shrink-0">Weekly</span>
                <MiniBar value={ps.weeklyCompleted} maxValue={maxValues.maxWeekly} color="bg-blue-500" />
                <span className="text-xs text-gray-600 w-10 text-right flex-shrink-0 tabular-nums">
                  {ps.weeklyCompleted}
                </span>
                <span className="text-xs text-emerald-600 w-12 text-right flex-shrink-0 tabular-nums font-medium">
                  {ps.weeklyDelta > 0 ? '+' : ''}{ps.weeklyDelta}%
                </span>
              </div>

              {/* Monthly row */}
              <div className="flex items-center gap-3 py-1.5">
                <span className="text-xs font-medium text-gray-500 w-16 flex-shrink-0">Monthly</span>
                <MiniBar value={ps.monthlyCompleted} maxValue={maxValues.maxMonthly} color="bg-blue-600" />
                <span className="text-xs text-gray-600 w-10 text-right flex-shrink-0 tabular-nums">
                  {ps.monthlyCompleted}
                </span>
                <span className="text-xs text-emerald-600 w-12 text-right flex-shrink-0 tabular-nums font-medium">
                  {ps.monthlyDelta > 0 ? '+' : ''}{ps.monthlyDelta}%
                </span>
              </div>

              {/* Hours-based progress bar */}
              {ps.progress && ps.progress.total_estimated_hours > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-gray-500 w-16 flex-shrink-0">Progress</span>
                    <div className="flex-1 h-5 bg-gray-100 rounded-sm overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-sm transition-all duration-500 flex items-center justify-end pr-1.5"
                        style={{ width: `${ps.progress.progress}%` }}
                      >
                        {ps.progress.progress > 15 && (
                          <span className="text-[10px] text-white font-medium">{ps.progress.progress}%</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-gray-500 flex-shrink-0 tabular-nums w-16 text-right">
                      {ps.progress.completed_estimated_hours}/{ps.progress.total_estimated_hours}h
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
