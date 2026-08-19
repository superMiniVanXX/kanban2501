# Recent Activity Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-project, time-windowed status board to the home page that shows all tasks which changed status in the last 1/3/7 days.

**Architecture:** One read-only backend endpoint (`GET /tasks/activity?days=N`) aggregates `task_status_history` — `MAX(changed_at)` over the windowed rows is simultaneously the "active" proof and the "entered current status" anchor. The frontend renders a 6-column status board component above the project wall on `ProjectList`, partitioning the flat response into buckets.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + SQLite (backend); React 18 + TypeScript + Tailwind CSS 3 (frontend). Backend test = `pytest`; frontend typecheck = `npm run build` (`tsc -b && vite build`).

**Spec:** `docs/specs/2026-07-17-recent-activity-board-design.md`

## Global Constraints

- `days` query param must be one of `1 | 3 | 7` (default `7`); anything else → HTTP 422.
- Only the six main-flow statuses are columns: `todo`, `in_progress`, `review`, `done`, `verify`, `complete`. `backlog` and `cancelled` are excluded.
- Tasks/projects with `exclude_from_stats == True` are hidden (consistency with `statistics_service.py`).
- Soft-deleted tasks/projects (`deleted_at IS NOT NULL`) are hidden.
- `last_changed_at` is naive UTC ISO (backend); the frontend appends `'Z'` before parsing (same convention as `KanbanBoard.tsx` detail timestamps).
- No new dependencies. Python ≥3.12, Node ≥20.

---

## File Structure

```
backend/app/
  schemas/activity.py            CREATE — ActivityTaskResponse (Pydantic)
  services/activity_service.py   MODIFY — add get_recent_activity() (file already exists with log_activity)
  routers/tasks.py               MODIFY — import get_recent_activity + ActivityTaskResponse; add GET /tasks/activity
backend/tests/
  test_activity.py               CREATE — service + endpoint tests
frontend/src/
  types/index.ts                 MODIFY — add ActivityTask interface
  services/api.ts                MODIFY — import ActivityTask; add getRecentActivity()
  components/RecentActivityBoard.tsx  CREATE — switcher + 6 columns + cards
  pages/ProjectList.tsx          MODIFY — import + render <RecentActivityBoard/> above the project wall
```

---

## Task 1: Backend activity endpoint (TDD)

**Files:**
- Create: `backend/app/schemas/activity.py`
- Modify: `backend/app/services/activity_service.py` (add imports + `get_recent_activity`)
- Modify: `backend/app/routers/tasks.py` (imports near lines 18 & 21; new endpoint after line 103)
- Create: `backend/tests/test_activity.py`

**Interfaces:**
- Produces: `GET /api/v1/tasks/activity?days=7` → `200 ActivityTaskResponse[]` (newest `last_changed_at` first); `422` on bad `days`. `ActivityTaskResponse` fields: `id, title, status, priority, project_id, project_name, last_changed_at`.
- Service signature: `get_recent_activity(db: Session, days: int) -> list[ActivityTaskResponse]`; raises `ValueError` if `days not in (1,3,7)`.

- [ ] **Step 1: Write the failing test suite**

Create `backend/tests/test_activity.py`:

