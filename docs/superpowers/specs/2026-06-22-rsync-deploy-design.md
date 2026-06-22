# Remote Sync (rsync) Feature Design

**Date**: 2026-06-22
**Status**: Draft — awaiting user review
**Author**: brainstorming session with user

## Summary

Add the ability to push a task's worktree contents to a remote host via `rsync -avz`. Remote hosts are managed in a new Settings tab; each task optionally references one host as its default. Authentication uses SSH keys by default with an optional per-run password fallback (via `sshpass`) — **no passwords are ever stored in the database**.

## Motivation

The kanban app already creates per-task git worktrees (`feat/git-worktree-integration` branch). Once development work is isolated in a worktree, the natural next step is to deploy or mirror those files to a remote environment for testing, staging, or sharing. This feature closes that loop.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Credential storage | SSH keys primary + `sshpass` per-run fallback; **no password in DB** | User direction (combine approaches 3+4). Avoids SQLite storing secrets in plaintext. |
| Host cardinality | Many shared hosts; each task picks one via `remote_host_id` | Mirrors existing `WorktreeConfig` pattern; supports reuse across tasks. |
| Destination path | Host has `base_path_template`; task fills in vars | Mirrors `WorktreeConfig.dir_template`. Per-task uniqueness without per-task config. |
| rsync options | Fixed defaults: `-avz --delete` + common excludes | User chose "fixed sensible defaults" — simpler UX. |
| Trigger UI | Button in task detail modal (opens sync sub-modal) | User chose; mirrors worktree/execute action placement. |
| rsync invocation | `subprocess.run(argv_list)` (never `shell=True`) | Security — prevents shell injection from task titles/branches. |
| Password transmission | `sshpass -e` with `SSHPASS` env var on subprocess only | Avoids `-p` leaking via `/proc/<pid>/cmdline`. |

## Architecture

Follows the existing `WorktreeConfig` / `ExecutionConfig` pattern exactly:

```
backend/app/
  models/remote_host.py              NEW — SQLAlchemy model
  models/task.py                     MODIFY — add remote_host_id FK + relationship
  schemas/remote_host.py             NEW — Pydantic Create/Update/Response + SyncRequest/SyncResponse
  routers/remote_hosts.py            NEW — CRUD endpoints
  routers/tasks.py                   MODIFY — add POST /tasks/{id}/sync
  services/remote_sync_service.py    NEW — template expansion + rsync runner
  services/activity_service.py       REUSE — log sync attempts
  database.py                        MODIFY — add RemoteHost to ensure_schema()
  main.py                            MODIFY — register remote_hosts router

frontend/src/
  types/index.ts                     MODIFY — RemoteHost, RemoteHostCreate, SyncRequest, SyncResult
  services/api.ts                    MODIFY — CRUD + syncTaskToRemote
  pages/SettingsPage.tsx             MODIFY — add "Remote Hosts" tab
  pages/KanbanBoard.tsx              MODIFY — task detail modal lives inline here (around the
                                       existing worktree section, lines 469 / 895+); add remote
                                       host dropdown + "Sync to Remote" button + SyncModal section
  components/CreateTaskModal.tsx     MODIFY — add remote host dropdown (optional, at creation time)
```

Note: The task detail editor is **not** a separate component — it's inline JSX inside `KanbanBoard.tsx` using local `editingTask` state. The new remote-host selector and sync button should be added next to the existing worktree UI in that same file.

## Data Model

### `RemoteHost` (new table)

```python
class RemoteHost(Base):
    __tablename__ = "remote_hosts"

    id:                 Mapped[str]            # uuid, PK
    name:               Mapped[str]            # max 200, e.g. "dev-server"
    description:        Mapped[str | None]     # Text, nullable
    ssh_user:           Mapped[str]            # max 100
    ssh_host:           Mapped[str]            # max 255 (IP or hostname)
    ssh_port:           Mapped[int]            # default 22
    base_path_template: Mapped[str]            # max 500, e.g. "/home/{ssh_user}/deploy/{task_slug}"

    created_at:         Mapped[datetime]
    updated_at:         Mapped[datetime]
```

**No password column is ever added.** Passwords are runtime-only, passed in the request body when the user triggers a sync.

### Task changes

Add to `Task`:
```python
remote_host_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("remote_hosts.id"), nullable=True)
remote_host:    Mapped["RemoteHost"]  = relationship(lazy="joined")
```

This is the task's *default* host. The sync modal may override it per-run.

