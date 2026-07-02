# Task Notifications Feature Design

**Date**: 2026-07-02
**Status**: Draft — awaiting user review
**Author**: brainstorming session with user

## Summary

Add a notification system to kanban so that when work on a task is interrupted or completed — by either an agent tool (Claude Code, opencode) or by a kanban-internal task status transition — configured notification channels fire (desktop pop-up, webhook, sound, email). Each channel is independently configured and filtered by event type and project.

The agent-tool integration uses **worktree-scoped project-level Claude Code hooks**: when kanban creates a git worktree for a task, it writes a small `.claude/settings.json` into the worktree directory pointing at a stable kanban-owned forwarder script. This sidesteps the "which `settings.json` is active" problem entirely — project settings merge on top of any user-level or `--settings`-flag config, so hooks fire regardless of which model config the user is currently running.

## Motivation

The user runs Claude Code with multiple `--settings` variants (one per model config) and wants notifications whenever an agent finishes a turn or pauses for input — without having to maintain hook blocks in each settings variant. The same notification pipeline is also useful for kanban's own task lifecycle events (task moved to done/cancelled/review), giving one place to configure "tell me when something needs attention".

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger sources | Agent callbacks AND internal task transitions | User chose unified pipeline. One service, two event origins, same dispatch logic. |
| Channels v1 | desktop / webhook / sound / email | User chose "multiple options, user configures which". All four ship in v1. |
| Config model | Per-channel event + project filters | User chose flat per-channel filters over rule-based routing. Matches existing `ExecutionConfig` pattern. |
| Audit log | Persist every dispatch attempt (success/failure) | User chose. Enables "why didn't I get notified?" debugging. |
| Approach | Minimal receiver, no auth, no rate-limit | User chose A over B (with optional hardening) and C (rules). Smallest surface. |
| Hook integration mechanism | **Worktree-scoped project settings.json** auto-written at worktree creation | User proposed; verified project settings merge with `--settings` flag per docs. Avoids modifying user's settings.json variants entirely. |
| Forwarder script | One universal script per agent tool, kanban-owned at `~/.config/kanban/hooks/` | `hook_event_name` is already in Claude Code's stdin payload — one script forwards all events. Stable command path; only the settings.json reference is in user-controlled space. |
| Receiver payload | Accept both raw Claude Code stdin and explicit kanban-format | The receiver must work for Claude Code (which sends stdin JSON) AND for opencode / manual curl. `hook_event_name` field signals Claude Code payload. |
| Task binding | Auto-resolve via `cwd` → `Worktree.path` lookup | Claude Code always sends `cwd`. Since worktrees are task-scoped, this gives zero-config task routing. No `task_id` needed in the hook script. |
| Email credentials | Store `password_env` (env var name), never the password | Matches the existing `RemoteHost` SSH-password convention. DB dump leaks no secrets. |
| Channel send isolation | One channel failure does not stop others; every attempt logged | Reliability — a misconfigured webhook must not silence desktop notify. |
| Idempotent hook install | Command path is the identifier; merge into existing `.claude/settings.json` | Re-running worktree creation or hook refresh never duplicates entries; preserves any team-committed settings. |

## Architecture

```
┌─────────────────┐   stdin JSON    ┌────────────────────────────────┐
│  Claude Code    │ ──────────────> │  forwarder.sh (kanban-owned)   │
│  in worktree    │                 │  at ~/.config/kanban/hooks/    │
│  Stop hook etc. │                 │  → HTTP POST to kanban         │
└─────────────────┘                 └────────────────┬───────────────┘
                                                      │
                                                      ▼
                                    ┌────────────────────────────────┐
                                    │  Kanban FastAPI (9527)         │
                                    │  POST /api/v1/agent-events     │
                                    │  → NotificationService.ingest()│
                                    │                                │
                                    │  Internal: routers/tasks.py    │
                                    │  fires task.* events into same │
                                    │  ingest() pipeline             │
                                    └──────────────┬─────────────────┘
                                                   │
                                    ┌──────────────┼──────────────┐
                                    │              ▼              │
                                    │  NotificationDispatcher       │
                                    │  - match event+project       │
                                    │  - fan-out to channels       │
                                    │    (ThreadPool, 10s timeout) │
                                    │  - persist NotificationLog   │
                                    └──────────────┬───────────────┘
                                                   │
                              ┌────────────────────┼────────────────────┐
                              ▼                    ▼                    ▼
                     notify-send            HTTP POST            SMTP / paplay
                     (desktop)              (webhook)            (email / sound)
```

