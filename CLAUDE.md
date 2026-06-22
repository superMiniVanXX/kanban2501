# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start development (backend + frontend with hot reload)
bash scripts/start.sh dev

# Start production (builds frontend into backend/static/, backend serves everything)
bash scripts/start.sh prod

# Stop all running processes
bash scripts/stop.sh

# Backend — run tests
cd backend && python -m pytest tests/ -v

# Backend — run a single test file
cd backend && python -m pytest tests/test_tasks.py -v

# Frontend — dev server only (backend must be running separately)
cd frontend && npm run dev

# Frontend — production build → backend/static/
cd frontend && npm run build
```

## Architecture

**Kanban-PMP** — a project management platform with hierarchical projects, kanban task boards, and code project tracking.

| Layer | Stack |
|-------|-------|
| Backend | FastAPI 0.115 + SQLAlchemy 2.0 + SQLite (`backend/data/kanban.db`) |
| Frontend | React 18 + TypeScript + Vite 6 + Tailwind CSS 3 |
| API | REST at `localhost:9527/api/v1`; frontend dev at `localhost:5173` proxies `/api` → backend |

**Dev mode**: `scripts/start.sh dev` launches both backend (uvicorn `--reload` on 9527) and frontend (Vite on 5173). PIDs saved to `.kanban.pid`. Production builds frontend into `backend/static/` and serves everything from backend alone.

### Data Model Hierarchy

```
Project (self-referential via parent_id → tree structure)
  ├── 1:1 → Board
  │         └── 1:N → Column (maps to a task status, optional WIP limit)
  └── 1:N → Task
              ├── M:N → CodeProject (via task_code_projects join table)
              └── N:1 → Project (as sub_project_id — decomposition link)
```

**Soft-delete pattern**: Both Project and Task use a nullable `deleted_at` column; deleting sets the timestamp rather than removing the row. The `/trash` endpoint lists deleted items and supports restore.

### Task Status Lifecycle

```
backlog → todo → in_progress → review → done
  ↑         ↓        ↓          ↓       ↓
  └── cancelled ←───────────────────────┘
```

- Only **adjacent forward** transitions are allowed (enforced by `workflow_service.py`).
- **Backward** moves between adjacent states are always allowed.
- **cancelled** can be set from any status.
- `backlog → todo` requires the task's `implementation_plan` field to be non-empty.
- Setting status to `done` auto-sets `progress = 100` and `completed_at = now()`.
- Every status change is recorded in `task_status_history` and the activity log.

### Backend Layer Structure

```
backend/app/
  main.py            — FastAPI app, CORS, lifespan (ensure_schema), mounts static/
  database.py         — SQLAlchemy engine, session, Base, ensure_schema (auto-migration)
  models/             — ORM models (Project, Task, Board, Column, CodeProject,
                        ExecutionConfig, ActivityLog, TaskStatusHistory)
  schemas/            — Pydantic request/response models (Create/Update/Response)
  routers/            — API route handlers (thin — delegate to services)
  services/           — Business logic:
      project_service.py   — tree building (O(n) single-pass), cycle detection
      board_service.py     — loads board columns with filtered tasks
      workflow_service.py  — status transition validation (adjacent-only rule)
      activity_service.py  — writes activity log entries
      statistics_service.py — daily/weekly/monthly completion stats
```

### Key Backend Patterns

- **`ensure_schema()`** in `database.py` acts as a lightweight auto-migration — it calls `Base.metadata.create_all()`, then checks `PRAGMA table_info` for each column and adds missing ones with `ALTER TABLE`. This is where new columns/table additions should go.
- **UUID primary keys** — all models use `str(36)` IDs generated via `uuid.uuid4()`.
- **Task execution** (`POST /tasks/{id}/execute`) — takes a `config_id`, expands `{task_*}` placeholders in the command template, and resolves `##workdir##` to the first linked CodeProject's path. Commands run via `subprocess.run` with 30-second timeout.
- **Remote Sync (rsync)** (`POST /tasks/{id}/sync`) — syncs task worktree files to a remote host via rsync:
  - Hosts are managed in `RemoteHost` (Settings → Remote Hosts tab) with `ssh_user`, `ssh_host`, `ssh_port`, and a `base_path_template` supporting `{task_title_slug}`, `{ssh_user}`, `{ssh_host}`, `{branch_name}`, etc. (same variables as `expand_template`).
  - Auth uses SSH keys by default. If the user supplies a password in the sync request, the backend wraps rsync with `sshpass -e` (reads password from `SSHPASS` env var on the subprocess only).
  - **No passwords are ever stored in the DB** — they exist only in the request body and the subprocess env.
  - Fixed rsync flags: `-avz --delete` with excludes for `.git/`, `node_modules/`, `__pycache__/`, `*.pyc`, `.venv/`, `dist/`, `build/`, `.DS_Store`.
  - Server dependencies: `rsync` (required) and `sshpass` (only if password auth is used). Install with `apt install rsync sshpass` on Debian/Ubuntu.

### Testing

Tests use `FastAPI TestClient` against a temporary SQLite database (created per test via `conftest.py`). The conftest swaps the production `database.engine` and `database.SessionLocal` at **module level** (before importing `app.main`), then overrides the `get_db` dependency. All tables are created/dropped per test (`autouse` fixture).

```bash
# Run all backend tests
cd backend && python -m pytest tests/ -v

# Run a single test file
cd backend && python -m pytest tests/test_tasks.py -v

# Run a specific test function
cd backend && python -m pytest tests/test_tasks.py::test_create_task -v
```

### Frontend Routes

```
/                          → ProjectList (project card grid + tree view)
/projects/:id/board       → KanbanBoard (drag-and-drop columns, task CRUD)
/settings                  → SettingsPage (execution configs, code projects)
/statistics                → StatisticsPage (daily/weekly/monthly charts)
/trash                     → TrashPage (deleted projects/tasks with restore)
```

Key dependencies: `@hello-pangea/dnd` for drag-and-drop, `axios` for API calls, `react-router-dom` v7 for routing.

### Services & Integration

The `kanban-api` skill (Claude Code integration) wraps the full REST API — defined in `ai/skills/kanban-api/`. The `debian-project-sync` skill discovers debian-packaged projects from source trees and syncs them as CodeProjects.

### Frontend Architecture

```
frontend/src/
  services/api.ts    — centralized axios client (30+ typed API functions)
  types/index.ts     — all TypeScript interfaces (Project, Task, Board, Column, etc.)
  pages/             — route-level components (KanbanBoard, ProjectList, SettingsPage, etc.)
  components/        — reusable UI (TaskCard, KanbanColumn, ProjectTree, SearchBox, etc.)
```

Frontend types mirror backend schemas exactly. The API client uses `axios` with `baseURL: '/api/v1'` — in dev mode, Vite proxies this to the backend.
