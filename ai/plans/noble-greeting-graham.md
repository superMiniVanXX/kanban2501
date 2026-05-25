# Plan: Status Change Timestamps & Statistics

## Context

Currently, when a task changes status (e.g., moves to "done"), only `completed_at` is set on the Task model. There's no historical record of when each status transition happened, making it impossible to query "how many tasks were completed this week" or "what was the progress trend over the last month". The user wants daily/weekly/monthly statistics on completed tasks and progress changes.

## Approach

Add a dedicated `TaskStatusHistory` table (rather than parsing JSON in activity_logs) to record every status transition with timestamps. Then build a statistics API endpoint that aggregates this data, and a frontend page that displays it with Tailwind CSS bar charts.

### Why not reuse activity_logs?
- `extra_data` stores JSON text — querying it requires `json_extract` on every row
- Activity logs are designed for human-readable audit trails, not aggregation queries
- A typed table with `old_status`, `new_status`, `old_progress`, `new_progress` enables clean `GROUP BY` + `SUM` queries

---

## Backend Changes

### 1. New model: `backend/app/models/task_status_history.py`
- Fields: `id, task_id (FK), project_id (FK), old_status, new_status, old_progress, new_progress, changed_at`
- Indexes on `task_id`, `project_id`, `changed_at`

### 2. Register model: `backend/app/models/__init__.py`
- Add import for `TaskStatusHistory`

### 3. New schema: `backend/app/schemas/statistics.py`
- `StatisticsResponse` with `daily`, `weekly`, `monthly` arrays
- Each entry: `{date/week/month, completed_count, progress_delta}`

### 4. New service: `backend/app/services/statistics_service.py`
- `get_statistics(db, project_id?)` - aggregates from TaskStatusHistory
- Uses SQLite `strftime()` for date grouping (daily 30d, weekly 12w, monthly 12m)
- `completed_count` = transitions where `new_status == "done"`
- `progress_delta` = sum of `(new_progress - old_progress)`

### 5. New router: `backend/app/routers/statistics.py`
- `GET /api/v1/statistics?project_id=X` (project_id optional)

### 6. Register router: `backend/app/main.py`
- Import and `include_router(statistics.router, prefix="/api/v1")`

### 7. Record history: `backend/app/routers/tasks.py` (edit `change_task_status`)
- After status change + commit, insert `TaskStatusHistory` row

### 8. Schema migration: `backend/app/database.py` (edit `ensure_schema`)
- Add CREATE TABLE block for `task_status_history`

---

## Frontend Changes

### 9. New types: `frontend/src/types/index.ts`
- `DailyStats`, `WeeklyStats`, `MonthlyStats`, `Statistics` interfaces

### 10. New API function: `frontend/src/services/api.ts`
- `getStatistics(projectId?)` → `GET /statistics`

### 11. New page: `frontend/src/pages/StatisticsPage.tsx`
- Project filter dropdown (loads from `getProjects`)
- Tab switcher: Daily / Weekly / Monthly
- Horizontal bar chart per period using Tailwind (no external chart library)
  - Blue bar = completed count, Green bar = progress delta
  - Width = `value/maxValue * 100%`

### 12. New route: `frontend/src/App.tsx`
- `<Route path="/statistics" element={<StatisticsPage />} />`

### 13. New nav link: `frontend/src/components/Layout.tsx`
- Add `{ to: '/statistics', label: 'Statistics' }` to `navLinks`

---

## Implementation Order

| Step | File | Action |
|------|------|--------|
| 1 | `backend/app/models/task_status_history.py` | Create model |
| 2 | `backend/app/models/__init__.py` | Register model |
| 3 | `backend/app/database.py` | Add ensure_schema block |
| 4 | `backend/app/schemas/statistics.py` | Create schema |
| 5 | `backend/app/services/statistics_service.py` | Create service |
| 6 | `backend/app/routers/statistics.py` | Create router |
| 7 | `backend/app/main.py` | Register router |
| 8 | `backend/app/routers/tasks.py` | Record history on status change |
| 9 | `frontend/src/types/index.ts` | Add types |
| 10 | `frontend/src/services/api.ts` | Add getStatistics |
| 11 | `frontend/src/pages/StatisticsPage.tsx` | Create page |
| 12 | `frontend/src/App.tsx` | Add route |
| 13 | `frontend/src/components/Layout.tsx` | Add nav link |

---

## Verification

1. Start/restart backend — confirm `task_status_history` table is created
2. Change a task status via the kanban board — verify a row appears in the history table
3. Call `GET /api/v1/statistics` — confirm response has daily/weekly/monthly arrays
4. Navigate to `/statistics` page — verify bar charts render with project filter
5. Change a task to "done" — verify completed_count increments in today's daily stats
6. Test project filter dropdown — confirm stats update when selecting a specific project