### Worktree hook flow

```
POST /tasks/{task_id}/worktree   (existing endpoint, modified)
    │
    ├── git worktree add <path>          (existing)
    ├── create Worktree row              (existing)
    ├── ensure_forwarder_script()        ← NEW: idempotent
    └── write_hooks_to_worktree(path)    ← NEW: merge into <path>/.claude/settings.json
```

```
DELETE /tasks/{task_id}/worktree   (existing endpoint, modified)
    │
    ├── remove_hooks_from_worktree(path)  ← NEW: drop entries pointing at forwarder
    ├── git worktree remove <path>        (existing)
    └── mark Worktree row removed         (existing)
```

## File Layout

```
backend/app/
  models/
    notification_channel.py         NEW — SQLAlchemy model
    notification_log.py             NEW — SQLAlchemy model
  schemas/
    notification_channel.py         NEW — Pydantic Create/Update/Response
    notification_log.py             NEW — Pydantic Response
    agent_event.py                  NEW — Pydantic for POST /agent-events body
  routers/
    notifications.py                NEW — channel CRUD + agent-events receiver + log list
  services/
    notification_service.py         NEW — ingest_event, dispatcher, ThreadPool
    worktree_hooks.py               NEW — write/remove hooks, ensure forwarder
    notification_senders/
      __init__.py                   NEW — sender registry
      desktop.py                    NEW — notify-send
      webhook.py                    NEW — requests.post
      sound.py                      NEW — paplay
      email.py                      NEW — smtplib
  models/__init__.py                MODIFY — export new models
  database.py                       MODIFY — register new tables in ensure_schema()
  main.py                           MODIFY — mount notifications router
  routers/worktrees.py              MODIFY — call write_hooks/remove_hooks in create/delete
  routers/tasks.py                  MODIFY — fire task.* events on relevant transitions

frontend/src/
  types/index.ts                    MODIFY — NotificationChannel, NotificationLog, AgentEvent types
  services/api.ts                   MODIFY — CRUD + agent-events + log list
  pages/SettingsPage.tsx            MODIFY — add "Notifications" tab
  components/
    SettingsNotificationsTab.tsx    NEW — channels list + editor + log
    NotificationChannelEditor.tsx   NEW — type-specific config form
    NotificationLogList.tsx         NEW — paginated audit log

backend/tests/
  test_notifications.py             NEW — ingest, dispatch, channels, filters, audit
  test_worktree_hooks.py            NEW — install/remove/idempotent
```

## Data Model

### `notification_channels` (new table)

```python
class NotificationChannel(Base):
    __tablename__ = "notification_channels"

    id:              Mapped[str]            # uuid36, PK
    name:            Mapped[str]            # max 200, e.g. "Desktop notify"
    channel_type:    Mapped[str]            # enum: "desktop"|"webhook"|"sound"|"email"
    config:          Mapped[dict]           # JSON, type-specific (see below)
    event_filters:   Mapped[list]           # JSON list[str], empty = all events
    project_filters: Mapped[list]           # JSON list[str] of project IDs, empty = all
    enabled:         Mapped[bool]           # default True

    created_at:      Mapped[datetime]
    updated_at:      Mapped[datetime]
    deleted_at:      Mapped[datetime|None]  # soft-delete
```

**`config` shape per channel type** (validated by Pydantic on write):

| type | config |
|---|---|
| `desktop` | `{"command": "notify-send"}` (optional; default `notify-send`) |
| `webhook` | `{"url": "...", "method": "POST", "headers": {...}, "body_template": "..."}` — placeholders `{event}`, `{title}`, `{detail}` (same style as `expand_template`) |
| `sound` | `{"file": "/usr/share/sounds/...", "command": "paplay"}` |
| `email` | `{"smtp_host": "...", "smtp_port": 587, "username": "...", "password_env": "KANBAN_SMTP_PASS", "from": "...", "to": ["..."], "use_tls": true}` |