```python
from datetime import datetime, timedelta
import pytest

from app.models.project import Project
from app.models.task import Task
from app.models.task_status_history import TaskStatusHistory
from app.services.activity_service import get_recent_activity


def _project(db, name="P", exclude=False):
    p = Project(id=f"proj-{name}", name=name, exclude_from_stats=exclude)
    db.add(p)
    db.flush()
    return p


def _task(db, project, title="T", status="todo", exclude=False):
    t = Task(
        id=f"task-{title}",
        project_id=project.id,
        title=title,
        status=status,
        priority="medium",
        task_type="task",
        progress=0,
        exclude_from_stats=exclude,
    )
    db.add(t)
    db.flush()
    return t


def _history(db, task, new_status, changed_at, old_status="backlog"):
    db.add(TaskStatusHistory(
        task_id=task.id,
        project_id=task.project_id,
        old_status=old_status,
        new_status=new_status,
        old_progress=0,
        new_progress=0,
        changed_at=changed_at,
    ))
    db.flush()


def test_window_membership(db_session):
    db = db_session
    proj = _project(db, "W")
    recent = _task(db, proj, "recent", status="in_progress")
    _history(db, recent, "in_progress", datetime.utcnow() - timedelta(hours=2))
    old = _task(db, proj, "old", status="todo")
    _history(db, old, "todo", datetime.utcnow() - timedelta(days=10))
    db.commit()

    ids = [r.id for r in get_recent_activity(db, days=7)]
    assert recent.id in ids
    assert old.id not in ids


def test_sorted_by_last_changed_desc(db_session):
    db = db_session
    proj = _project(db, "S")
    earlier = _task(db, proj, "earlier", status="review")
    _history(db, earlier, "review", datetime.utcnow() - timedelta(days=2))
    later = _task(db, proj, "later", status="review")
    _history(db, later, "review", datetime.utcnow() - timedelta(hours=3))
    db.commit()

    titles = [r.title for r in get_recent_activity(db, days=7)]
    assert titles.index("later") < titles.index("earlier")


def test_backlog_excluded(db_session):
    db = db_session
    proj = _project(db, "B")
    t = _task(db, proj, "bl", status="backlog")
    _history(db, t, "backlog", datetime.utcnow())
    db.commit()
    assert get_recent_activity(db, days=1) == []


def test_multiple_transitions_single_row_in_current_status(db_session):
    db = db_session
    proj = _project(db, "M")
    t = _task(db, proj, "multi", status="done")
    base = datetime.utcnow() - timedelta(days=3)
    _history(db, t, "todo", base, old_status="backlog")
    _history(db, t, "in_progress", base + timedelta(hours=1), old_status="todo")
    _history(db, t, "done", base + timedelta(hours=2), old_status="in_progress")
    db.commit()

    matches = [r for r in get_recent_activity(db, days=7) if r.id == t.id]
    assert len(matches) == 1
    assert matches[0].status == "done"


def test_excluded_from_stats_filtered(db_session):
    db = db_session
    ok_proj = _project(db, "ok")
    ok_task = _task(db, ok_proj, "ok", status="todo")
    _history(db, ok_task, "todo", datetime.utcnow())
    excl_proj = _project(db, "excl-proj", exclude=True)
    excl_task_p = _task(db, excl_proj, "excl-proj-task", status="todo")
    _history(db, excl_task_p, "todo", datetime.utcnow())
    excl_task = _task(db, ok_proj, "excl-task", status="todo", exclude=True)
    _history(db, excl_task, "todo", datetime.utcnow())
    db.commit()

    ids = {r.id for r in get_recent_activity(db, days=1)}
    assert ok_task.id in ids
    assert excl_task_p.id not in ids
    assert excl_task.id not in ids


def test_soft_deleted_excluded(db_session):
    db = db_session
    proj = _project(db, "D")
    alive = _task(db, proj, "alive", status="todo")
    _history(db, alive, "todo", datetime.utcnow())
    dead = _task(db, proj, "dead", status="todo")
    dead.deleted_at = datetime.utcnow()
    _history(db, dead, "todo", datetime.utcnow())
    db.commit()

    ids = {r.id for r in get_recent_activity(db, days=1)}
    assert alive.id in ids
    assert dead.id not in ids


def test_invalid_days_raises(db_session):
    with pytest.raises(ValueError):
        get_recent_activity(db_session, days=5)


def test_endpoint_param_validation(client):
    assert client.get("/api/v1/tasks/activity?days=5").status_code == 422


def test_endpoint_happy_path(client, db_session):
    proj = Project(id="proj-ep", name="EP")
    db_session.add(proj)
    db_session.flush()
    t = Task(id="task-ep", project_id=proj.id, title="EP", status="done",
             priority="high", task_type="task", progress=100)
    db_session.add(t)
    db_session.flush()
    db_session.add(TaskStatusHistory(
        task_id=t.id, project_id=proj.id, old_status="review", new_status="done",
        old_progress=0, new_progress=100, changed_at=datetime.utcnow(),
    ))
    db_session.commit()

    resp = client.get("/api/v1/tasks/activity?days=7")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == "task-ep"
    assert data[0]["status"] == "done"
    assert data[0]["project_name"] == "EP"
    assert "last_changed_at" in data[0]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_activity.py -v`
