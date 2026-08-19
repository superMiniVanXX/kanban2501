# Recent Activity Board Feature Design

**Date**: 2026-07-17
**Status**: Draft — awaiting user review
**Author**: brainstorming session with user

## Summary

Add a cross-project "Recent Activity" board to the home page (`ProjectList`) that shows all tasks which changed status within a user-selected time window (1 / 3 / 7 days). Tasks are organized into six status columns (`todo`, `in_progress`, `review`, `done`, `verify`, `complete`) regardless of which project they belong to; within each column, tasks are ordered by when they entered their current status (most recent first). A time-window switcher at the top re-filters the board.

The board is backed by a single new read-only endpoint that aggregates the existing `task_status_history` table.

## Motivation

Today, tasks only surface inside their own project's board. To answer "what actually moved recently, across all projects?" the user must open each project board and scan. A time-windowed, status-organized, cross-project view answers that question in one place — useful as a daily-standup / "what happened lately" lens over the whole workspace.

The data already exists: every status transition writes a `task_status_history` row (task_id, project_id, old_status, new_status, changed_at). This spec reuses that table as the single source of truth for "active".

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Horizontal status columns (kanban-style) | User chose. "Status" is the primary dimension; time is the filter + within-column sort. Matches the word "看板". |
| Columns | `todo` / `in_progress` / `review` / `done` / `verify` / `complete` (6) | User chose "main-flow statuses". `backlog` and `cancelled` excluded — they are not "in-progress" work. |
| "Active" definition | Task has ≥1 `task_status_history` row with `changed_at` inside the window | User chose "发生过状态变更". Creation alone (no transition) does not qualify. |
| Within-column sort | Time the task entered its current status, descending | User chose "按状态和时间建立逻辑关系". Most-recently-moved tasks float to the top of their column. |
| Time window | 1 / 3 / 7 days, default 7, switcher at top of the module | User specified the three options. |
| Placement | Module at top of home page (`ProjectList`), above the project wall | User chose "首页模块" over a new top-level page or a Statistics tab. |
| Card info | Priority bar + title + project name + "entered current status X ago" (relative time) | User chose "标准信息". |
| Card click | Navigate to the task's project board (`/projects/{project_id}/board`) | Sensible default; existing router has no task anchor. Auto-opening the detail modal via `?task=` is a possible later enhancement, intentionally out of v1 scope. |
| Statistics exclusion | Tasks/projects flagged `exclude_from_stats` are hidden | Consistency with the existing Statistics page (`statistics_service.py` applies the same filter). One notion of "doesn't count". |
| Soft delete | `deleted_at IS NULL` tasks only | Consistent with every other listing endpoint. |
| Approach | Dedicated aggregation endpoint, single SQL pass | Chosen over (B) server-side status grouping (too rigid) and (C) reusing `/tasks/recent` (wrong semantics — sorts by `created_at`, capped at 15, ignores status history). |

## The Core Query Insight

For any task that is "active" in the window, **the time it entered its current status equals its most recent `task_status_history.changed_at`** — because the newest transition's `new_status` is exactly the task's current `task.status`. Therefore one `GROUP BY task_id, MAX(changed_at)` over the windowed history simultaneously yields:

1. the set of active task ids, and
2. the per-task sort/display anchor ("entered current status at").

No self-join or window function over the full history is needed.

## Architecture

```
┌──────────────────────────────────────────────┐
│  ProjectList (home page)                     │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  RecentActivityBoard   ← NEW component │  │
│  │  [ 1 day | 3 days | 7 days ]  switcher │  │
│  │                                        │  │
│  │  todo │ in_prog │ review │ done │ ...  │  │
│  │   ▢     ▢        ▢       ▢             │  │  (6 columns)
│  │   ▢     ▢                                │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  Project wall (existing)               │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘

         │ GET /api/v1/tasks/activity?days=7
         ▼
┌──────────────────────────────────────────────┐
│  routers/tasks.py   GET /tasks/activity      │
│  → activity_service.get_recent_activity(db,d)│
│                                              │
│  1. subquery: task_id, MAX(changed_at)       │
│     FROM task_status_history                 │
│     WHERE changed_at >= utcnow() - days      │
│     GROUP BY task_id                         │
│  2. JOIN tasks (status/title/priority) +     │
│     projects (name)                          │
│  3. filter: status IN (6 main-flow),         │
│     exclude_from_stats == False (both),      │
│     deleted_at IS NULL                       │
│  4. ORDER BY last_changed DESC               │
└──────────────────────────────────────────────┘
```

### Data flow

1. `RecentActivityBoard` mounts with `days=7`; on mount and on switcher change it calls `getRecentActivity(days)`.
2. Backend returns a flat `ActivityTask[]` (one row per active task, no grouping).
3. Frontend partitions the flat list into 6 buckets keyed by `task.status`, preserving the backend's `last_changed_at DESC` order within each bucket.
4. Empty window → a single muted line "近 N 天无状态变更".

## File Layout