## Template Variables

`base_path_template` is expanded using the existing `expand_template` helper from `worktree_service.py`. The existing helper already supports a useful set of variables, and we extend it minimally to support host variables.

**Currently supported** (no change needed for these):
| Variable | Source | Example |
|----------|--------|---------|
| `{task_id}` | task.id | `abc-123-...` |
| `{task_id_short}` | task.id[:8] | `abc-123` |
| `{task_title}` | task.title | `Fix login bug` |
| `{task_title_slug}` | slugify(task.title) | `fix-login-bug` |
| `{task_type}` | task.task_type | `task` |
| `{task_priority}` | task.priority | `high` |
| `{task_assignee}` | task.assignee | `alice` |
| `{project_id}` | task.project.id | `...` |
| `{project_name}` | task.project.name | `Kanban` |
| `{branch_name}` | worktree.branch (only if passed in) | `fix-login-bug` |

**To add** as part of this feature (extend `expand_template` to accept optional `extra_vars: dict[str, str] | None = None` so existing callers are unaffected):
| Variable | Source | Example |
|----------|--------|---------|
| `{project_slug}` | slugify(project.name) — add to base vars since it's generally useful | `kanban` |
| `{ssh_user}` | host.ssh_user (passed in via extra_vars by remote_sync_service) | `ubuntu` |
| `{ssh_host}` | host.ssh_host (passed in via extra_vars) | `10.0.0.5` |

**Recommended template for users**: `/home/{ssh_user}/deploy/{task_title_slug}` — simple, no collisions across tasks.

Slug rules (already implemented in `worktree_service.expand_template`): `re.sub(r'[^a-zA-Z0-9]+', '-', title).strip('-').lower()[:60]`.

**Why extend rather than fork**: `expand_template` is already called from three places (`_do_create_worktree`, `create_task`, `update_task`). Forking would create drift. Adding an optional `extra_vars` parameter is backwards-compatible and lets the remote-sync flow inject host-specific context without polluting the base helper.

## API Endpoints

### CRUD — `/api/v1/remote-hosts` (mirrors `worktree_configs.py`)

```
GET    /remote-hosts                 → list all (newest first)
POST   /remote-hosts                 → create; 201
GET    /remote-hosts/{id}            → get one; 404 if missing
PUT    /remote-hosts/{id}            → update; 404 if missing
DELETE /remote-hosts/{id}            → delete; 204; 404 if missing
```

Schemas:
- `RemoteHostCreate`: name, ssh_user, ssh_host, ssh_port?, base_path_template, description?
- `RemoteHostUpdate`: all fields optional
- `RemoteHostResponse`: all fields + timestamps, `from_attributes=True`

### Sync — `POST /api/v1/tasks/{task_id}/sync`

Request body:
```json
{
  "host_id": "uuid",       // optional; defaults to task.remote_host_id
  "password": "..."        // optional; omit to use SSH key
}
```

Response body (always 200 unless task/host missing):
```json
{
  "success": true,
  "stdout": "...",
  "stderr": "...",
  "exit_code": 0,
  "command": "rsync -avz --delete ... user@host:path",  // masked if password used
  "dest_path": "/home/ubuntu/deploy/fix-login-bug",
  "host_name": "dev-server"
}
```

Error conditions:
- Task not found → 404
- Task has no worktree → 400 `"Task has no worktree. Create one first."`
- Worktree status != active → 400 `"Worktree is not active"`
- No host resolvable (neither host_id nor task.remote_host_id) → 400 `"No remote host configured for task"`
- Host not found → 404
- `rsync` binary missing on server → 500 with install hint
- `sshpass` missing when password provided → 500 with install hint
- rsync exits non-zero → 200 with `success=false` + stderr (mirrors `/execute` pattern)

## Service Layer — `remote_sync_service.py`

```python
def expand_path_template(template: str, task, host, branch: str | None = None) -> str:
    """Delegates to worktree_service.expand_template with extra_vars={"{ssh_user}": ..., "{ssh_host}": ...}"""

def build_rsync_command(src_path: str, host: RemoteHost, dest_path: str, *, use_password: bool) -> list[str]:
    """Returns argv list. When use_password=True, omits BatchMode=yes and the caller prepends sshpass -e."""

def run_sync(src_path: str, host: RemoteHost, dest_path: str, password: str | None = None) -> dict:
    """Wraps subprocess.run. If password is set, builds env copy with SSHPASS set."""
```

### `build_rsync_command` — the argv produced