Expected: FAIL / collection error — `ImportError: cannot import name 'get_recent_activity' from 'app.services.activity_service'` (and the endpoint returns 404).

- [ ] **Step 3: Create the schema**

Create `backend/app/schemas/activity.py`:

```python
from datetime import datetime
from pydantic import BaseModel


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

- [ ] **Step 4: Add the service function**

Modify `backend/app/services/activity_service.py`. The file currently starts with `import json` and `from sqlalchemy.orm import Session` and defines `log_activity`. Add these imports at the top (after the existing ones) and the function at the end of the file.

Add imports:

```python
from datetime import datetime, timedelta
from sqlalchemy import func
from app.models.task import Task
from app.models.project import Project
from app.models.task_status_history import TaskStatusHistory
from app.schemas.activity import ActivityTaskResponse
```

Append function:

```python
ACTIVITY_DAYS = (1, 3, 7)
ACTIVITY_STATUSES = ("todo", "in_progress", "review", "done", "verify", "complete")


def get_recent_activity(db: Session, days: int) -> list[ActivityTaskResponse]:
    """Tasks that transitioned status within the last `days` days.

    For an in-window-active task, its newest in-window transition is both the
    proof of activity and the "entered current status" anchor: the newest
    transition's `new_status` is the task's current `status`. Returns rows
    newest-first.
    """
    if days not in ACTIVITY_DAYS:
        raise ValueError(f"days must be one of {ACTIVITY_DAYS}")

    cutoff = datetime.utcnow() - timedelta(days=days)

    latest = (
        db.query(
            TaskStatusHistory.task_id.label("task_id"),
            func.max(TaskStatusHistory.changed_at).label("last_changed"),
        )
        .filter(TaskStatusHistory.changed_at >= cutoff)
        .group_by(TaskStatusHistory.task_id)
        .subquery()
    )

    rows = (
        db.query(
            Task.id,
            Task.title,
            Task.status,
            Task.priority,
            Task.project_id,
            Project.name.label("project_name"),
            latest.c.last_changed.label("last_changed_at"),
        )
        .join(latest, latest.c.task_id == Task.id)
        .join(Project, Task.project_id == Project.id)
        .filter(
            Task.deleted_at.is_(None),
            Project.deleted_at.is_(None),
            Task.status.in_(ACTIVITY_STATUSES),
            Task.exclude_from_stats == False,  # noqa: E712
            Project.exclude_from_stats == False,  # noqa: E712
        )
        .order_by(latest.c.last_changed.desc())
        .all()
    )

    return [
        ActivityTaskResponse(
            id=r.id,
            title=r.title,
            status=r.status,
            priority=r.priority,
            project_id=r.project_id,
            project_name=r.project_name,
            last_changed_at=r.last_changed_at,
        )
        for r in rows
    ]
