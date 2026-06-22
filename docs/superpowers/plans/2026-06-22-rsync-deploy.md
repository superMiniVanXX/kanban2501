# Remote Sync (rsync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to push a task's worktree contents to a remote host via `rsync -avz --delete`, with shared host configurations managed in Settings and a per-task default host.

**Architecture:** Mirrors the existing `WorktreeConfig` / `ExecutionConfig` pattern: new `RemoteHost` SQLAlchemy model + Pydantic schemas + thin CRUD router + dedicated `remote_sync_service` for the rsync subprocess work. Task gets a nullable `remote_host_id` FK. Sync endpoint at `POST /tasks/{id}/sync` returns stdout/stderr/exit_code just like `/execute`. Authentication uses SSH keys by default with optional `sshpass`-based per-run password fallback; **no passwords are ever stored**.

**Tech Stack:** FastAPI 0.115 + SQLAlchemy 2.0 + SQLite (backend); React 18 + TypeScript + Vite + Tailwind (frontend); pytest (backend tests); `rsync` + `sshpass` external binaries.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-22-rsync-deploy-design.md` (read it first; every design decision is justified there).
- All backend tests must pass: `cd backend && python -m pytest tests/ -v`.
- All new endpoints under `/api/v1` prefix (matches existing convention).
- IDs are `String(36)` UUIDs via `uuid.uuid4()` (matches existing convention).
- New DB columns/tables must be added to `ensure_schema()` in `backend/app/database.py` for auto-migration on existing DBs.
- Subprocess invocations MUST use argv list (`subprocess.run(["rsync", ...])`) — never `shell=True`.
- Passwords are NEVER written to DB, activity_log, or stdout/stderr captures.
- Pydantic schemas enforce field max lengths (mirrors existing `WorktreeConfigCreate`).
- Follow existing router/service/model patterns — `worktree_configs.py`, `worktree_service.py`, and `WorktreeConfig` are the canonical references.
- Use `lazy="joined"` on the Task→RemoteHost relationship so the host comes back with the task in a single query (mirrors how `worktree` is loaded).
- Commit message style: `feat:`/`fix:`/`test:`/`docs:` prefix, lowercase, concise (matches recent git log).

---

## File Structure

**Backend — new files:**
- `backend/app/models/remote_host.py` — SQLAlchemy `RemoteHost` model.
- `backend/app/schemas/remote_host.py` — Pydantic Create/Update/Response + SyncRequest/SyncResponse.
- `backend/app/routers/remote_hosts.py` — CRUD endpoints (mirrors `worktree_configs.py`).
- `backend/app/services/remote_sync_service.py` — template expansion, command builder, subprocess runner.
- `backend/tests/test_remote_hosts.py` — CRUD + schema validation tests.
- `backend/tests/test_remote_sync.py` — service unit tests + sync endpoint tests.

**Backend — modified files:**
- `backend/app/models/task.py` — add `remote_host_id` column + `remote_host` relationship.
- `backend/app/schemas/task.py` — add `remote_host_id` to `TaskCreate`, `TaskUpdate`, `TaskResponse`; add `remote_host` to `TaskResponse`.
- `backend/app/routers/tasks.py` — accept `remote_host_id` in create/update; add `POST /tasks/{id}/sync`.
- `backend/app/services/worktree_service.py` — extend `expand_template` with optional `extra_vars` param; add `{project_slug}`.
- `backend/app/database.py` — add `remote_hosts` table creation + `tasks.remote_host_id` column to `ensure_schema`.
- `backend/app/main.py` — register `remote_hosts` router.
- `backend/tests/conftest.py` — add `RemoteHost` import so it registers with `Base.metadata` for tests.

**Frontend — modified files:**
- `frontend/src/types/index.ts` — `RemoteHost`, `RemoteHostCreate`, `SyncRequest`, `SyncResult`; add `remote_host_id`/`remote_host` to `Task` and `TaskCreate`.
- `frontend/src/services/api.ts` — `remoteHostApi` object + `syncTask` function.
- `frontend/src/pages/SettingsPage.tsx` — new "Remote Hosts" tab.
- `frontend/src/pages/KanbanBoard.tsx` — add Remote Host dropdown to task editor; add "Sync to Remote" button + sync panel.
- `frontend/src/components/CreateTaskModal.tsx` — optional remote host dropdown at task creation.

**Docs — modified:**
- `CLAUDE.md` — new "Remote Sync" section.

---

## Task 1: Add RemoteHost model + Pydantic schemas + auto-migration

**Files:**
- Create: `backend/app/models/remote_host.py`
- Create: `backend/app/schemas/remote_host.py`
- Modify: `backend/app/database.py` (append to `ensure_schema`)
- Modify: `backend/tests/conftest.py` (register model import)

**Interfaces:**
- Produces: `RemoteHost` SQLAlchemy model (table `remote_hosts`) with columns `id, name, description, ssh_user, ssh_host, ssh_port, base_path_template, created_at, updated_at`.
- Produces: `RemoteHostCreate`, `RemoteHostUpdate`, `RemoteHostResponse` Pydantic schemas.
- Produces: auto-migration in `ensure_schema()` that creates the `remote_hosts` table on existing DBs.

- [ ] **Step 1: Write `backend/app/models/remote_host.py`**

```python
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RemoteHost(Base):
    __tablename__ = "remote_hosts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    ssh_user: Mapped[str] = mapped_column(String(100), nullable=False)
    ssh_host: Mapped[str] = mapped_column(String(255), nullable=False)
    ssh_port: Mapped[int] = mapped_column(Integer, nullable=False, default=22, server_default="22")
    base_path_template: Mapped[str] = mapped_column(String(500), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

- [ ] **Step 2: Write `backend/app/schemas/remote_host.py`**

```python
from datetime import datetime
from pydantic import BaseModel, Field


class RemoteHostCreate(BaseModel):
    name: str = Field(max_length=200)
    ssh_user: str = Field(min_length=1, max_length=100)
    ssh_host: str = Field(min_length=1, max_length=255)
    ssh_port: int = Field(default=22, ge=1, le=65535)
    base_path_template: str = Field(min_length=1, max_length=500)
    description: str | None = None


class RemoteHostUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    ssh_user: str | None = Field(default=None, min_length=1, max_length=100)
    ssh_host: str | None = Field(default=None, min_length=1, max_length=255)
    ssh_port: int | None = Field(default=None, ge=1, le=65535)
    base_path_template: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = None


class RemoteHostResponse(BaseModel):
    id: str
    name: str
    description: str | None
    ssh_user: str
    ssh_host: str
    ssh_port: int
    base_path_template: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SyncRequest(BaseModel):
    host_id: str | None = None
    password: str | None = None


class SyncResponse(BaseModel):
    success: bool
    stdout: str
    stderr: str
    exit_code: int
    command: str
    dest_path: str
    host_name: str
```

- [ ] **Step 3: Register model in conftest**

Modify `backend/tests/conftest.py` line 11 — add `RemoteHost` to the import that registers models with `Base.metadata`:

```python
from app.models import Project  # noqa: F401
from app.models.remote_host import RemoteHost  # noqa: F401
```

- [ ] **Step 4: Add auto-migration block in `ensure_schema()`**

In `backend/app/database.py`, inside `ensure_schema()` function, after the worktrees block (around line 182, before the `task_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(tasks)"))]` re-fetch on line 183), insert:

```python
        rh_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(remote_hosts)"))]
        if not rh_cols:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS remote_hosts ("
                "id VARCHAR(36) PRIMARY KEY, "
                "name VARCHAR(200) NOT NULL, "
                "description TEXT, "
                "ssh_user VARCHAR(100) NOT NULL, "
                "ssh_host VARCHAR(255) NOT NULL, "
                "ssh_port INTEGER NOT NULL DEFAULT 22, "
                "base_path_template VARCHAR(500) NOT NULL, "
                "created_at DATETIME, "
                "updated_at DATETIME"
                ")"
            ))
            conn.commit()
```

Then add `remote_host_id` column to `tasks` (after the `worktree_id` ALTER block, around line 188):

```python
        task_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(tasks)"))]
        if "remote_host_id" not in task_cols:
            conn.execute(text(
                "ALTER TABLE tasks ADD COLUMN remote_host_id VARCHAR(36) REFERENCES remote_hosts(id) ON DELETE SET NULL"
            ))
            conn.commit()
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/remote_host.py backend/app/schemas/remote_host.py backend/app/database.py backend/tests/conftest.py
git commit -m "feat: add RemoteHost model, schemas, and auto-migration"
```

---

## Task 2: RemoteHost CRUD router

**Files:**
- Create: `backend/app/routers/remote_hosts.py`
- Modify: `backend/app/main.py:12,45` (import + register router)
- Create: `backend/tests/test_remote_hosts.py`

**Interfaces:**
- Consumes: `RemoteHost` model (Task 1), `RemoteHostCreate/Update/Response` schemas (Task 1).
- Produces: CRUD endpoints at `/api/v1/remote-hosts` — list (GET), create (POST), get (GET /{id}), update (PUT /{id}), delete (DELETE /{id}).

- [ ] **Step 1: Write failing test `backend/tests/test_remote_hosts.py`**

```python
import pytest


@pytest.fixture
def sample_host(client):
    resp = client.post("/api/v1/remote-hosts", json={
        "name": "dev-server",
        "ssh_user": "ubuntu",
        "ssh_host": "10.0.0.5",
        "ssh_port": 22,
        "base_path_template": "/home/{ssh_user}/deploy/{task_title_slug}",
        "description": "Dev environment",
    })
    assert resp.status_code == 201
    return resp.json()


def test_create_remote_host(client):
    resp = client.post("/api/v1/remote-hosts", json={
        "name": "prod",
        "ssh_user": "deploy",
        "ssh_host": "prod.example.com",
        "base_path_template": "/srv/app/{task_title_slug}",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "prod"
    assert data["ssh_port"] == 22  # default applied
    assert "id" in data and len(data["id"]) == 36


def test_create_remote_host_validation_error(client):
    resp = client.post("/api/v1/remote-hosts", json={
        "name": "missing-fields",
    })
    assert resp.status_code == 422


def test_create_remote_host_invalid_port(client):
    resp = client.post("/api/v1/remote-hosts", json={
        "name": "bad-port",
        "ssh_user": "u",
        "ssh_host": "h",
        "ssh_port": 99999,
        "base_path_template": "/x",
    })
    assert resp.status_code == 422


def test_list_remote_hosts(client, sample_host):
    resp = client.get("/api/v1/remote-hosts")
    assert resp.status_code == 200
    assert any(h["id"] == sample_host["id"] for h in resp.json())


def test_get_remote_host(client, sample_host):
    resp = client.get(f"/api/v1/remote-hosts/{sample_host['id']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "dev-server"


def test_get_remote_host_404(client):
    resp = client.get("/api/v1/remote-hosts/nonexistent")
    assert resp.status_code == 404


def test_update_remote_host(client, sample_host):
    resp = client.put(f"/api/v1/remote-hosts/{sample_host['id']}", json={
        "name": "staging-server",
        "ssh_port": 2222,
    })
    assert resp.status_code == 200
    assert resp.json()["name"] == "staging-server"
    assert resp.json()["ssh_port"] == 2222


def test_update_remote_host_404(client):
    resp = client.put("/api/v1/remote-hosts/nonexistent", json={"name": "x"})
    assert resp.status_code == 404


def test_delete_remote_host(client, sample_host):
    resp = client.delete(f"/api/v1/remote-hosts/{sample_host['id']}")
    assert resp.status_code == 204
    # Verify it's gone
    resp = client.get(f"/api/v1/remote-hosts/{sample_host['id']}")
    assert resp.status_code == 404


def test_delete_remote_host_404(client):
    resp = client.delete("/api/v1/remote-hosts/nonexistent")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_remote_hosts.py -v`
Expected: all tests FAIL with 404 errors (router doesn't exist yet).

- [ ] **Step 3: Write `backend/app/routers/remote_hosts.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.remote_host import RemoteHost
from app.schemas.remote_host import (
    RemoteHostCreate,
    RemoteHostUpdate,
    RemoteHostResponse,
)

router = APIRouter(tags=["remote-hosts"])


@router.get("/remote-hosts", response_model=list[RemoteHostResponse])
def list_hosts(db: Session = Depends(get_db)):
    return db.query(RemoteHost).order_by(RemoteHost.created_at.desc()).all()


@router.post("/remote-hosts", response_model=RemoteHostResponse, status_code=201)
def create_host(data: RemoteHostCreate, db: Session = Depends(get_db)):
    host = RemoteHost(**data.model_dump())
    db.add(host)
    db.commit()
    db.refresh(host)
    return host


@router.get("/remote-hosts/{host_id}", response_model=RemoteHostResponse)
def get_host(host_id: str, db: Session = Depends(get_db)):
    host = db.query(RemoteHost).filter(RemoteHost.id == host_id).first()
    if not host:
        raise HTTPException(status_code=404, detail="Remote host not found")
    return host


@router.put("/remote-hosts/{host_id}", response_model=RemoteHostResponse)
def update_host(host_id: str, data: RemoteHostUpdate, db: Session = Depends(get_db)):
    host = db.query(RemoteHost).filter(RemoteHost.id == host_id).first()
    if not host:
        raise HTTPException(status_code=404, detail="Remote host not found")
    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(host, k, v)
    db.commit()
    db.refresh(host)
    return host


@router.delete("/remote-hosts/{host_id}", status_code=204)
def delete_host(host_id: str, db: Session = Depends(get_db)):
    host = db.query(RemoteHost).filter(RemoteHost.id == host_id).first()
    if not host:
        raise HTTPException(status_code=404, detail="Remote host not found")
    db.delete(host)
    db.commit()
```

- [ ] **Step 4: Register router in `backend/app/main.py`**

Modify line 12 (import) — append `, remote_hosts` to the import:

```python
from app.routers import projects, tasks, board, execution_configs, activity, code_projects, statistics, trash, worktree_configs, worktrees, remote_hosts
```

Add a new line after line 45 (`app.include_router(worktrees.router, prefix="/api/v1")`):

```python
app.include_router(remote_hosts.router, prefix="/api/v1")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_remote_hosts.py -v`
Expected: all tests PASS.

- [ ] **Step 6: Run full backend test suite to confirm no regressions**

Run: `cd backend && python -m pytest tests/ -v`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/remote_hosts.py backend/app/main.py backend/tests/test_remote_hosts.py
git commit -m "feat: add RemoteHost CRUD API"
```

---

## Task 3: Extend `expand_template` with `extra_vars` and `{project_slug}`

**Files:**
- Modify: `backend/app/services/worktree_service.py:11-29` (the `expand_template` function)
- Modify: `backend/tests/test_worktree_service.py` (add tests for new behavior)

**Interfaces:**
- Consumes: existing function signature.
- Produces: `expand_template(template, task, project, branch=None, extra_vars=None) -> str` — backwards-compatible (existing 3 callers unaffected). New variable `{project_slug}` always available; extra_vars dict is merged in.

- [ ] **Step 1: Read existing test file to understand test style**

Run: `cd backend && head -50 tests/test_worktree_service.py`

(Read the existing test patterns to match style.)

- [ ] **Step 2: Write failing tests**

Append to `backend/tests/test_worktree_service.py`:

```python
def test_expand_template_supports_project_slug():
    """New {project_slug} variable should be derived from project name."""
    from app.services.worktree_service import expand_template

    class FakeProject:
        id = "p1"
        name = "My Cool Project!"

    class FakeTask:
        id = "task-uuid-1234"
        title = "Fix Login Bug"
        task_type = "task"
        priority = "high"
        assignee = "alice"

    result = expand_template("/srv/{project_slug}/deploy", FakeTask(), FakeProject())
    assert result == "/srv/my-cool-project/deploy"


def test_expand_template_accepts_extra_vars():
    """extra_vars should add new tokens without breaking existing ones."""
    from app.services.worktree_service import expand_template

    class FakeProject:
        id = "p1"
        name = "Demo"

    class FakeTask:
        id = "t1"
        title = "Hello"
        task_type = "task"
        priority = "medium"
        assignee = None

    result = expand_template(
        "/home/{ssh_user}/{project_name}/{task_title_slug}",
        FakeTask(),
        FakeProject(),
        extra_vars={"{ssh_user}": "ubuntu"},
    )
    assert result == "/home/ubuntu/Demo/hello"


def test_expand_template_extra_vars_overrides_existing():
    """If extra_vars contains an existing token key, extra_vars wins."""
    from app.services.worktree_service import expand_template

    class FakeProject:
        id = "p1"
        name = "Demo"

    class FakeTask:
        id = "t1"
        title = "Real Title"
        task_type = "task"
        priority = "medium"
        assignee = None

    result = expand_template(
        "{task_title}",
        FakeTask(),
        FakeProject(),
        extra_vars={"{task_title}": "Override"},
    )
    assert result == "Override"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_worktree_service.py::test_expand_template_supports_project_slug tests/test_worktree_service.py::test_expand_template_accepts_extra_vars tests/test_worktree_service.py::test_expand_template_extra_vars_overrides_existing -v`
Expected: FAIL with `TypeError: expand_template() got an unexpected keyword argument 'extra_vars'` (or missing `{project_slug}` literal).

- [ ] **Step 4: Modify `expand_template` in `backend/app/services/worktree_service.py`**

Replace the function (lines 11-29 in the existing file) with:

```python
def _slugify(value: str) -> str:
    return re.sub(r'[^a-zA-Z0-9]+', '-', value).strip('-').lower()[:60]


def expand_template(
    template: str,
    task,
    project,
    branch: str | None = None,
    extra_vars: dict[str, str] | None = None,
) -> str:
    variables = {
        "{task_id}": task.id,
        "{task_id_short}": task.id[:8],
        "{task_title}": task.title,
        "{task_title_slug}": _slugify(task.title),
        "{task_type}": task.task_type or "",
        "{task_priority}": task.priority or "",
        "{task_assignee}": task.assignee or "",
        "{project_id}": project.id,
        "{project_name}": project.name,
        "{project_slug}": _slugify(project.name),
    }
    if branch:
        variables["{branch_name}"] = branch
    if extra_vars:
        variables.update(extra_vars)
    result = template
    for token, value in variables.items():
        result = result.replace(token, str(value))
    return result
```

- [ ] **Step 5: Run new tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_worktree_service.py -v`
Expected: all tests PASS (including existing ones — confirms backwards compat).

- [ ] **Step 6: Run full backend test suite**

Run: `cd backend && python -m pytest tests/ -v`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/worktree_service.py backend/tests/test_worktree_service.py
git commit -m "feat: extend expand_template with extra_vars and project_slug"
```

---

## Task 4: Implement `remote_sync_service`

**Files:**
- Create: `backend/app/services/remote_sync_service.py`
- Create: `backend/tests/test_remote_sync.py`

**Interfaces:**
- Consumes: `expand_template` from `worktree_service` (Task 3).
- Produces:
  - `expand_path_template(template: str, task, host, branch: str | None = None) -> str`
  - `build_rsync_command(src_path: str, host, dest_path: str, *, use_password: bool) -> list[str]`
  - `run_sync(src_path: str, host, dest_path: str, password: str | None = None) -> dict`

- [ ] **Step 1: Write failing tests `backend/tests/test_remote_sync.py`**

```python
import pytest
from unittest.mock import patch, MagicMock


@pytest.fixture
def fake_host():
    host = MagicMock()
    host.ssh_user = "ubuntu"
    host.ssh_host = "10.0.0.5"
    host.ssh_port = 22
    host.base_path_template = "/home/{ssh_user}/deploy/{task_title_slug}"
    host.name = "dev-server"
    return host


@pytest.fixture
def fake_task():
    task = MagicMock()
    task.id = "task-uuid-1234"
    task.title = "Fix Login Bug!"
    task.task_type = "task"
    task.priority = "high"
    task.assignee = "alice"
    return task


@pytest.fixture
def fake_project():
    proj = MagicMock()
    proj.id = "proj-uuid"
    proj.name = "Kanban App"
    return proj


def test_expand_path_template_substitutes_host_vars(fake_task, fake_project, fake_host):
    from app.services.remote_sync_service import expand_path_template

    fake_task.project = fake_project
    result = expand_path_template(
        "/home/{ssh_user}/deploy/{task_title_slug}",
        fake_task,
        fake_host,
    )
    assert result == "/home/ubuntu/deploy/fix-login-bug"


def test_build_rsync_command_key_mode(fake_host):
    """SSH-key mode: -e ssh includes BatchMode=yes, no sshpass prefix."""
    from app.services.remote_sync_service import build_rsync_command

    cmd = build_rsync_command("/src/path", fake_host, "/dest/path", use_password=False)

    assert cmd[0] == "rsync"
    assert "-avz" in cmd
    assert "--delete" in cmd
    # SSH opts must include BatchMode=yes (no password prompt)
    ssh_arg = next(arg for arg in cmd if arg.startswith("ssh "))
    assert "BatchMode=yes" in ssh_arg
    assert "StrictHostKeyChecking=accept-new" in ssh_arg
    assert " -p 22 " in ssh_arg
    # Source and dest at the end with trailing slashes
    assert cmd[-2] == "/src/path/"
    assert cmd[-1] == "ubuntu@10.0.0.5:/dest/path/"
    # Excludes
    assert "--exclude=.git/" in cmd
    assert "--exclude=node_modules/" in cmd
    assert "--exclude=__pycache__/" in cmd
    assert "--exclude=*.pyc" in cmd
    assert "--exclude=.venv/" in cmd
    assert "--exclude=dist/" in cmd
    assert "--exclude=build/" in cmd
    assert "--exclude=.DS_Store" in cmd


def test_build_rsync_command_password_mode(fake_host):
    """Password mode: -e ssh must NOT include BatchMode (would block sshpass)."""
    from app.services.remote_sync_service import build_rsync_command

    cmd = build_rsync_command("/src/path", fake_host, "/dest/path", use_password=True)

    ssh_arg = next(arg for arg in cmd if arg.startswith("ssh "))
    assert "BatchMode" not in ssh_arg  # Critical: would break sshpass
    assert "StrictHostKeyChecking=accept-new" in ssh_arg


def test_build_rsync_command_custom_port():
    from app.services.remote_sync_service import build_rsync_command

    host = MagicMock()
    host.ssh_user = "u"
    host.ssh_host = "h"
    host.ssh_port = 2222

    cmd = build_rsync_command("/src", host, "/dest", use_password=False)
    ssh_arg = next(arg for arg in cmd if arg.startswith("ssh "))
    assert "-p 2222" in ssh_arg


def test_run_sync_success_no_password(fake_host):
    from app.services.remote_sync_service import run_sync

    mock_proc = MagicMock()
    mock_proc.stdout = "sending incremental file list\n"
    mock_proc.stderr = ""
    mock_proc.returncode = 0

    with patch("app.services.remote_sync_service.subprocess.run", return_value=mock_proc) as mock_run:
        result = run_sync("/src", fake_host, "/dest", password=None)

    assert result["success"] is True
    assert result["exit_code"] == 0
    assert result["stdout"] == "sending incremental file list\n"
    assert "sshpass" not in result["command"]
    # Env should NOT have SSHPASS
    call_kwargs = mock_run.call_args.kwargs
    assert "SSHPASS" not in call_kwargs.get("env", {})


def test_run_sync_success_with_password(fake_host):
    """Password mode: command prefixed with sshpass, SSHPASS env set on subprocess only."""
    import os
    from app.services.remote_sync_service import run_sync

    mock_proc = MagicMock()
    mock_proc.stdout = ""
    mock_proc.stderr = ""
    mock_proc.returncode = 0

    parent_env_snapshot = dict(os.environ)

    with patch("app.services.remote_sync_service.subprocess.run", return_value=mock_proc) as mock_run:
        result = run_sync("/src", fake_host, "/dest", password="hunter2")

    assert result["success"] is True
    # The argv passed to subprocess must start with sshpass -e
    argv = mock_run.call_args.args[0]
    assert argv[0] == "sshpass"
    assert argv[1] == "-e"
    # SSHPASS must be in subprocess env
    sub_env = mock_run.call_args.kwargs.get("env", {})
    assert sub_env.get("SSHPASS") == "hunter2"
    # Parent process env must be untouched
    assert os.environ == parent_env_snapshot
    # Command echo should NOT include the password
    assert "hunter2" not in result["command"]


def test_run_sync_failure_returns_success_false(fake_host):
    from app.services.remote_sync_service import run_sync

    mock_proc = MagicMock()
    mock_proc.stdout = ""
    mock_proc.stderr = "Permission denied (publickey).\n"
    mock_proc.returncode = 255

    with patch("app.services.remote_sync_service.subprocess.run", return_value=mock_proc):
        result = run_sync("/src", fake_host, "/dest", password=None)

    assert result["success"] is False
    assert result["exit_code"] == 255
    assert "Permission denied" in result["stderr"]


def test_run_sync_timeout(fake_host):
    """Subprocess timeout should surface as a failure, not crash."""
    from app.services.remote_sync_service import run_sync
    from subprocess import TimeoutExpired

    with patch("app.services.remote_sync_service.subprocess.run", side_effect=TimeoutExpired(cmd="rsync", timeout=300)):
        result = run_sync("/src", fake_host, "/dest", password=None)

    assert result["success"] is False
    assert "timed out" in result["stderr"].lower() or "timeout" in result["stderr"].lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_remote_sync.py -v`
Expected: all tests FAIL with `ModuleNotFoundError: No module named 'app.services.remote_sync_service'`.

- [ ] **Step 3: Write `backend/app/services/remote_sync_service.py`**

```python
"""Service for rsync-ing a task's worktree contents to a remote host."""
import os
import shutil
import subprocess
from subprocess import TimeoutExpired

from app.services.worktree_service import expand_template


RSYNC_TIMEOUT_SECONDS = 300

DEFAULT_EXCLUDES = [
    ".git/",
    "node_modules/",
    "__pycache__/",
    "*.pyc",
    ".venv/",
    "dist/",
    "build/",
    ".DS_Store",
]


def expand_path_template(template: str, task, host, branch: str | None = None) -> str:
    """Expand host.base_path_template using task, project, and host variables."""
    extra_vars = {
        "{ssh_user}": host.ssh_user,
        "{ssh_host}": host.ssh_host,
    }
    return expand_template(template, task, task.project, branch=branch, extra_vars=extra_vars)


def build_rsync_command(src_path: str, host, dest_path: str, *, use_password: bool) -> list[str]:
    """Build the rsync argv list. If use_password=True, omit BatchMode so sshpass can intercept."""
    ssh_opts = ["ssh", "-p", str(host.ssh_port), "-o", "StrictHostKeyChecking=accept-new"]
    if not use_password:
        ssh_opts.append("-o")
        ssh_opts.append("BatchMode=yes")

    cmd = ["rsync", "-avz", "--delete", "-e", " ".join(ssh_opts)]
    for exclude in DEFAULT_EXCLUDES:
        cmd.extend(["--exclude", exclude])
    cmd.append(src_path.rstrip("/") + "/")
    cmd.append(f"{host.ssh_user}@{host.ssh_host}:{dest_path.rstrip('/')}/")
    return cmd


def _format_command_for_display(argv: list[str]) -> str:
    """Human-readable command. We strip the password (caller passes sshpass -e form which uses env var, not -p)."""
    return " ".join(argv)


def run_sync(src_path: str, host, dest_path: str, password: str | None = None) -> dict:
    """Execute rsync. Returns dict with keys: success, stdout, stderr, exit_code, command.

    If password is provided, prepends `sshpass -e` and sets SSHPASS env var on the
    subprocess only (never propagates to parent process).
    """
    use_password = bool(password)

    if use_password and not shutil.which("sshpass"):
        return {
            "success": False,
            "stdout": "",
            "stderr": "`sshpass` is not installed on the server. Install with `apt install sshpass` (or equivalent) to use password authentication.",
            "exit_code": -1,
            "command": "",
        }

    if not shutil.which("rsync"):
        return {
            "success": False,
            "stdout": "",
            "stderr": "`rsync` is not installed on the server. Install with `apt install rsync` (or equivalent).",
            "exit_code": -1,
            "command": "",
        }

    rsync_argv = build_rsync_command(src_path, host, dest_path, use_password=use_password)

    if use_password:
        argv = ["sshpass", "-e"] + rsync_argv
        sub_env = dict(os.environ)
        sub_env["SSHPASS"] = password
    else:
        argv = rsync_argv
        sub_env = None  # inherit parent

    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=RSYNC_TIMEOUT_SECONDS,
            env=sub_env,
        )
        return {
            "success": proc.returncode == 0,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "exit_code": proc.returncode,
            "command": _format_command_for_display(rsync_argv),  # NOTE: never includes password
        }
    except TimeoutExpired:
        return {
            "success": False,
            "stdout": "",
            "stderr": f"rsync timed out after {RSYNC_TIMEOUT_SECONDS} seconds.",
            "exit_code": -1,
            "command": _format_command_for_display(rsync_argv),
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_remote_sync.py -v`
Expected: all tests PASS.

- [ ] **Step 5: Run full backend test suite**

Run: `cd backend && python -m pytest tests/ -v`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/remote_sync_service.py backend/tests/test_remote_sync.py
git commit -m "feat: add remote_sync_service with rsync command builder and runner"
```

---

## Task 5: Add `remote_host_id` to Task model and schemas

**Files:**
- Modify: `backend/app/models/task.py:48-56` (add column + relationship)
- Modify: `backend/app/schemas/task.py:14-91` (add to Create/Update/Response)
- Modify: `backend/tests/test_tasks.py` (add tests for the new field)

**Interfaces:**
- Consumes: `RemoteHost` model (Task 1).
- Produces: `Task.remote_host_id` (nullable FK), `Task.remote_host` relationship (`lazy="joined"`); Pydantic schemas accept/return it.

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_tasks.py`:

```python
def test_create_task_with_remote_host_id(client, sample_project):
    """TaskCreate accepts remote_host_id and stores it."""
    # First create a host
    host = client.post("/api/v1/remote-hosts", json={
        "name": "dev",
        "ssh_user": "u",
        "ssh_host": "h",
        "base_path_template": "/srv/{task_title_slug}",
    }).json()

    resp = client.post(f"/api/v1/projects/{sample_project['id']}/tasks", json={
        "title": "Task with host",
        "remote_host_id": host["id"],
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["remote_host_id"] == host["id"]
    assert data["remote_host"]["name"] == "dev"


def test_update_task_remote_host_id(client, sample_task):
    host = client.post("/api/v1/remote-hosts", json={
        "name": "staging",
        "ssh_user": "u",
        "ssh_host": "h",
        "base_path_template": "/srv/{task_title_slug}",
    }).json()

    resp = client.put(f"/api/v1/tasks/{sample_task['id']}", json={
        "remote_host_id": host["id"],
    })
    assert resp.status_code == 200
    assert resp.json()["remote_host_id"] == host["id"]


def test_clear_task_remote_host_id(client, sample_task):
    host = client.post("/api/v1/remote-hosts", json={
        "name": "staging",
        "ssh_user": "u",
        "ssh_host": "h",
        "base_path_template": "/srv/{task_title_slug}",
    }).json()
    client.put(f"/api/v1/tasks/{sample_task['id']}", json={"remote_host_id": host["id"]})

    # Clear it
    resp = client.put(f"/api/v1/tasks/{sample_task['id']}", json={"remote_host_id": None})
    assert resp.status_code == 200
    assert resp.json()["remote_host_id"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_tasks.py::test_create_task_with_remote_host_id tests/test_tasks.py::test_update_task_remote_host_id tests/test_tasks.py::test_clear_task_remote_host_id -v`
Expected: FAIL with validation error (field not accepted) or 422.

- [ ] **Step 3: Modify `backend/app/models/task.py`**

Add a column after `worktree_id` (line 48):

```python
    worktree_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("worktrees.id", ondelete="SET NULL"), nullable=True)
    remote_host_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("remote_hosts.id", ondelete="SET NULL"), nullable=True)
```

Add a relationship after `worktree = relationship(...)` (line 56):

```python
    worktree = relationship("Worktree", foreign_keys=[worktree_id])
    remote_host = relationship("RemoteHost", foreign_keys=[remote_host_id], lazy="joined")
```

- [ ] **Step 4: Modify `backend/app/schemas/task.py`**

In `TaskCreate` (after line 30 `worktree_config_id: str | None = None`), add:

```python
    remote_host_id: str | None = None
```

In `TaskUpdate` (after line 51 `worktree_config_id: str | None = None`), add:

```python
    remote_host_id: str | None = None
```

In `TaskResponse`, after `worktree: WorktreeBrief | None = None` (line 87), add two lines:

```python
    worktree: WorktreeBrief | None = None
    remote_host_id: str | None = None
    remote_host: "RemoteHostBrief | None" = None
```

At the bottom of `schemas/task.py`, add the brief schema:

```python
class RemoteHostBrief(BaseModel):
    id: str
    name: str
    ssh_user: str
    ssh_host: str
    ssh_port: int
    base_path_template: str

    model_config = {"from_attributes": True}
```

**Important**: Update the `model_config = {"from_attributes": True}` block in `TaskResponse` — Pydantic will follow the relationship automatically since the ORM attribute matches the field name.

- [ ] **Step 5: Modify `backend/app/routers/tasks.py` create and update endpoints**

Find `create_task` (around line 147) and `update_task` (around line 189). These functions likely do `Task(**data.model_dump())` or similar. Verify they pass `remote_host_id` through. If they use `model_dump(exclude_unset=True)` with a per-key copy, you may need to add the new field. Check the existing code:

Run: `grep -n "remote_host_id\|worktree_config_id" backend/app/routers/tasks.py`

If `worktree_config_id` is handled by spreading `data.model_dump()` into `Task(...)`, `remote_host_id` will work automatically. Otherwise, add handling parallel to `worktree_config_id`.

- [ ] **Step 6: Run new tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_tasks.py -v`
Expected: all tests PASS.

- [ ] **Step 7: Run full backend test suite**

Run: `cd backend && python -m pytest tests/ -v`
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/task.py backend/app/schemas/task.py backend/app/routers/tasks.py backend/tests/test_tasks.py
git commit -m "feat: add remote_host_id to Task model and schemas"
```

---

## Task 6: Add `POST /tasks/{id}/sync` endpoint

**Files:**
- Modify: `backend/app/routers/tasks.py` (add endpoint at end)
- Modify: `backend/tests/test_remote_sync.py` (add API-level tests)

**Interfaces:**
- Consumes: `remote_sync_service.run_sync` (Task 4), `SyncRequest`/`SyncResponse` schemas (Task 1), `activity_service` (existing).
- Produces: `POST /api/v1/tasks/{task_id}/sync` returning `SyncResponse`.

- [ ] **Step 1: Find activity_service logging helper**

Run: `grep -n "def log" backend/app/services/activity_service.py`

Note the exact function name and signature (likely `log_activity(db, project_id, event_type, entity_type, entity_id, entity_name, detail, extra_data)` or similar).

- [ ] **Step 2: Write failing API tests**

Append to `backend/tests/test_remote_sync.py`:

```python
import json


def test_sync_endpoint_no_worktree(client, sample_task):
    """Task without a worktree should return 400."""
    resp = client.post(f"/api/v1/tasks/{sample_task['id']}/sync", json={})
    assert resp.status_code == 400
    assert "worktree" in resp.json()["detail"].lower()


def test_sync_endpoint_no_host_configured(client, sample_task):
    """Task with no remote_host_id and no host_id in body should return 400."""
    # Give the task a worktree so we get past that check
    sample_task["worktree"] = None  # ensure clean state

    # Create a worktree manually via DB (bypass git) just for this test
    from app.database import SessionLocal
    from app.models.worktree import Worktree
    from app.models.task import Task

    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == sample_task["id"]).first()
        wt = Worktree(
            task_id=task.id,
            branch="test-branch",
            path="/tmp/fake-worktree",
            status="active",
        )
        db.add(wt)
        db.flush()
        task.worktree_id = wt.id
        db.commit()
    finally:
        db.close()

    resp = client.post(f"/api/v1/tasks/{sample_task['id']}/sync", json={})
    assert resp.status_code == 400
    assert "remote host" in resp.json()["detail"].lower()


def test_sync_endpoint_host_not_found(client, sample_task):
    from app.database import SessionLocal
    from app.models.worktree import Worktree
    from app.models.task import Task

    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == sample_task["id"]).first()
        wt = Worktree(task_id=task.id, branch="b", path="/tmp/x", status="active")
        db.add(wt)
        db.flush()
        task.worktree_id = wt.id
        db.commit()
    finally:
        db.close()

    resp = client.post(f"/api/v1/tasks/{sample_task['id']}/sync", json={"host_id": "nonexistent"})
    assert resp.status_code == 404


def test_sync_endpoint_happy_path(client, sample_task):
    """Successful sync returns SyncResponse and writes activity log."""
    from app.database import SessionLocal
    from app.models.worktree import Worktree
    from app.models.task import Task
    from app.models.activity_log import ActivityLog

    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == sample_task["id"]).first()
        wt = Worktree(task_id=task.id, branch="b", path="/tmp/myworktree", status="active")
        db.add(wt)
        db.flush()
        task.worktree_id = wt.id
        db.commit()
        task_id = task.id
        project_id = task.project_id
    finally:
        db.close()

    host = client.post("/api/v1/remote-hosts", json={
        "name": "dev",
        "ssh_user": "ubuntu",
        "ssh_host": "10.0.0.5",
        "base_path_template": "/home/{ssh_user}/deploy/{task_title_slug}",
    }).json()

    mock_result = {
        "success": True,
        "stdout": "sent 100 bytes",
        "stderr": "",
        "exit_code": 0,
        "command": "rsync -avz ...",
    }
    with patch("app.routers.tasks.run_sync", return_value=mock_result):
        resp = client.post(f"/api/v1/tasks/{task_id}/sync", json={"host_id": host["id"]})

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["host_name"] == "dev"
    assert data["dest_path"].startswith("/home/ubuntu/deploy/")

    # Verify activity log entry
    db = SessionLocal()
    try:
        log = db.query(ActivityLog).filter(
            ActivityLog.entity_id == task_id,
            ActivityLog.event_type == "task.synced",
        ).first()
        assert log is not None
        assert "dev" in log.detail
        # Password must never appear in extra_data
        assert "password" not in (log.extra_data or "").lower()
    finally:
        db.close()