The SSH options differ between modes. **Critical**: `BatchMode=yes` disables password prompts in SSH, which would prevent sshpass from working. So password mode must omit `BatchMode`.

**SSH-key mode** (no password provided):
```
rsync -avz --delete \
  -e "ssh -p {port} -o StrictHostKeyChecking=accept-new -o BatchMode=yes" \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='.venv/' \
  --exclude='dist/' \
  --exclude='build/' \
  --exclude='.DS_Store' \
  {src_path}/ \
  {ssh_user}@{ssh_host}:{dest_path}/
```

**Password mode** (password provided → sshpass wraps rsync):
```
sshpass -e rsync -avz --delete \
  -e "ssh -p {port} -o StrictHostKeyChecking=accept-new" \
  <same excludes as above> \
  {src_path}/ \
  {ssh_user}@{ssh_host}:{dest_path}/
```

`sshpass -e` reads password from `SSHPASS` env var. We set this ONLY on the subprocess's environment (copied from parent, then add/then remove). It never propagates back to the parent process.

Notes:
- `BatchMode=yes` in SSH-key mode ensures it fails fast instead of hanging on a password prompt if keys aren't set up. **Must be omitted in password mode** — otherwise sshpass can't intercept the prompt.
- `StrictHostKeyChecking=accept-new` auto-accepts first connection (convenience) but fails on fingerprint change (security — MITM detection).
- Trailing `/` on both source and dest — rsync semantics: copy *contents*, not the dir itself.
- `subprocess.run(argv_list, capture_output=True, text=True, timeout=300)` — 5-minute timeout (rsync over slow links). Never `shell=True`. Configurable later if needed.

### Activity log

Each sync writes to `activity_log`:
- `event_type="task.synced"`
- `entity_type="task"`, `entity_id=task.id`, `entity_name=task.title`
- `detail="Synced to {host.name} ({ssh_user}@{ssh_host}:{dest_path})"`
- `extra_data={"success": bool, "exit_code": int, "using_password": bool}`

**Never log the password.**

## Frontend

### Types (`types/index.ts`)

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

Add `remote_host_id?: string | null` to `Task` interface and `TaskCreate`.

### API client (`services/api.ts`)

```typescript
export const remoteHostApi = {
  list: () => api.get<RemoteHost[]>('/remote-hosts').then(r => r.data),
  create: (data: RemoteHostCreate) => api.post<RemoteHost>('/remote-hosts', data).then(r => r.data),
  update: (id: string, data: Partial<RemoteHostCreate>) => api.put<RemoteHost>(`/remote-hosts/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/remote-hosts/${id}`),
};

export const syncTask = (taskId: string, body: SyncRequest) =>
  api.post<SyncResult>(`/tasks/${taskId}/sync`, body).then(r => r.data);
```

### SettingsPage — new "Remote Hosts" tab

Same form-based CRUD UI as existing Worktree tab. Fields:
- Name (required)
- Description
- SSH User (required)
- SSH Host (required)
- SSH Port (default 22)
- Base Path Template (required, with placeholder hint and live var reference)

List shows: name, `user@host:port`, template, edit/delete buttons.

### Task detail modal — new sync UI (inline in `KanbanBoard.tsx`)

Two additions to the existing inline task detail editor (around lines 469 / 895+ next to the worktree UI):
1. **Remote Host dropdown** (next to existing Worktree Config selector) — optional, sets task's default host on save
2. **"Sync to Remote" button** in the action row — disabled if no worktree exists. Clicking reveals an inline sync panel (or small modal) with:
   - Resolved destination preview: `{ssh_user}@{ssh_host}:{expanded_path}` (computed client-side for preview; server is source of truth)
   - Optional password input with helper text: *"Leave empty to use SSH key authentication"*
   - "Sync" button → calls `syncTask` → shows `<pre>` with stdout/stderr + success/fail badge
   - Loading state while sync runs (rsync may take seconds to minutes for large worktrees)

## Security Considerations