```

- [ ] **Step 5: Wire the router endpoint**

Modify `backend/app/routers/tasks.py`.

Change the schema import (line 18) — append `ActivityTaskResponse` from its module. Replace:

```python
from app.schemas.task import TaskCreate, TaskUpdate, TaskStatusUpdate, TaskMove, TaskResponse, TaskSearchResponse
```

with:

```python
from app.schemas.task import TaskCreate, TaskUpdate, TaskStatusUpdate, TaskMove, TaskResponse, TaskSearchResponse
from app.schemas.activity import ActivityTaskResponse
```

Change the service import (line 21). Replace:

```python
from app.services.activity_service import log_activity
```

with:

```python
from app.services.activity_service import log_activity, get_recent_activity
```

Add the endpoint **immediately after** the `recent_tasks` function (after line 103, before `search_tasks`) — order matters: `/tasks/activity` must be registered before `/tasks/{task_id}` (line 184) so the static path is not swallowed by the path param:

```python
@router.get("/tasks/activity", response_model=list[ActivityTaskResponse])
def recent_activity(days: int = 7, db: Session = Depends(get_db)):
    try:
        return get_recent_activity(db, days)
    except ValueError:
        raise HTTPException(status_code=422, detail="days must be one of 1, 3, 7")
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_activity.py -v`
Expected: all 9 tests PASS.

- [ ] **Step 7: Sanity-check the full suite**

Run: `cd backend && python -m pytest tests/ -q`
Expected: no new failures introduced by the router/service change.

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas/activity.py backend/app/services/activity_service.py backend/app/routers/tasks.py backend/tests/test_activity.py
git commit -m "feat: add recent activity board endpoint"
```

---

## Task 2: Frontend activity board on the home page

**Files:**
- Modify: `frontend/src/types/index.ts` (add `ActivityTask` after the `Task` interface, ~line 64)
- Modify: `frontend/src/services/api.ts` (import + add `getRecentActivity`)
- Create: `frontend/src/components/RecentActivityBoard.tsx`
- Modify: `frontend/src/pages/ProjectList.tsx` (import + render above the wall)

**Interfaces:**
- Consumes: `GET /tasks/activity?days=N` → `ActivityTask[]`.
- `ActivityTask` shape: `{ id, title, status: Task['status'], priority: Task['priority'], project_id, project_name, last_changed_at: string }`.

- [ ] **Step 1: Add the `ActivityTask` type**

In `frontend/src/types/index.ts`, immediately after the `Task` interface's closing brace (line 64), insert:

```typescript
export interface ActivityTask {
  id: string;
  title: string;
  status: Task['status'];
  priority: Task['priority'];
  project_id: string;
  project_name: string;
  last_changed_at: string;
}
```

- [ ] **Step 2: Add the API client function**

In `frontend/src/services/api.ts`:

Append `ActivityTask` to the type import on line 2 (add it to the existing `import type { ... } from '../types';` list).

Then, in the `// Recent tasks` section (after `getRecentTasks`, ~line 131), add:

```typescript
// Recent activity board
export const getRecentActivity = (days: number = 7) =>
  api.get<ActivityTask[]>('/tasks/activity', { params: { days } }).then((r) => r.data);
```

- [ ] **Step 3: Create the board component**

Create `frontend/src/components/RecentActivityBoard.tsx`:

```tsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRecentActivity } from '../services/api';
import type { ActivityTask, Task } from '../types';
import { STATUS_COLOR } from '../utils/statusColors';

const DAYS_OPTIONS = [1, 3, 7] as const;

const COLUMN_STATUSES: Task['status'][] = [
  'todo', 'in_progress', 'review', 'done', 'verify', 'complete',
];

const COLUMN_LABELS: Record<Task['status'], string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
  verify: 'Verify',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

const PRIORITY_BAR: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-sky-400',
  low: 'bg-gray-300',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso + 'Z').getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function RecentActivityBoard() {
  const [days, setDays] = useState<number>(7);
  const [tasks, setTasks] = useState<ActivityTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRecentActivity(days)
      .then((data) => { if (!cancelled) setTasks(data); })
      .catch(() => { if (!cancelled) setError('加载活跃任务失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const buckets = useMemo(() => {
    const m: Record<string, ActivityTask[]> = {};
    for (const s of COLUMN_STATUSES) m[s] = [];
    for (const t of tasks) {
      if (m[t.status]) m[t.status].push(t);
    }
    return m;
  }, [tasks]);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">近期活跃任务</h2>
          <p className="text-xs text-gray-500">按状态变更时间聚合，跨所有项目</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {DAYS_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                days === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {d} 天
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="text-center py-8 text-sm text-red-500 bg-red-50 rounded-xl border border-red-100">{error}</div>
      ) : loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-400 bg-white rounded-xl border border-gray-100">
          近 {days} 天无状态变更
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-3">
          {COLUMN_STATUSES.map((s) => {
            const color = STATUS_COLOR[s];
            const list = buckets[s] ?? [];
            return (
              <div key={s} className="bg-gray-50 rounded-xl p-2 min-h-[120px]">
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <span className={`w-2 h-2 rounded-full ${color.solid}`} />
                  <span className="text-xs font-semibold text-gray-600">{COLUMN_LABELS[s]}</span>
                  <span className="text-xs text-gray-400 ml-auto">{list.length}</span>
                </div>
                <div className="space-y-2">
                  {list.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => navigate(`/projects/${t.project_id}/board`)}
                      className="w-full text-left bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all overflow-hidden"
                    >
                      <div className={`h-1 ${PRIORITY_BAR[t.priority] ?? 'bg-gray-300'}`} />
                      <div className="p-2">
                        <div className="text-xs font-semibold text-gray-900 leading-snug line-clamp-2">{t.title}</div>
                        <div className="text-[11px] text-gray-400 mt-1 truncate">{t.project_name}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5">{relativeTime(t.last_changed_at)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
```