**Passwords**: stored as `password_env` (the env var name), never the password itself. Dispatch reads `os.environ[password_env]`.

### `notification_logs` (new table)

```python
class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id:              Mapped[str]            # uuid36, PK
    channel_id:      Mapped[str|None]       # nullable for "no match" audit rows
    channel_name:    Mapped[str]            # max 200, denormalized snapshot
    event_type:      Mapped[str]            # max 50
    task_id:         Mapped[str|None]       # max 36
    project_id:      Mapped[str|None]       # max 36
    status:          Mapped[str]            # enum: "success"|"failure"
    detail:          Mapped[str]            # Text, success summary or error traceback
    http_status:     Mapped[int|None]       # webhook only
    duration_ms:     Mapped[int]
    created_at:      Mapped[datetime]       # indexed
```

`channel_name` is denormalized so renaming or soft-deleting a channel does not rewrite history.

## Receiver Endpoint

```
POST /api/v1/agent-events
Content-Type: application/json
```

Accepts two payload shapes; presence of `hook_event_name` selects the Claude Code interpretation.

**Shape 1 — raw Claude Code stdin** (just forward what Claude sent):
```json
{
  "hook_event_name": "Stop",
  "session_id": "abc...",
  "cwd": "/home/xuxin/kanban-worktrees/task-xyz",
  "transcript_path": "/home/xuxin/.claude/projects/.../transcript.jsonl",
  "last_assistant_message": "..."
}
```

**Shape 2 — explicit kanban-format** (manual curl, opencode adapter):
```json
{
  "event_type": "agent.stop",
  "task_id": "abc-123",
  "agent": "opencode",
  "message": "..."
}
```

**Resolution rules**:
- If `hook_event_name` present: `event_type = payload["hook_event_name"]`, `agent = "claude-code"` (unless overridden).
- Otherwise use `event_type` from body.
- `task_id`: from body if present; else resolve via `Worktree.path == cwd` lookup.
- `project_id`: from body if present; else from resolved task.

**Response**: `202 Accepted` with `{"matched_channels": N, "dispatched": N, "failed": N, "log_ids": [...]}`. Always 202 for valid requests even with zero matches.

**Validation**:
- `event_type` must be non-empty string. Unknown → 400.
- If `task_id` is provided and doesn't exist → 400 (catches snippet typos early).

## Event Vocabulary

| `event_type` | origin | meaning |
|---|---|---|
| `Stop` | Claude Code `Stop` hook | agent finished a turn, awaiting user input |
| `Notification` | Claude Code `Notification` hook | agent needs user input (permission prompt, idle) |
| `SubagentStop` | Claude Code `SubagentStop` hook | a subagent finished |
| `SessionEnd` | Claude Code `SessionEnd` hook | session fully ended |
| `task.done` | internal, `routers/tasks.py` | task moved into `done` |
| `task.complete` | internal | task moved into `complete` |
| `task.cancelled` | internal | task moved into `cancelled` |
| `task.review` | internal | task moved into `review` |

Event types are stored and matched as opaque strings — no normalization layer. Users configure channel filters using these exact names. Future Claude Code events require no schema change.

## Forwarder Script

`~/.config/kanban/hooks/claude-code-forwarder.sh`:

```bash
#!/usr/bin/env bash
# Generated by kanban. Forwards Claude Code hook stdin to kanban.
# To reconfigure, edit kanban Settings UI — do not edit this file.
input=$(cat)
curl -s -X POST http://localhost:9527/api/v1/agent-events \
  -H 'Content-Type: application/json' \
  --data-binary "$input" \
  >/dev/null 2>&1 & disown
exit 0
```

Properties:
- Reads stdin once, forwards verbatim.
- `& disown`: fire-and-forget; Claude Code never waits on the network.
- Always `exit 0`: never blocks Claude Code (`Stop` hook exit 2 would prevent Claude from stopping).
- URL/port sourced from server config at generation time.

`ensure_forwarder_script()` is called on every worktree creation; rewrites only if missing or kanban port changed.