1. **No password storage**: Storing SSH passwords in SQLite (which lives at `backend/data/kanban.db`) would expose them to anyone with read access to the file. This design avoids that entirely.
2. **Subprocess argv list**: Using `subprocess.run(["rsync", ...])` not `shell=True` prevents shell injection from task titles, branch names, or host fields containing shell metacharacters.
3. **sshpass env var**: `sshpass -e` reads password from `SSHPASS` env var. We set this ONLY on the subprocess's environment (copied from parent, then add/then remove). It never propagates back. Avoids `-p <password>` leaking via `/proc/<pid>/cmdline`.
4. **HostKeyChecking**: `accept-new` auto-trusts first connection (convenient for fresh hosts). Still fails on fingerprint change (MITM protection). Users who want strict mode can configure their `~/.ssh/known_hosts` manually.
5. **Logging discipline**: Passwords never appear in stdout/stderr we capture, activity_log, or error responses. If rsync itself somehow echoes the password (it shouldn't), we should add a sanitization pass on stderr before returning to the client. *Implementation note: verify during testing.*
6. **Input validation**: Pydantic schemas enforce max lengths. `ssh_port` validated to 1-65535. `ssh_host` validated to a reasonable pattern (IP or hostname).

## Dependencies

The backend host (where this kanban app runs) needs:
- `rsync` (standard on most Linux/macOS, may need `apt install rsync`)
- `sshpass` ONLY if password fallback is used (optional; the endpoint gracefully errors if user provides password but sshpass is missing)
- `ssh` client (standard)

Add to setup docs.

## Auto-Migration

In `ensure_schema()` (`backend/app/database.py`):
1. `Base.metadata.create_all()` will pick up the new `RemoteHost` table automatically for fresh DBs.
2. For existing DBs, add explicit check: if `remote_hosts` table missing → create it. If `tasks.remote_host_id` column missing → `ALTER TABLE tasks ADD COLUMN remote_host_id VARCHAR(36) REFERENCES remote_hosts(id)`.

Follow the existing `PRAGMA table_info` check pattern used for other recent additions.

## Testing

### Backend (`backend/tests/`)

- `test_remote_hosts.py` — new file
  - CRUD happy path (create, list, get, update, delete)
  - 404 on missing host
  - Pydantic validation (required fields, port range)
- `test_remote_sync.py` — new file
  - Service unit tests (mock `subprocess.run`):
    - `expand_path_template` — all variables, edge cases (empty title, special chars)
    - `build_rsync_command` — correct argv order, includes all required excludes
    - `run_sync` success → returns dict with `success=True`
    - `run_sync` failure → returns dict with `success=False`, exit_code, stderr
    - Password-provided path → command prefixed with `sshpass -e`, env has `SSHPASS`
    - Password-omitted path → `BatchMode=yes` in SSH opts, no sshpass
  - API tests:
    - `POST /tasks/{id}/sync` happy path (mock service) → 200, SyncResult shape
    - Task has no worktree → 400
    - Worktree not active → 400
    - No host configured (no host_id, no task.remote_host_id) → 400
    - Host not found → 404
    - Activity log entry written
  - **Security test**: assert password is not in any activity_log row, not in command output, not echoed in stderr

### Frontend

Manual testing checklist:
- Create/edit/delete a RemoteHost in Settings → reflects in list
- Task with worktree: select remote host, save, reload, verify selection persists
- Click "Sync to Remote" without password → success (assuming SSH key set up)
- Click "Sync to Remote" with password → success via sshpass
- Task with no worktree → "Sync" button disabled with tooltip
- rsync failure → error message shown in modal, no crash
- Large worktree → loading spinner during sync, no UI freeze

## Documentation Updates

- `CLAUDE.md`: new section under Architecture describing the Remote Sync feature, install hints for rsync/sshpass, the fixed defaults, and the security model (no password storage).
- SettingsPage: inline help text in the Remote Hosts tab explaining template variables and SSH key vs password mode.

## Out of Scope (YAGNI)

- Multiple hosts per task (one-to-many sync). Can be added later as a join table.
- Scheduled / automatic sync (e.g. on status change to "done"). Manual trigger only for now.
- Pull (download from remote). Push only.
- Bandwidth limiting (`--bwlimit`). Use default for now.
- Per-host rsync options / excludes. Fixed defaults for now — can add an "advanced" mode later if needed.
- SSH agent forwarding. Out of scope.
- Encrypted-at-rest password storage. The per-run prompt approach eliminates this need.

## Open Questions Resolved

- **Q**: Should rsync be triggered from TaskCard menu or task detail? **A**: Task detail (chosen).
- **Q**: Should password be cached per session? **A**: No — re-enter each time (user's stated preference for per-run entry).
- **Q**: What rsync timeout? **A**: 300s (5 min) default, configurable later.
- **Q**: Should we log full stdout/stderr in activity_log? **A**: No — just success/exit_code. Full output returned to UI for the immediate request only.