def test_sync_endpoint_password_not_in_response(client, sample_task):
    """Password from request must not leak into response."""
    from app.database import SessionLocal
    from app.models.worktree import Worktree
    from app.models.task import Task

    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == sample_task["id"]).first()
        wt = Worktree(task_id=task.id, branch="b", path="/tmp/wt", status="active")
        db.add(wt)
        db.flush()
        task.worktree_id = wt.id
        db.commit()
        task_id = task.id
    finally:
        db.close()

    host = client.post("/api/v1/remote-hosts", json={
        "name": "dev",
        "ssh_user": "u",
        "ssh_host": "h",
        "base_path_template": "/x",
    }).json()

    mock_result = {
        "success": True, "stdout": "", "stderr": "", "exit_code": 0, "command": "rsync",
    }
    with patch("app.routers.tasks.run_sync", return_value=mock_result) as mock_fn:
        resp = client.post(f"/api/v1/tasks/{task_id}/sync", json={
            "host_id": host["id"],
            "password": "super-secret-pw",
        })

    assert resp.status_code == 200
    # Password must not appear in response body anywhere
    assert "super-secret-pw" not in resp.text
    # The service must have been called with the password
    mock_fn.assert_called_once()
    assert mock_fn.call_args.kwargs.get("password") == "super-secret-pw"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_remote_sync.py -v`
Expected: API tests FAIL with 404 (endpoint doesn't exist).

- [ ] **Step 4: Add imports to `backend/app/routers/tasks.py`**

At the top of the file, add:

```python
from app.schemas.remote_host import SyncRequest, SyncResponse
from app.services.remote_sync_service import expand_path_template, run_sync
from app.models.remote_host import RemoteHost
```

If `activity_service` is not already imported, add (use the actual function name from Step 1):

```python
from app.services.activity_service import log_activity  # adjust name if different
```

- [ ] **Step 5: Add the sync endpoint**

Append to `backend/app/routers/tasks.py`:

```python
@router.post("/tasks/{task_id}/sync", response_model=SyncResponse)
def sync_task(task_id: str, body: SyncRequest, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task.worktree or task.worktree.status != "active":
        raise HTTPException(status_code=400, detail="Task has no active worktree. Create one first.")

    # Resolve host: explicit host_id wins, else task.default
    host_id = body.host_id or task.remote_host_id
    if not host_id:
        raise HTTPException(status_code=400, detail="No remote host configured. Set one on the task or pass host_id.")

    host = db.query(RemoteHost).filter(RemoteHost.id == host_id).first()
    if not host:
        raise HTTPException(status_code=404, detail="Remote host not found")

    dest_path = expand_path_template(host.base_path_template, task, host, branch=task.worktree.branch)

    result = run_sync(task.worktree.path, host, dest_path, password=body.password)

    # Log to activity log (never include password)
    try:
        log_activity(
            db,
            project_id=task.project_id,
            event_type="task.synced",
            entity_type="task",
            entity_id=task.id,
            entity_name=task.title,
            detail=f"Synced to {host.name} ({host.ssh_user}@{host.ssh_host}:{dest_path})",
            extra_data=json.dumps({
                "success": result["success"],
                "exit_code": result["exit_code"],
                "using_password": body.password is not None,
            }),
        )
    except Exception:
        # Logging failures should not fail the sync response
        pass

    return SyncResponse(
        success=result["success"],
        stdout=result["stdout"],
        stderr=result["stderr"],
        exit_code=result["exit_code"],
        command=result["command"],
        dest_path=dest_path,
        host_name=host.name,
    )
```

Make sure `json` and `Session`/`HTTPException` are imported at the top of the file.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_remote_sync.py -v`
Expected: all tests PASS.

- [ ] **Step 7: Run full backend test suite**

Run: `cd backend && python -m pytest tests/ -v`
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/tasks.py backend/tests/test_remote_sync.py
git commit -m "feat: add POST /tasks/{id}/sync endpoint"
```

---

## Task 7: Frontend types and API client

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Produces: TypeScript interfaces `RemoteHost`, `RemoteHostCreate`, `SyncRequest`, `SyncResult`; adds `remote_host_id`/`remote_host` to `Task` and `TaskCreate`.

- [ ] **Step 1: Add types to `frontend/src/types/index.ts`**

Add after the `Worktree` interface (around line 149):

```typescript
export interface RemoteHost {
  id: string;
  name: string;
  description: string | null;
  ssh_user: string;
  ssh_host: string;
  ssh_port: number;
  base_path_template: string;
  created_at: string;
  updated_at: string;
}

export type RemoteHostCreate = Pick<RemoteHost,
  'name' | 'ssh_user' | 'ssh_host' | 'base_path_template'
> & {
  description?: string;
  ssh_port?: number;
};

export interface RemoteHostBrief {
  id: string;
  name: string;
  ssh_user: string;
  ssh_host: string;
  ssh_port: number;
  base_path_template: string;
}

export interface SyncRequest {
  host_id?: string;
  password?: string;
}

export interface SyncResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
  command: string;
  dest_path: string;
  host_name: string;
}
```

In the `Task` interface (around line 45), add after `worktree: Worktree | null;`:

```typescript
  worktree: Worktree | null;
  remote_host_id: string | null;
  remote_host: RemoteHostBrief | null;