## Worktree Hook Writer

`backend/app/services/worktree_hooks.py`:

```python
HOOK_EVENTS = ("Stop", "Notification", "SubagentStop", "SessionEnd")
FORWARDER_PATH = "~/.config/kanban/hooks/claude-code-forwarder.sh"

def ensure_forwarder_script() -> Path: ...
def write_hooks_to_worktree(worktree_path: str) -> dict: ...
def remove_hooks_from_worktree(worktree_path: str) -> dict: ...
```

**Install algorithm** (idempotent, command-path identified):

```
write_hooks_to_worktree(path):
    1. settings = Path(path) / ".claude" / "settings.json"
    2. mkdir parent if missing
    3. data = json.loads(settings.read_text()) if exists else {}
    4. hooks = data.setdefault("hooks", {})
    5. for event in HOOK_EVENTS:
         entries = hooks.setdefault(event, [])
         # find any entry whose .hooks[].command ends with "claude-code-forwarder.sh"
         # if found: replace with new entry (path may have changed)
         # if not: append new entry
    6. tmp = settings.with_suffix(".json.tmp"); tmp.write_text(json.dumps(data, indent=2))
    7. tmp.replace(settings)  # atomic
    8. return {"installed": [...], "unchanged": [...]}
```

**Removal algorithm**: drop all entries pointing at the forwarder path; if `hooks` ends up empty, remove the `hooks` key; if the file ends up `{}` or empty, delete the file. Never touch user's own entries.

The same idempotency rule makes re-running worktree creation safe (no duplicate entries).

## Dispatch Service

`backend/app/services/notification_service.py`:

```python
def ingest_event(
    db: Session,
    event_type: str,
    task_id: str | None = None,
    project_id: str | None = None,
    agent: str | None = None,
    payload: dict | None = None,
    message: str | None = None,
) -> dict:
    """
    Single entry point for all events.
    1. Resolve task_id / project_id (from each other or via cwd→Worktree).
    2. Query enabled NotificationChannels whose filters match.
    3. Dispatch each in ThreadPool; persist NotificationLog per attempt.
    4. Return summary.
    """
```

- 4-worker `ThreadPoolExecutor` shared across requests.
- Each sender has a 10-second timeout.
- Failures caught per-channel; logged; do not propagate.
- One `NotificationLog` row per dispatch attempt.

**Internal task events**: one-line addition in `routers/tasks.py` `update_task_status` handler:

```python
if new_status in {"done", "complete", "cancelled", "review"}:
    notification_service.ingest_event(
        db, event_type=f"task.{new_status}",
        task_id=task.id, project_id=task.project_id,
    )
```

## Channel Senders

Each sender is a small function in `backend/app/services/notification_senders/<type>.py` with signature `send(channel, event) -> dict`. Routed via a registry dict in the dispatcher.

- **desktop**: `subprocess.run([cmd, title, body], timeout=5, check=True)`.
- **webhook**: `requests.post(url, json=..., headers=..., timeout=10)`. Body template rendered via existing `expand_template`.
- **sound**: `subprocess.run([cmd, file], timeout=5, check=True)`.
- **email**: `smtplib.SMTP(host, port, timeout=10)`; reads password from `os.environ[channel.config["password_env"]]`.

All use `check=True` / exception-on-error so the dispatcher catches a single `Exception` type per attempt.

## API Surface

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/api/v1/notification-channels` | list enabled + soft-deleted excluded |
| `POST`  | `/api/v1/notification-channels` | create |
| `GET`   | `/api/v1/notification-channels/{id}` | read |
| `PUT`   | `/api/v1/notification-channels/{id}` | update |
| `DELETE` | `/api/v1/notification-channels/{id}` | soft-delete |
| `POST`  | `/api/v1/notification-channels/{id}/test` | dispatch a synthetic event to this channel only |
| `POST`  | `/api/v1/agent-events` | receiver endpoint (agent + manual) |
| `GET`   | `/api/v1/notification-logs?limit=100` | audit log (paginated) |
| `GET`   | `/api/v1/notification-logs?channel_id=...` | filter by channel |

No new endpoints for worktree hooks — they're written transparently during worktree create/delete. A read-only `GET /api/v1/worktrees/{id}/hooks-status` could be added later if debugging is needed.

## Frontend

### Settings → Notifications tab

```
Settings → "Notifications" tab
├── Channels
│   ├── [+ New channel]
│   └── Per channel row:
│       [name] [type badge] [enabled toggle] [Test] [edit] [delete]
├── Audit log (latest 100, expandable)
│   └── [channel] [event_type] [task link] [status] [duration] [time]
└── Agent Hooks (read-only info card)
    └── "Hooks are auto-installed into each worktree's .claude/settings.json"
        [Show forwarder content] [Regenerate forwarder]
