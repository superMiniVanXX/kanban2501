# AGENTS.md

Guidance for AI agents working in this repo. `CLAUDE.md` also exists and is largely accurate — read it for the full architecture overview. This file captures the high-signal gotchas and corrections.

## Commands

```bash
# Dev: backend (--reload, :9527) + frontend (vite, :5173 proxies /api → :9527)
bash scripts/start.sh dev

# Prod: builds frontend into backend/static/, serves everything from backend on :9527
bash scripts/start.sh prod

# Stop both (kills PIDs in .kanban.pid + anything on ports 9527/5173)
bash scripts/stop.sh

# Backend tests (run from backend/, uses its own temp SQLite DB per test)
cd backend && python -m pytest tests/ -v
cd backend && python -m pytest tests/test_tasks.py -v                 # one file
cd backend && python -m pytest tests/test_tasks.py::test_create_task  # one test

# Frontend — there is NO separate lint/typecheck script.
npm run build     # from frontend/ — this IS the typecheck (tsc -b) + build
```

## Toolchain quirks (easy to guess wrong)

- **No lint, no CI, no pre-commit.** `.github/workflows/` exists but is empty. Do not assume `npm run lint` or a CI gate exists.
- **Frontend typecheck = `npm run build`.** It runs `tsc -b && vite build`. There is no eslint/prettier config. Output goes to `backend/static/` (gitignored build artifact).
- **Two venvs exist locally** — `backend/.venv` and `backend/venv`. `scripts/start.sh` uses `.venv`. Both are gitignored; prefer `.venv`.
- **Two DB files exist** — live data is at `backend/data/kanban.db`. The stray empty `backend/kanban.db` is a leftover; ignore it.
- **Python ≥3.12, Node ≥20** (README). Backend deps pinned in `backend/requirements.txt`; no `pyproject.toml`.

## Backend architecture (verify before trusting CLAUDE.md)

Layering is strict: **routers (thin) → services (business logic) → models (ORM)**. Routers should delegate, not implement logic. All PKs are UUID strings (`str(uuid.uuid4())`).

- **`ensure_schema()` in `app/database.py`** is the lightweight auto-migration — `Base.metadata.create_all()` then `ALTER TABLE` to add any missing columns via `PRAGMA table_info`. Add new columns/table migrations here. SQLite only; `PRAGMA foreign_keys = ON` is set on every connection.
- **Soft-delete**: `Project` and `Task` use a nullable `deleted_at`. Deletes set the timestamp; `/trash` lists and restores.
- **Activity log**: every status change writes `task_status_history` + `activity_log`. Keep this pattern when touching status flows.

## Task status lifecycle (CLAUDE.md is STALE here)

```
backlog → todo → in_progress → review → done → verify → complete
                                                         ↑
  cancelled can be set from any status ─────────────────┘
```

Authoritative source: `app/services/workflow_service.py` (`FORWARD_OK` / `BACKWARD_OK` sets) and `app/models/task.py` enum. Valid values: `backlog, todo, in_progress, review, done, verify, complete, cancelled`.

Rules (see `routers/tasks.py:253`):
- Only **adjacent forward** transitions allowed; **adjacent backward** always allowed; `cancelled` reachable from anywhere.
- `backlog → todo` requires non-empty `implementation_plan`.
- Setting status to **`done`** auto-sets `progress = 100` and `completed_at = now()`. Moving to `verify`/`complete` preserves those; moving to any other status resets `completed_at = None`.

## Testing gotchas

- **`backend/tests/conftest.py` swaps `database.engine` and `database.SessionLocal` at module-import time, BEFORE importing `app.main`.** Do not reorder these imports or introduce fixtures that import `app.main` first — the DB override will silently not apply.
- `ensure_schema()` migrations **do not run in tests**. Tests use `Base.metadata.create_all()` directly, so they reflect the current models, not legacy migrations. If you add a column, put it on the model (and in `ensure_schema` for prod).
- Each test gets a fresh temp SQLite DB via the `autouse setup_db` fixture (create_all / drop_all per test).
- Note: `conftest.py` currently contains duplicate `override_get_db`/`setup_db` definitions (the later one wins, both identical). Don't be alarmed; don't "fix" it without checking.

## Integration points

- **REST API**: `/api/v1/*` — full reference in `docs/api-reference.md`.
- **Skills**: `skills/kanban-api/` wraps the REST API for agent use; `skills/debian-project-sync/` discovers debian projects from source trees. Mirror copies live under `.claude/skills/`.
- **Task execution** (`POST /tasks/{id}/execute`): expands `{task_*}` placeholders + `##workdir##` (→ first linked CodeProject path); runs via `subprocess.run`, 30s timeout.
- **Remote sync (rsync)** (`POST /tasks/{id}/sync`): SSH-key auth by default; passwords (if provided) used only via `sshpass -e` + `SSHPASS` env on the subprocess — **never persisted to DB**. Needs `rsync` (and `sshpass` only for password mode).
- CORS is wide-open (`allow_origins=["*"]`) — intentional for local dev.