```

In the `TaskCreate` type (around line 160), add after `worktree_config_id?: string;`:

```typescript
  worktree_config_id?: string;
  remote_host_id?: string | null;
```

- [ ] **Step 2: Add API client functions to `frontend/src/services/api.ts`**

First, check existing style:

Run: `grep -n "worktreeApi\|executionConfigApi\|export const" frontend/src/services/api.ts | head -10`

Add the new API block near the existing `worktreeConfigApi`/`worktreeApi`:

```typescript
export const remoteHostApi = {
  list: () => api.get<RemoteHost[]>('/remote-hosts').then(r => r.data),
  create: (data: RemoteHostCreate) =>
    api.post<RemoteHost>('/remote-hosts', data).then(r => r.data),
  update: (id: string, data: Partial<RemoteHostCreate>) =>
    api.put<RemoteHost>(`/remote-hosts/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/remote-hosts/${id}`),
};

export const syncTask = (taskId: string, body: SyncRequest) =>
  api.post<SyncResult>(`/tasks/${taskId}/sync`, body).then(r => r.data);
```

Make sure `RemoteHost`, `RemoteHostCreate`, `SyncRequest`, `SyncResult` are imported from `../types` at the top of the file (match the existing import style).

- [ ] **Step 3: Run TypeScript compiler to verify no type errors**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat: add RemoteHost and Sync types and API client"
```