```

The "Test" button calls `/notification-channels/{id}/test` with a synthetic event — channel row appears in the audit log within the same UI session.

### Components

- `SettingsNotificationsTab.tsx` — main container.
- `NotificationChannelEditor.tsx` — modal form with type-specific config fields.
- `NotificationLogList.tsx` — paginated, expandable rows.

### Types added to `frontend/src/types/index.ts`

```typescript
export type NotificationChannelType = "desktop" | "webhook" | "sound" | "email";

export interface NotificationChannel {
  id: string;
  name: string;
  channel_type: NotificationChannelType;
  config: Record<string, unknown>;
  event_filters: string[];
  project_filters: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationLog {
  id: string;
  channel_id: string | null;
  channel_name: string;
  event_type: string;
  task_id: string | null;
  project_id: string | null;
  status: "success" | "failure";
  detail: string;
  http_status: number | null;
  duration_ms: number;
  created_at: string;
}
```

## Testing

### Backend (`backend/tests/test_notifications.py`)

- `test_ingest_no_matching_channel_returns_zero`
- `test_ingest_dispatches_to_matching_channels_only` (event + project filters)
- `test_ingest_continues_after_channel_failure` (one webhook down doesn't block desktop)
- `test_ingest_logs_success_and_failure_rows`
- `test_event_filters_empty_matches_all`
- `test_project_filters_empty_matches_all`
- `test_task_id_provided_in_body_resolves_project`
- `test_worktree_cwd_resolves_task` (payload has only `cwd`; verify task/project auto-bound)
- `test_unknown_event_type_returns_400`
- `test_unknown_task_id_returns_400`
- `test_internal_task_done_transition_fires_event`
- `test_channel_test_endpoint_dispatches_one_event`

### Channel senders (`test_notification_senders.py`)

- Mock `subprocess.run` for desktop + sound.
- Mock `requests.post` for webhook; assert URL/headers/body.
- Mock `smtplib.SMTP` context manager; assert login + send_message with `password_env` value.

### Worktree hooks (`test_worktree_hooks.py`)

- `test_write_hooks_creates_settings_file_when_missing`
- `test_write_hooks_merges_into_existing_settings_without_loss`
- `test_write_hooks_idempotent_on_rerun`
- `test_remove_hooks_drops_only_kanban_entries`
- `test_remove_hooks_deletes_empty_settings_file`
- `test_remove_hooks_preserves_file_with_user_entries`
- `test_ensure_forwarder_creates_if_missing`
- `test_ensure_forwarder_idempotent`
- `test_worktree_create_endpoint_writes_hooks` (integration with router)
- `test_worktree_delete_endpoint_removes_hooks` (integration with router)

## Out of Scope (Future Work)

- **Authentication on the receiver endpoint.** Approach A (minimal) is intentionally open. If kanban is ever exposed beyond localhost, add an optional bearer token via env var.
- **Rate limiting.** A misbehaving hook could flood channels. Defer until needed.
- **File-watch daemon.** A pure zero-config fallback that watches `~/.claude/projects/*/*.jsonl` and parses JSONL events. Could not catch `Notification` events (not in transcript); brittle to format changes. Documented as a future upgrade path.
- **Mac/Windows desktop commands.** v1 ships `notify-send` (Linux). `osascript` / `msg` can be added as channel config options without code change.
- **HTML email templates.** v1 sends plain text.
- **Per-channel quiet hours.** Defer until requested.
- **Notification pruning job.** v1 just exposes latest 100 in UI; manual DB cleanup otherwise.