> Note: `line-clamp-2` is core in Tailwind CSS ≥ 3.3. The project uses Tailwind 3. If `npm run build` reports it unknown, fall back to replacing `line-clamp-2` with `truncate` (single line) — but verify the installed version first.

- [ ] **Step 4: Render the board on the home page**

Modify `frontend/src/pages/ProjectList.tsx`.

Add the import (near the other component imports, after line 5):

```tsx
import RecentActivityBoard from '../components/RecentActivityBoard';
```

Render it between the header block (ends at line 82 `</div>`) and the loading/empty/wall conditional (line 84 `{loading ? (`). Insert on its own line after the header `</div>`:

```tsx
      <RecentActivityBoard />
```

- [ ] **Step 5: Typecheck + build**

Run: `cd frontend && npm run build`
Expected: `tsc -b` and `vite build` succeed with no type errors (the build output goes to `backend/static/`).

- [ ] **Step 6: Manual smoke test**

Run: `bash scripts/start.sh dev`, open `http://localhost:5173`.
Expected: the "近期活跃任务" board appears above the project cards; switching 1/3/7 days refetches; cards show priority bar + title + project name + relative time; clicking a card navigates to `/projects/<id>/board`. Stop with `bash scripts/stop.sh`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts frontend/src/components/RecentActivityBoard.tsx frontend/src/pages/ProjectList.tsx
git commit -m "feat: add recent activity board to home page"
```

---

## Self-Review (completed during authoring)

**Spec coverage:** endpoint (`GET /tasks/activity`) ✓ · service (`get_recent_activity`, `MAX(changed_at)` anchor) ✓ · schema (`ActivityTaskResponse`) ✓ · 6 columns ✓ · days switcher (1/3/7, default 7) ✓ · card info (priority bar/title/project name/relative time) ✓ · click → navigate to board ✓ · `exclude_from_stats` filter (task + project) ✓ · soft-delete filter ✓ · empty state ✓ · param validation 422 ✓ · backend tests ✓ · frontend build verification ✓. No spec section is without a task.

**Placeholder scan:** none — every code step contains complete, runnable code and exact commands.

**Type consistency:** `ActivityTaskResponse` (backend) ↔ `ActivityTask` (frontend type) ↔ `getRecentActivity` return ↔ component usage — field names and types match throughout. `COLUMN_STATUSES` uses the same `Task['status']` literals as `STATUS_COLOR` keys in `statusColors.ts`. Route placement (`/tasks/activity` before `/tasks/{task_id}`) is called out explicitly to avoid the path-param capture bug.

**Known follow-ups (intentionally out of v1, per spec):** auto-opening the task detail modal via `?task=` query; persisting the selected `days` across reloads; drag-and-drop from this board.