---

## Task 8: SettingsPage — Remote Hosts tab

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `remoteHostApi` (Task 7), `RemoteHost`/`RemoteHostCreate` types.
- Produces: a new tab in SettingsPage that mirrors the existing Worktree tab UI pattern.

- [ ] **Step 1: Read existing Worktree tab implementation as template**

Run: `grep -n "worktree\|Worktree\|tab" frontend/src/pages/SettingsPage.tsx | head -30`

Read the entire Worktree tab section to mirror its structure (state management, form layout, list rendering).

- [ ] **Step 2: Implement the Remote Hosts tab**

In `frontend/src/pages/SettingsPage.tsx`:

1. Add `RemoteHost`, `RemoteHostCreate` to the type imports.
2. Add `remoteHostApi` to the api import.
3. Add a new state block near the worktree state:

```typescript
const [remoteHosts, setRemoteHosts] = useState<RemoteHost[]>([]);
const [remoteHostForm, setRemoteHostForm] = useState<Partial<RemoteHostCreate>>({
  name: '', description: '', ssh_user: '', ssh_host: '', ssh_port: 22,
  base_path_template: '/home/{ssh_user}/deploy/{task_title_slug}',
});
const [editingRemoteHostId, setEditingRemoteHostId] = useState<string | null>(null);
```