```
backend/app/
  services/
    activity_service.py        NEW — get_recent_activity(db, days) -> list[ActivityTask]
  schemas/
    activity.py                NEW — ActivityTaskResponse (Pydantic)
  routers/
    tasks.py                   MODIFY — add GET /tasks/activity (thin, delegates to service)

frontend/src/
  types/index.ts               MODIFY — ActivityTask interface
  services/api.ts              MODIFY — getRecentActivity(days)
  components/
    RecentActivityBoard.tsx    NEW — switcher + 6 columns + cards
  pages/
    ProjectList.tsx            MODIFY — render <RecentActivityBoard/> above the project wall

backend/tests/
  test_activity.py             NEW — window membership, sort anchor, status filter, exclusions, soft delete
```

## API

```
GET /api/v1/tasks/activity?days=7
```

**Query param**: `days` — must be one of `1 | 3 | 7`. Default `7`. Any other value → HTTP 422.

**Response**: `200 OK` with `ActivityTaskResponse[]` (flat, ordered by `last_changed_at` descending).

```json
[
  {
    "id": "uuid",
    "title": "string",
    "status": "in_progress",
    "priority": "high",
    "project_id": "uuid",
    "project_name": "string",
    "last_changed_at": "2026-07-17T08:30:00.000000"
  }
]
```

`last_changed_at` is a naive UTC ISO timestamp (same convention as all other `task_status_history` / task timestamps; the frontend appends `'Z'` before parsing, matching the detail-panel pattern in `KanbanBoard.tsx`).

### `ActivityTaskResponse` (Pydantic)

```python
class ActivityTaskResponse(BaseModel):
    id: str
    title: str
    status: str
    priority: str
    project_id: str
    project_name: str
    last_changed_at: datetime

    model_config = {"from_attributes": True}
```

## Service Contract

`backend/app/services/activity_service.py`:

```python
ACTIVITY_DAYS = (1, 3, 7)
ACTIVITY_STATUSES = ("todo", "in_progress", "review", "done", "verify", "complete")

def get_recent_activity(db: Session, days: int) -> list[ActivityTask]:
    """Tasks that transitioned status within the last `days` days.

    Returns one row per active task, newest transition first. The
    "entered current status" time == max(changed_at) for that task
    (newest transition's new_status is the current status).
    Raises ValueError if days not in ACTIVITY_DAYS (router maps to 422).
    """
```

Filters applied (mirrors `statistics_service.py`):
- `Task.deleted_at IS NULL`
- `Task.status IN ACTIVITY_STATUSES`
- `Task.exclude_from_stats == False`
- `Task.project` not soft-deleted, `Project.exclude_from_stats == False`

## Frontend Component

`RecentActivityBoard.tsx`:

- Local state: `days` (default `7`), `tasks`, `loading`.
- `useEffect` on `days` → `getRecentActivity(days)`.
- Buckets: `useMemo` partition into `{ todo: [], in_progress: [], review: [], done: [], verify: [], complete: [] }` preserving backend order.
- Switcher: three pill buttons; active pill highlighted.
- Each column: header (localized label + count) + vertical list of cards.
- Card: left priority color bar (reuse `statusColors`/priority palette convention), title (truncate 1 line), project name (gray, small), relative time "进入当前状态 X分钟前" (reuse the existing `relativeTime` helper style already used in `ActivityLog.tsx` / `NotificationQueue.tsx`).
- Card click: `navigate(`/projects/${task.project_id}/board`)` via `react-router-dom`'s `useNavigate`.
- Empty state: centered muted text when `tasks.length === 0`.

## Edge Cases & Error Handling

| Case | Behavior |
|------|----------|
| `days` not in {1,3,7} | Router returns 422. |
| No active tasks in window | Frontend shows "近 N 天无状态变更"; all columns empty with count 0. |
| Task transitioned multiple times in window | Appears once, in its **current** status column, anchored to its most recent transition. |
| Task transitioned into current status before window, but had a *different* transition inside window | Cannot happen: the newest transition (inside window) defines the current status, so the task's current-status-entry time is inside window. |
| `exclude_from_stats` task | Excluded (consistent with Statistics). |
| Soft-deleted task / project | Excluded. |
| Network/load failure | Component shows a muted error line; does not block the rest of the home page (the project wall still renders). |

## Testing

### Backend (`backend/tests/test_activity.py`)

Using the existing `TestClient` + per-test SQLite DB (`conftest.py`):

1. **Window membership**: task transitioned 1 day ago → appears with `days=3`; transitioned 10 days ago → absent with `days=7`.
2. **Sort anchor**: two tasks in the same status, transitioned at t1 < t2 → t2 ordered first.
3. **Status filter**: a task whose only transition landed it in `backlog` → absent.
4. **Multiple transitions**: task A→B→C in window → appears once in column C.
5. **Exclusions**: `exclude_from_stats` task / project → absent.
6. **Soft delete**: deleted task → absent.
7. **Param validation**: `days=5` → 422; `days=1/3/7` → 200.

### Frontend

- `npm run build` from `frontend/` (this is the project's typecheck: `tsc -b && vite build`).

## Out of Scope (v1)

- Auto-opening the task detail modal from the activity card (`?task=` query support in `KanbanBoard`).
- Drag-and-drop or status changes from the activity board (read-only view).
- Pagination / virtualization (windows are bounded; expected row counts are small).
- Persisting the selected `days` across reloads (defaults to 7 each mount; can revisit if requested).