4. Add a `loadRemoteHosts` function (mirrors `loadWorktreeConfigs`).
5. Add `handleSubmitRemoteHost`, `handleEditRemoteHost`, `handleDeleteRemoteHost` (mirror their worktree equivalents).
6. Call `loadRemoteHosts()` in the existing `useEffect` that loads worktree configs.
7. Add a new tab button next to the Worktree tab button:

```tsx
<button
  onClick={() => setActiveTab('remote-hosts')}
  className={`px-4 py-2 rounded-md ${activeTab === 'remote-hosts' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
>
  Remote Hosts
</button>
```

8. Add the tab content panel (mirrors the Worktree tab UI structure but with these form fields):
   - Name (text input, required)
   - Description (textarea)
   - SSH User (text input, required)
   - SSH Host (text input, required)
   - SSH Port (number input, default 22)
   - Base Path Template (text input, required, with helper text listing available variables: `{ssh_user}`, `{ssh_host}`, `{task_title_slug}`, `{task_id}`, `{task_id_short}`, `{project_name}`, `{project_slug}`, `{branch_name}`)
   - Save / Cancel buttons
9. Add a list section showing all remote hosts with edit/delete buttons.

- [ ] **Step 3: Test manually**

Run: `cd frontend && npm run dev`

Open browser to `http://localhost:5173/settings`, click "Remote Hosts" tab, verify:
- Can create a host
- Host appears in list
- Can edit a host
- Can delete a host
- Validation works (required fields enforced)
- Helper text shows template variables

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx
git commit -m "feat: add Remote Hosts management tab to SettingsPage"
```

---

## Task 9: Task detail — remote host selector + sync button

**Files:**
- Modify: `frontend/src/pages/KanbanBoard.tsx` (task editor is inline around lines 469/895+)

**Interfaces:**
- Consumes: `remoteHostApi`, `syncTask` (Task 7); `RemoteHost` type.
- Produces: dropdown to set `remote_host_id` on the task; "Sync to Remote" button that reveals a sync panel.

- [ ] **Step 1: Read existing task detail modal structure**

Run: `sed -n '460,500p' frontend/src/pages/KanbanBoard.tsx`
Run: `sed -n '880,980p' frontend/src/pages/KanbanBoard.tsx`

Understand where worktree config dropdown lives and how the modal is structured.

- [ ] **Step 2: Add state for remote hosts and sync UI**

Near the existing worktree-related state in `KanbanBoard.tsx`:

```typescript
const [remoteHosts, setRemoteHosts] = useState<RemoteHost[]>([]);
const [syncModalOpen, setSyncModalOpen] = useState(false);
const [syncHostId, setSyncHostId] = useState<string | null>(null);
const [syncPassword, setSyncPassword] = useState('');
const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
const [syncLoading, setSyncLoading] = useState(false);
```

Add a `loadRemoteHosts` function and call it from the same `useEffect` that loads other data:

```typescript
const loadRemoteHosts = async () => {
  try {
    const data = await remoteHostApi.list();
    setRemoteHosts(data);
  } catch (err) {
    console.error('Failed to load remote hosts', err);
  }
};
```

- [ ] **Step 3: Add Remote Host dropdown to task editor**

Find the section where worktree config dropdown is rendered (search for `worktree_config_id` or similar in the task detail editor). Add a parallel dropdown for remote host:

```tsx
<div className="space-y-1">
  <label className="text-sm font-medium text-gray-700">Remote Host (for sync)</label>
  <select
    value={editingTask.remote_host_id || ''}
    onChange={(e) => setEditingTask({
      ...editingTask,
      remote_host_id: e.target.value || null,
    })}
    className="w-full px-3 py-2 border rounded-md"
  >
    <option value="">No default host</option>
    {remoteHosts.map(h => (
      <option key={h.id} value={h.id}>{h.name} ({h.ssh_user}@{h.ssh_host})</option>
    ))}
  </select>
</div>
```

- [ ] **Step 4: Add "Sync to Remote" button**

In the worktree section of the task detail modal (near where "Open worktree" button is), add a sync button:

```tsx
{editingTask.worktree?.status === 'active' && (
  <button
    onClick={() => {
      setSyncHostId(editingTask.remote_host_id || (remoteHosts[0]?.id ?? null));
      setSyncPassword('');
      setSyncResult(null);
      setSyncModalOpen(true);
    }}
    className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700"
  >
    Sync to Remote
  </button>
)}
```

- [ ] **Step 5: Implement the sync modal**

Add a conditional render block (either as a separate inline section or a true modal overlay). Inline panel approach:

```tsx
{syncModalOpen && (
  <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
      <h3 className="text-lg font-semibold mb-4">Sync worktree to remote host</h3>

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium block mb-1">Host</label>
          <select
            value={syncHostId || ''}
            onChange={(e) => setSyncHostId(e.target.value || null)}
            className="w-full px-3 py-2 border rounded-md"
          >
            <option value="">Select a host…</option>
            {remoteHosts.map(h => (
              <option key={h.id} value={h.id}>
                {h.name} — {h.ssh_user}@{h.ssh_host}:{h.ssh_port}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">
            Password <span className="text-gray-400 font-normal">(leave empty to use SSH key)</span>
          </label>
          <input
            type="password"
            value={syncPassword}
            onChange={(e) => setSyncPassword(e.target.value)}
            placeholder="Optional — uses sshpass if provided"
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>

        {syncResult && (
          <div className={`p-3 rounded-md text-sm font-mono whitespace-pre-wrap ${
            syncResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}>
            <div className="font-sans font-medium mb-2">
              {syncResult.success ? '✓ Sync succeeded' : `✗ Sync failed (exit ${syncResult.exit_code})`}
            </div>
            <div className="mb-1 text-xs text-gray-600">Destination: {syncResult.dest_path}</div>
            {syncResult.stdout && <div className="mb-2">stdout:\n{syncResult.stdout}</div>}
            {syncResult.stderr && <div>stderr:\n{syncResult.stderr}</div>}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 mt-6">
        <button
          onClick={() => setSyncModalOpen(false)}
          className="px-4 py-2 text-sm bg-gray-100 rounded-md hover:bg-gray-200"
        >
          Close
        </button>
        <button
          disabled={!syncHostId || syncLoading}
          onClick={async () => {
            setSyncLoading(true);
            setSyncResult(null);
            try {
              const result = await syncTask(editingTask.id, {
                host_id: syncHostId || undefined,
                password: syncPassword || undefined,
              });
              setSyncResult(result);
            } catch (err: any) {
              setSyncResult({
                success: false,
                stdout: '',
                stderr: err.response?.data?.detail || err.message,
                exit_code: -1,
                command: '',
                dest_path: '',
                host_name: '',
              });
            } finally {
              setSyncLoading(false);
            }
          }}
          className="px-4 py-2 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
        >
          {syncLoading ? 'Syncing…' : 'Sync'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Persist `remote_host_id` on task save**

Find the existing save handler for the task editor. Make sure `remote_host_id` is included in the PUT request body. If the existing code does `await updateTask(editingTask.id, editingTask)` it already works; otherwise add `remote_host_id: editingTask.remote_host_id` to the request payload.

- [ ] **Step 7: Test manually**

Run: `cd frontend && npm run dev`

1. Open a project board.
2. Click on a task to open the editor.
3. Verify "Remote Host" dropdown appears and shows hosts from Settings.
4. Select a host, click save, reload — verify selection persists.
5. Create a worktree for the task.
6. Click "Sync to Remote" — modal opens.
7. Pick a host, leave password empty, click Sync.
8. If SSH key not configured, expect error in red; if configured, expect success.
9. Try with password (if sshpass installed on server).
10. Task with no worktree: Sync button should not appear.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/KanbanBoard.tsx
git commit -m "feat: add remote host selector and sync modal to task detail"
```

---

## Task 10: CreateTaskModal — optional remote host dropdown

**Files:**
- Modify: `frontend/src/components/CreateTaskModal.tsx`

**Interfaces:**
- Consumes: `remoteHostApi`, `RemoteHost` type.
- Produces: optional dropdown so user can set `remote_host_id` at task creation time (parallel to existing `worktree_config_id` selector).

- [ ] **Step 1: Read existing CreateTaskModal structure**

Run: `grep -n "worktree_config_id\|WorktreeConfig\|remoteHost" frontend/src/components/CreateTaskModal.tsx`

Find where the worktree config dropdown lives.

- [ ] **Step 2: Add RemoteHost state and load**

In `CreateTaskModal.tsx`, add:

```typescript
const [remoteHosts, setRemoteHosts] = useState<RemoteHost[]>([]);
const [remoteHostId, setRemoteHostId] = useState<string | null>(null);

useEffect(() => {
  remoteHostApi.list().then(setRemoteHosts).catch(console.error);
}, []);
```

- [ ] **Step 3: Add dropdown UI**

Place it next to the existing worktree config dropdown:

```tsx
<div className="space-y-1">
  <label className="text-sm font-medium text-gray-700">Remote Host (optional)</label>
  <select
    value={remoteHostId || ''}
    onChange={(e) => setRemoteHostId(e.target.value || null)}
    className="w-full px-3 py-2 border rounded-md"
  >
    <option value="">None</option>
    {remoteHosts.map(h => (
      <option key={h.id} value={h.id}>{h.name} ({h.ssh_user}@{h.ssh_host})</option>
    ))}
  </select>
</div>
```

- [ ] **Step 4: Include in submit payload**

In the submit handler that calls `createTask`, add `remote_host_id: remoteHostId` to the request body.

- [ ] **Step 5: Test manually**

Run: `cd frontend && npm run dev`

Open Create Task modal, verify dropdown shows hosts, create task with host selected, open task in detail view — verify the host is preselected.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/CreateTaskModal.tsx
git commit -m "feat: add optional remote host selector to CreateTaskModal"
```

---

## Task 11: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read current CLAUDE.md to find the right insertion point**

Run: `cat CLAUDE.md | grep -n "^##"` to find section headings.

- [ ] **Step 2: Add a new "Remote Sync" section**

After the existing "Task Execution" mention (in the "Key Backend Patterns" section) and after "Services & Integration", add a new section:

```markdown
### Remote Sync (rsync)

Tasks with a worktree can sync their files to a remote host via `POST /tasks/{id}/sync`:

- Hosts are managed in `RemoteHost` (Settings → Remote Hosts tab) with `ssh_user`, `ssh_host`, `ssh_port`, and a `base_path_template` supporting `{task_title_slug}`, `{ssh_user}`, `{ssh_host}`, `{branch_name}`, etc. (same variables as `expand_template`).
- Auth uses SSH keys by default. If the user supplies a password in the sync request, the backend wraps rsync with `sshpass -e` (reads password from `SSHPASS` env var on the subprocess only).
- **No passwords are ever stored in the DB** — they exist only in the request body and the subprocess env.
- Fixed rsync flags: `-avz --delete` with excludes for `.git/`, `node_modules/`, `__pycache__/`, `*.pyc`, `.venv/`, `dist/`, `build/`, `.DS_Store`.
- Server dependencies: `rsync` (required) and `sshpass` (only if password auth is used). Install with `apt install rsync sshpass` on Debian/Ubuntu.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Remote Sync section to CLAUDE.md"
```

---

## Self-Review (already performed)

- **Spec coverage**: All seven design decisions from the spec's Key Design Decisions table map to tasks:
  - Credential storage → Task 4 (`run_sync` SSH-key vs sshpass paths)
  - Host cardinality → Task 5 (`remote_host_id` FK)
  - Destination path templating → Tasks 3 + 4 (expand_template + expand_path_template)
  - rsync options → Task 4 (DEFAULT_EXCLUDES, --delete)
  - Trigger UI → Task 9 (sync modal)
  - Subprocess argv list → Task 4 (`build_rsync_command` returns list)
  - sshpass env var → Task 4 (sets `SSHPASS` on subprocess env only)
- **Placeholder scan**: No "TODO", "TBD", or vague references. All code blocks show actual implementation.
- **Type consistency**: `SyncResponse` (backend) ↔ `SyncResult` (frontend, matches existing pattern where backend `*Response` ↔ frontend non-suffixed type). `RemoteHostBrief` (backend) ↔ `RemoteHostBrief` (frontend). `remote_host_id` field name consistent across all layers.
- **Edge cases covered**: sshpass missing, rsync missing, timeout, task without worktree, host not found, password leak prevention.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-22-rsync-deploy.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
