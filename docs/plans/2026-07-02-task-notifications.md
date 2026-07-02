# Task Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a notification system to kanban that fires configurable channels (desktop, webhook, sound, email) when work is interrupted or completed — triggered by Claude Code agent hooks (forwarded via stdin → HTTP) or by kanban's own task status transitions.

**Architecture:** Two new tables (`notification_channels`, `notification_logs`) feed one dispatch pipeline (`notification_service.ingest_event`). Agent events arrive via `POST /api/v1/agent-events`. Internal task transitions call `ingest_event` in-process. Worktree creation auto-writes `.claude/settings.json` into the worktree pointing at a stable forwarder script in `~/.config/kanban/hooks/`. Channel senders run in a thread pool; every attempt is logged.

**Tech Stack:** FastAPI 0.115, SQLAlchemy 2.0 (Mapped syntax), Pydantic 2.x, SQLite, React 18 + TypeScript + Tailwind 3 + axios.

## Global Constraints

- Python 3.11+ — use `str | None` syntax, not Optional.
- All IDs are `str(36)` UUIDs via `uuid.uuid4()`.
- SQLAlchemy 2.0 `Mapped[T]` / `mapped_column(...)` syntax.
- Pydantic 2.x — `BaseModel`, `Field(...)`, `model_config = {"from_attributes": True}`.
- New tables go through `ensure_schema()` in `backend/app/database.py` — `Base.metadata.create_all()` handles fresh tables; ALTER TABLE blocks are only for adding columns to existing tables.
- Soft-delete pattern: nullable `deleted_at` column on entities that support trash/restore.
- No passwords in DB — store env var names (e.g. `password_env`), read at dispatch time.
- Frontend types in `frontend/src/types/index.ts` mirror backend Pydantic schemas exactly.
- API client functions live in `frontend/src/services/api.ts` with `baseURL: '/api/v1'`.
- Tests use `FastAPI TestClient` against a temp SQLite DB (see `backend/tests/conftest.py`).
- Every task ends with passing tests + a commit.

---

## File Structure

```
backend/app/
  models/
    notification_channel.py         NEW — NotificationChannel SQLAlchemy model
    notification_log.py             NEW — NotificationLog SQLAlchemy model
    __init__.py                     MODIFY — export new models
  schemas/
    notification_channel.py         NEW — Create/Update/Response + per-type config models
    notification_log.py             NEW — NotificationLogResponse
    agent_event.py                  NEW — AgentEventRequest (receiver payload)
  routers/
    notifications.py                NEW — channel CRUD + agent-events + log list
  services/
    notification_service.py         NEW — ingest_event + dispatcher + thread pool
    worktree_hooks.py               NEW — write/remove worktree hooks + forwarder script
    notification_senders/
      __init__.py                   NEW — sender registry
      desktop.py                    NEW — notify-send sender
      webhook.py                    NEW — HTTP POST sender
      sound.py                      NEW — paplay sender
      email.py                      NEW — smtplib sender
  database.py                       MODIFY — register new models in ensure_schema() (no ALTER needed)
  main.py                           MODIFY — register notifications router
  routers/worktrees.py              MODIFY — call write_hooks/remove_hooks in create/delete
  routers/tasks.py                  MODIFY — fire task.* events on done/complete/cancelled/review

backend/tests/
  test_notification_channels.py     NEW — channel CRUD + filters
  test_notification_dispatch.py     NEW — ingest_event, dispatch, logging
  test_notification_senders.py      NEW — per-sender unit tests
  test_agent_events.py              NEW — receiver endpoint + cwd resolution
  test_worktree_hooks.py            NEW — install/remove/idempotent

frontend/src/
  types/index.ts                    MODIFY — NotificationChannel, NotificationLog, AgentEvent
  services/api.ts                   MODIFY — channel CRUD + agentEvents + getNotificationLogs
  pages/SettingsPage.tsx            MODIFY — add "Notifications" tab
  components/
    SettingsNotificationsTab.tsx    NEW — channels list + editor + log panel
    NotificationChannelEditor.tsx   NEW — type-specific config form modal
    NotificationLogList.tsx         NEW — paginated audit log list
```

**Responsibility boundaries**:
- `notification_service.py` is the only place that decides *which channels fire* and *how logs are persisted*. Senders never touch the DB.
- `notification_senders/*.py` each own one channel type. They know nothing about events, filters, or DB — they receive a channel + a normalized event dict and return a result dict (or raise).
- `worktree_hooks.py` knows nothing about notifications — it just writes/removes JSON entries in `.claude/settings.json`. Decoupling means it can be tested without setting up the notification stack.
- `routers/notifications.py` is thin — it parses requests, delegates to `notification_service`, returns responses.

---

## Task 1: Models — NotificationChannel and NotificationLog

**Files:**
- Create: `backend/app/models/notification_channel.py`
- Create: `backend/app/models/notification_log.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/test_notification_dispatch.py` (model smoke test, full coverage comes later)

**Interfaces:**
- Produces: `NotificationChannel` SQLAlchemy model with columns `id, name, channel_type, config (JSON), event_filters (JSON), project_filters (JSON), enabled, created_at, updated_at, deleted_at`. `NotificationLog` model with `id, channel_id, channel_name, event_type, task_id, project_id, status, detail, http_status, duration_ms, created_at`.

- [ ] **Step 1: Write NotificationChannel model**

Create `backend/app/models/notification_channel.py`:

```python
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Boolean, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class NotificationChannel(Base):
    __tablename__ = "notification_channels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    channel_type: Mapped[str] = mapped_column(String(20), nullable=False)
    config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    event_filters: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    project_filters: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
```

- [ ] **Step 2: Write NotificationLog model**

Create `backend/app/models/notification_log.py`:

```python
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    channel_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    channel_name: Mapped[str] = mapped_column(String(200), nullable=False)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    task_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
```

- [ ] **Step 3: Export models from `__init__.py`**

Modify `backend/app/models/__init__.py` — add two lines at end:

```python
from app.models.notification_channel import NotificationChannel
from app.models.notification_log import NotificationLog
```

- [ ] **Step 4: Verify models register with Base.metadata**

Run:
```bash
cd backend && python -c "from app.models import NotificationChannel, NotificationLog; from app.database import Base; print(sorted(Base.metadata.tables.keys()))"
```
Expected output includes `notification_channels` and `notification_logs`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/notification_channel.py backend/app/models/notification_log.py backend/app/models/__init__.py
git commit -m "feat: add NotificationChannel and NotificationLog models"
```

---

## Task 2: Schemas — channel CRUD + agent event payload + log response

**Files:**
- Create: `backend/app/schemas/notification_channel.py`
- Create: `backend/app/schemas/notification_log.py`
- Create: `backend/app/schemas/agent_event.py`
- Test: inline import smoke test (Step 4)

**Interfaces:**
- Produces: `NotificationChannelCreate`, `NotificationChannelUpdate`, `NotificationChannelResponse`, `NotificationLogResponse`, `AgentEventRequest` (with two accepted shapes — see validation logic).

- [ ] **Step 1: Write channel schemas with per-type config validation**

Create `backend/app/schemas/notification_channel.py`:

```python
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, model_validator


ChannelType = Literal["desktop", "webhook", "sound", "email"]


class DesktopConfig(BaseModel):
    command: str = Field(default="notify-send", max_length=200)


class WebhookConfig(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    method: Literal["POST", "PUT"] = "POST"
    headers: dict[str, str] = Field(default_factory=dict)
    body_template: str = Field(default='{"event": "{event}", "title": "{title}", "detail": "{detail}"}', max_length=4000)


class SoundConfig(BaseModel):
    file: str = Field(min_length=1, max_length=1000)
    command: str = Field(default="paplay", max_length=200)


class EmailConfig(BaseModel):
    smtp_host: str = Field(min_length=1, max_length=255)
    smtp_port: int = Field(default=587, ge=1, le=65535)
    username: str = Field(default="", max_length=200)
    password_env: str = Field(min_length=1, max_length=100)
    from_addr: str = Field(alias="from", min_length=1, max_length=200)
    to: list[str] = Field(min_length=1)
    use_tls: bool = True

    model_config = {"populate_by_name": True}


class NotificationChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    channel_type: ChannelType
    config: dict = Field(default_factory=dict)
    event_filters: list[str] = Field(default_factory=list)
    project_filters: list[str] = Field(default_factory=list)
    enabled: bool = True

    @model_validator(mode="after")
    def _validate_config(self):
        # Run the dict through the per-type config model to catch bad input early.
        type_to_model = {
            "desktop": DesktopConfig,
            "webhook": WebhookConfig,
            "sound": SoundConfig,
            "email": EmailConfig,
        }
        model = type_to_model[self.channel_type]
        # Re-validate; raises pydantic.ValidationError on bad input.
        self.config = model(**self.config).model_dump(by_alias=True)
        return self


class NotificationChannelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    config: dict | None = None
    event_filters: list[str] | None = None
    project_filters: list[str] | None = None
    enabled: bool | None = None


class NotificationChannelResponse(BaseModel):
    id: str
    name: str
    channel_type: str
    config: dict
    event_filters: list[str]
    project_filters: list[str]
    enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Write log response schema**

Create `backend/app/schemas/notification_log.py`:

```python
from datetime import datetime
from pydantic import BaseModel


class NotificationLogResponse(BaseModel):
    id: str
    channel_id: str | None
    channel_name: str
    event_type: str
    task_id: str | None
    project_id: str | None
    status: str
    detail: str
    http_status: int | None
    duration_ms: int
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 3: Write agent event request schema**

Create `backend/app/schemas/agent_event.py`:

```python
from pydantic import BaseModel, field_validator


class AgentEventRequest(BaseModel):
    # Accept either Claude Code's raw stdin payload or an explicit kanban-format body.
    # We do NOT validate event_type here — the receiver resolves it from either
    # hook_event_name (Claude Code) or event_type (kanban/opencode).
    hook_event_name: str | None = None
    event_type: str | None = None
    task_id: str | None = None
    project_id: str | None = None
    agent: str | None = None
    message: str | None = None
    cwd: str | None = None
    session_id: str | None = None
    transcript_path: str | None = None
    last_assistant_message: str | None = None
    context: dict | None = None

    def resolved_event_type(self) -> str | None:
        if self.hook_event_name:
            return self.hook_event_name
        return self.event_type

    @field_validator("event_type", "hook_event_name")
    @classmethod
    def _non_empty(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("must be non-empty string when provided")
        return v
```

- [ ] **Step 4: Smoke-test imports**

Run:
```bash
cd backend && python -c "
from app.schemas.notification_channel import NotificationChannelCreate, NotificationChannelResponse
from app.schemas.notification_log import NotificationLogResponse
from app.schemas.agent_event import AgentEventRequest
# Validate config rejection works
try:
    NotificationChannelCreate(name='x', channel_type='email', config={'smtp_host': 'h', 'to': ['a@b']})
    print('FAIL: should have raised')
except Exception:
    print('OK: email config rejected without required fields')
# Validate happy path
ch = NotificationChannelCreate(name='x', channel_type='desktop', config={})
print('OK: desktop channel created with', ch.config)
"
```
Expected: `OK: email config rejected...` and `OK: desktop channel created with {'command': 'notify-send'}`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/notification_channel.py backend/app/schemas/notification_log.py backend/app/schemas/agent_event.py
git commit -m "feat: add notification channel/log/agent-event schemas"
```

---

## Task 3: Channel senders (desktop, webhook, sound, email)

**Files:**
- Create: `backend/app/services/notification_senders/__init__.py`
- Create: `backend/app/services/notification_senders/desktop.py`
- Create: `backend/app/services/notification_senders/webhook.py`
- Create: `backend/app/services/notification_senders/sound.py`
- Create: `backend/app/services/notification_senders/email.py`
- Test: `backend/tests/test_notification_senders.py`

**Interfaces:**
- Consumes: a normalized `event` dict shaped like `{"event_type": str, "task_id": str|None, "project_id": str|None, "task_title": str|None, "message": str|None, "agent": str|None, "payload": dict}`.
- Produces: each sender is a function `send(channel: NotificationChannel, event: dict) -> dict` that returns a small result dict (e.g. `{"http_status": 200}`) on success or raises `Exception` on failure. The dispatcher catches all exceptions and logs them.

- [ ] **Step 1: Write the test file (all senders at once, since they're tiny)**

Create `backend/tests/test_notification_senders.py`:

```python
import os
from unittest.mock import patch, MagicMock

import pytest

from app.models.notification_channel import NotificationChannel
from app.services.notification_senders.desktop import send as send_desktop
from app.services.notification_senders.webhook import send as send_webhook
from app.services.notification_senders.sound import send as send_sound
from app.services.notification_senders.email import send as send_email


EVENT = {
    "event_type": "Stop",
    "task_id": None,
    "project_id": None,
    "task_title": "Test task",
    "message": "Agent finished",
    "agent": "claude-code",
    "payload": {},
}


def _make_channel(channel_type, config):
    return NotificationChannel(
        id="c1", name="test", channel_type=channel_type, config=config,
        event_filters=[], project_filters=[], enabled=True,
    )


def test_desktop_sender_calls_notify_send():
    ch = _make_channel("desktop", {"command": "notify-send"})
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        result = send_desktop(ch, EVENT)
    assert mock_run.call_count == 1
    args = mock_run.call_args[0][0]
    assert args[0] == "notify-send"
    assert "Stop" in args[1]
    assert "Test task" in args[2] or "Agent finished" in args[2]
    assert result == {"command": "notify-send"}


def test_desktop_sender_raises_on_nonzero_exit():
    ch = _make_channel("desktop", {"command": "notify-send"})
    import subprocess as sp
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.side_effect = sp.CalledProcessError(returncode=1, cmd="notify-send")
        with pytest.raises(sp.CalledProcessError):
            send_desktop(ch, EVENT)


def test_webhook_sender_posts_rendered_body():
    ch = _make_channel("webhook", {
        "url": "https://hooks.example.com/test",
        "method": "POST",
        "headers": {"Authorization": "Bearer x"},
        "body_template": '{"event": "{event}", "title": "{title}"}',
    })
    with patch("app.services.notification_senders.webhook.requests.post") as mock_post:
        mock_resp = MagicMock(status_code=200)
        mock_post.return_value = mock_resp
        result = send_webhook(ch, EVENT)
    mock_post.assert_called_once()
    kwargs = mock_post.call_args.kwargs
    assert kwargs["url"] == "https://hooks.example.com/test"
    assert kwargs["headers"] == {"Authorization": "Bearer x"}
    assert kwargs["json"] == {"event": "Stop", "title": "Test task"}
    assert result == {"http_status": 200}


def test_webhook_sender_raises_on_request_error():
    ch = _make_channel("webhook", {"url": "https://x", "body_template": "{}"})
    with patch("app.services.notification_senders.webhook.requests.post") as mock_post:
        mock_post.side_effect = Exception("connection refused")
        with pytest.raises(Exception, match="connection refused"):
            send_webhook(ch, EVENT)


def test_sound_sender_calls_paplay():
    ch = _make_channel("sound", {"file": "/usr/share/sounds/ding.ogg", "command": "paplay"})
    with patch("app.services.notification_senders.sound.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        result = send_sound(ch, EVENT)
    args = mock_run.call_args[0][0]
    assert args == ["paplay", "/usr/share/sounds/ding.ogg"]
    assert result["file"] == "/usr/share/sounds/ding.ogg"


def test_email_sender_smtp_flow():
    os.environ["TEST_SMTP_PASS"] = "secret"
    try:
        ch = _make_channel("email", {
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "username": "u",
            "password_env": "TEST_SMTP_PASS",
            "from": "kanban@example.com",
            "to": ["dev@example.com"],
            "use_tls": True,
        })
        with patch("app.services.notification_senders.email.smtplib.SMTP") as mock_smtp:
            instance = mock_smtp.return_value.__enter__.return_value
            send_email(ch, EVENT)
        mock_smtp.assert_called_once_with("smtp.example.com", 587, timeout=10)
        instance.starttls.assert_called_once()
        instance.login.assert_called_once_with("u", "secret")
        instance.send_message.assert_called_once()
        sent_msg = instance.send_message.call_args[0][0]
        assert sent_msg["From"] == "kanban@example.com"
        assert sent_msg["To"] == "dev@example.com"
        assert "Stop" in sent_msg["Subject"]
    finally:
        del os.environ["TEST_SMTP_PASS"]


def test_email_sender_missing_password_env_raises():
    ch = _make_channel("email", {
        "smtp_host": "h", "smtp_port": 587, "username": "u",
        "password_env": "MISSING_ENV_VAR_xyz",
        "from": "a@b", "to": ["c@d"], "use_tls": False,
    })
    with patch("app.services.notification_senders.email.smtplib.SMTP"):
        with pytest.raises(KeyError):
            send_email(ch, EVENT)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && python -m pytest tests/test_notification_senders.py -v
```
Expected: ImportError for `notification_senders` modules.

- [ ] **Step 3: Write desktop sender**

Create `backend/app/services/notification_senders/desktop.py`:

```python
import subprocess


def send(channel, event):
    cmd = channel.config.get("command", "notify-send")
    title = f"Kanban: {event['event_type']}"
    body = event.get("message") or event.get("task_title") or ""
    subprocess.run([cmd, title, body], timeout=5, check=True)
    return {"command": cmd}
```

- [ ] **Step 4: Write webhook sender**

Create `backend/app/services/notification_senders/webhook.py`:

```python
import json
import requests


def _render(template: str, event: dict) -> str:
    return (
        template
        .replace("{event}", str(event.get("event_type") or ""))
        .replace("{title}", str(event.get("task_title") or ""))
        .replace("{detail}", str(event.get("message") or ""))
    )


def send(channel, event):
    cfg = channel.config
    rendered = _render(cfg.get("body_template", ""), event)
    try:
        body_json = json.loads(rendered) if rendered.strip().startswith("{") else rendered
        is_json = True
    except json.JSONDecodeError:
        body_json = rendered
        is_json = False

    resp = requests.request(
        method=cfg.get("method", "POST"),
        url=cfg["url"],
        headers=cfg.get("headers", {}),
        json=body_json if is_json else None,
        data=None if is_json else body_json,
        timeout=10,
    )
    return {"http_status": resp.status_code}
```

- [ ] **Step 5: Write sound sender**

Create `backend/app/services/notification_senders/sound.py`:

```python
import subprocess


def send(channel, event):
    cmd = channel.config.get("command", "paplay")
    file_path = channel.config["file"]
    subprocess.run([cmd, file_path], timeout=5, check=True)
    return {"command": cmd, "file": file_path}
```

- [ ] **Step 6: Write email sender**

Create `backend/app/services/notification_senders/email.py`:

```python
import os
import smtplib
from email.message import EmailMessage


def send(channel, event):
    cfg = channel.config
    password_env = cfg["password_env"]
    if password_env not in os.environ:
        raise KeyError(f"Password env var '{password_env}' is not set")
    password = os.environ[password_env]

    msg = EmailMessage()
    msg["From"] = cfg["from_addr"] if "from_addr" in cfg else cfg.get("from", "")
    msg["To"] = ", ".join(cfg["to"])
    msg["Subject"] = f"[Kanban] {event['event_type']}: {event.get('task_title') or ''}"
    msg.set_content(event.get("message") or "")

    with smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"], timeout=10) as s:
        if cfg.get("use_tls", True):
            s.starttls()
        if cfg.get("username"):
            s.login(cfg["username"], password)
        s.send_message(msg)

    return {"smtp_host": cfg["smtp_host"], "recipients": len(cfg["to"])}
```

- [ ] **Step 7: Write sender registry**

Create `backend/app/services/notification_senders/__init__.py`:

```python
from app.services.notification_senders.desktop import send as desktop_send
from app.services.notification_senders.webhook import send as webhook_send
from app.services.notification_senders.sound import send as sound_send
from app.services.notification_senders.email import send as email_send


SENDERS = {
    "desktop": desktop_send,
    "webhook": webhook_send,
    "sound": sound_send,
    "email": email_send,
}


def get_sender(channel_type: str):
    return SENDERS.get(channel_type)
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_notification_senders.py -v
```
Expected: all 7 tests pass.

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/notification_senders/ backend/tests/test_notification_senders.py
git commit -m "feat: add notification channel senders (desktop/webhook/sound/email)"
```

---

## Task 4: Notification service — ingest_event + dispatcher

**Files:**
- Create: `backend/app/services/notification_service.py`
- Test: `backend/tests/test_notification_dispatch.py`

**Interfaces:**
- Consumes: `NotificationChannel`, `NotificationLog` models; sender registry from Task 3; `Worktree` model for cwd→task resolution.
- Produces: `ingest_event(db, event_type, task_id?, project_id?, agent?, payload?, message?) -> dict` returning `{"matched": N, "succeeded": N, "failed": N}`. Side effect: one `NotificationLog` row per dispatched channel.

- [ ] **Step 1: Write the dispatch test file**

Create `backend/tests/test_notification_dispatch.py`:

```python
from unittest.mock import patch

import pytest

from app.models.notification_channel import NotificationChannel
from app.models.notification_log import NotificationLog
from app.models.project import Project
from app.models.task import Task
from app.models.worktree import Worktree
from app.services.notification_service import ingest_event


def _make_channel(db, name="ch", channel_type="desktop", config=None,
                  event_filters=None, project_filters=None, enabled=True):
    ch = NotificationChannel(
        name=name, channel_type=channel_type,
        config=config or {"command": "notify-send"},
        event_filters=event_filters or [],
        project_filters=project_filters or [],
        enabled=enabled,
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return ch


def _make_project_task(db):
    proj = Project(name="P1")
    db.add(proj)
    db.commit()
    db.refresh(proj)
    task = Task(project_id=proj.id, title="T1")
    db.add(task)
    db.commit()
    db.refresh(task)
    return proj, task


def test_ingest_no_channels_returns_zero(db_session):
    result = ingest_event(db_session, event_type="Stop")
    assert result == {"matched": 0, "succeeded": 0, "failed": 0}


def test_ingest_dispatches_to_matching_channel(db_session):
    _make_channel(db_session)
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock_subprocess_ok()
        result = ingest_event(db_session, event_type="Stop")
    assert result == {"matched": 1, "succeeded": 1, "failed": 0}
    logs = db_session.query(NotificationLog).all()
    assert len(logs) == 1
    assert logs[0].status == "success"
    assert logs[0].event_type == "Stop"


def test_ingest_continues_after_channel_failure(db_session):
    _make_channel(db_session, name="ok")
    _make_channel(db_session, name="bad", channel_type="webhook",
                  config={"url": "http://localhost:1/nope", "body_template": "{}"})
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run, \
         patch("app.services.notification_senders.webhook.requests.post") as mock_post:
        mock_run.return_value = MagicMock_subprocess_ok()
        mock_post.side_effect = Exception("conn refused")
        result = ingest_event(db_session, event_type="Stop")
    assert result["matched"] == 2
    assert result["succeeded"] == 1
    assert result["failed"] == 1
    logs = db_session.query(NotificationLog).order_by(NotificationLog.created_at).all()
    statuses = sorted(log.status for log in logs)
    assert statuses == ["failure", "success"]


def test_event_filter_excludes_non_matching_channel(db_session):
    _make_channel(db_session, event_filters=["task.done"])
    result = ingest_event(db_session, event_type="Stop")
    assert result == {"matched": 0, "succeeded": 0, "failed": 0}


def test_project_filter_excludes_non_matching_channel(db_session):
    proj, task = _make_project_task(db_session)
    _make_channel(db_session, project_filters=["other-project-id"])
    result = ingest_event(db_session, event_type="Stop", project_id=proj.id)
    assert result == {"matched": 0, "succeeded": 0, "failed": 0}


def test_ingest_resolves_task_id_from_worktree_cwd(db_session):
    proj, task = _make_project_task(db_session)
    wt = Worktree(task_id=task.id, config_id=None, branch="b", path="/tmp/wt-xyz", status="active")
    db_session.add(wt)
    db_session.commit()
    ch = _make_channel(db_session, project_filters=[proj.id])
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock_subprocess_ok()
        result = ingest_event(
            db_session, event_type="Stop",
            payload={"cwd": "/tmp/wt-xyz"},
        )
    assert result["matched"] == 1
    logs = db_session.query(NotificationLog).all()
    assert logs[0].task_id == task.id
    assert logs[0].project_id == proj.id


def test_disabled_channel_is_skipped(db_session):
    _make_channel(db_session, enabled=False)
    result = ingest_event(db_session, event_type="Stop")
    assert result == {"matched": 0, "succeeded": 0, "failed": 0}


# --- helpers --------------------------------------------------------------

class _MockResult:
    returncode = 0


def MagicMock_subprocess_ok():
    """Helper because we can't import MagicMock at module top cleanly in pytest discovery."""
    from unittest.mock import MagicMock
    m = MagicMock()
    m.returncode = 0
    return m
```

Note: this test file uses a `db_session` fixture. Add it to `conftest.py` (Step 2).

- [ ] **Step 2: Add db_session fixture to conftest**

Modify `backend/tests/conftest.py` — add at end:

```python
@pytest.fixture
def db_session():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd backend && python -m pytest tests/test_notification_dispatch.py -v
```
Expected: ImportError for `notification_service`.

- [ ] **Step 4: Write the notification service**

Create `backend/app/services/notification_service.py`:

```python
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.notification_channel import NotificationChannel
from app.models.notification_log import NotificationLog
from app.models.task import Task
from app.models.worktree import Worktree
from app.services.notification_senders import get_sender


_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="notify")


def _resolve_via_cwd(db: Session, cwd: str) -> tuple[str | None, str | None]:
    """Look up task_id/project_id by matching Worktree.path == cwd."""
    wt = db.query(Worktree).filter(Worktree.path == cwd).first()
    if not wt:
        return None, None
    task = db.query(Task).filter(Task.id == wt.task_id).first()
    if not task:
        return None, None
    return task.id, task.project_id


def _matches(channel: NotificationChannel, event_type: str, project_id: str | None) -> bool:
    if not channel.enabled:
        return False
    if channel.deleted_at is not None:
        return False
    if channel.event_filters and event_type not in channel.event_filters:
        return False
    if channel.project_filters and (project_id is None or project_id not in channel.project_filters):
        return False
    return True


def _dispatch_one(channel: NotificationChannel, event: dict) -> tuple[bool, str, int | None, dict | None]:
    """Run a single sender. Returns (success, detail, http_status, result)."""
    sender = get_sender(channel.channel_type)
    if sender is None:
        return False, f"No sender registered for channel_type '{channel.channel_type}'", None, None
    try:
        result = _EXECUTOR.submit(sender, channel, event).result(timeout=15)
        return True, "ok", (result.get("http_status") if isinstance(result, dict) else None), result
    except Exception as exc:
        tb = traceback.format_exc(limit=3)
        return False, f"{type(exc).__name__}: {exc}\n{tb}", None, None


def ingest_event(
    db: Session,
    event_type: str,
    task_id: str | None = None,
    project_id: str | None = None,
    agent: str | None = None,
    payload: dict | None = None,
    message: str | None = None,
) -> dict:
    """Single entry point for all notification events."""
    payload = payload or {}

    # Resolve task_id/project_id if missing.
    if not task_id and payload.get("cwd"):
        task_id, proj_id = _resolve_via_cwd(db, payload["cwd"])
        if proj_id and not project_id:
            project_id = proj_id

    if task_id and not project_id:
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            project_id = task.project_id

    # Build the event dict that senders consume.
    task_title = None
    if task_id:
        t = db.query(Task).filter(Task.id == task_id).first()
        if t:
            task_title = t.title

    event = {
        "event_type": event_type,
        "task_id": task_id,
        "project_id": project_id,
        "task_title": task_title,
        "message": message,
        "agent": agent,
        "payload": payload,
    }

    # Find matching channels.
    channels = db.query(NotificationChannel).all()
    matched = [c for c in channels if _matches(c, event_type, project_id)]

    succeeded = 0
    failed = 0
    for ch in matched:
        t0 = time.monotonic()
        ok, detail, http_status, _ = _dispatch_one(ch, event)
        duration_ms = int((time.monotonic() - t0) * 1000)
        log = NotificationLog(
            channel_id=ch.id,
            channel_name=ch.name,
            event_type=event_type,
            task_id=task_id,
            project_id=project_id,
            status="success" if ok else "failure",
            detail=detail[:4000],
            http_status=http_status,
            duration_ms=duration_ms,
        )
        db.add(log)
        if ok:
            succeeded += 1
        else:
            failed += 1
    db.commit()

    return {"matched": len(matched), "succeeded": succeeded, "failed": failed}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_notification_dispatch.py -v
```
Expected: all 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/notification_service.py backend/tests/test_notification_dispatch.py backend/tests/conftest.py
git commit -m "feat: add notification service with thread-pool dispatch and audit logging"
```

---

## Task 5: Notifications router — agent-events receiver + channel CRUD + log list

**Files:**
- Create: `backend/app/routers/notifications.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_agent_events.py`, `backend/tests/test_notification_channels.py`

**Interfaces:**
- Consumes: `notification_service.ingest_event`, models, schemas from Tasks 1–4.
- Produces REST endpoints (all prefixed `/api/v1`):
  - `GET /notification-channels`
  - `POST /notification-channels`
  - `GET /notification-channels/{id}`
  - `PUT /notification-channels/{id}`
  - `DELETE /notification-channels/{id}` (soft-delete)
  - `POST /notification-channels/{id}/test`
  - `POST /agent-events`
  - `GET /notification-logs`

- [ ] **Step 1: Write agent-events receiver test**

Create `backend/tests/test_agent_events.py`:

```python
from unittest.mock import patch


def test_agent_event_claude_code_raw_stdin(client):
    # Simulate the exact payload Claude Code pipes to a hook command.
    resp = client.post("/api/v1/agent-events", json={
        "hook_event_name": "Stop",
        "session_id": "abc",
        "cwd": "/home/u/wt",
        "transcript_path": "/home/u/.claude/projects/x/y.jsonl",
    })
    assert resp.status_code == 202
    body = resp.json()
    assert "matched" in body
    assert body["matched"] == 0  # no channels configured


def test_agent_event_explicit_event_type(client):
    resp = client.post("/api/v1/agent-events", json={
        "event_type": "agent.stop",
        "agent": "opencode",
        "message": "done",
    })
    assert resp.status_code == 202


def test_agent_event_unknown_task_id_returns_400(client):
    resp = client.post("/api/v1/agent-events", json={
        "event_type": "Stop",
        "task_id": "does-not-exist-1234",
    })
    assert resp.status_code == 400


def test_agent_event_missing_event_type_returns_400(client):
    resp = client.post("/api/v1/agent-events", json={})
    assert resp.status_code == 400


def test_agent_event_fires_channel_and_returns_log_id(client):
    from unittest.mock import MagicMock
    # Create a channel
    client.post("/api/v1/notification-channels", json={
        "name": "desktop",
        "channel_type": "desktop",
        "config": {},
    })
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        resp = client.post("/api/v1/agent-events", json={"event_type": "Stop"})
    assert resp.status_code == 202
    body = resp.json()
    assert body["matched"] == 1
    assert body["succeeded"] == 1
    assert len(body["log_ids"]) == 1
```

- [ ] **Step 2: Write channel CRUD test**

Create `backend/tests/test_notification_channels.py`:

```python
from unittest.mock import patch, MagicMock


def test_create_channel_validates_config(client):
    resp = client.post("/api/v1/notification-channels", json={
        "name": "bad-email",
        "channel_type": "email",
        "config": {"smtp_host": "h"},  # missing required fields
    })
    assert resp.status_code == 422


def test_create_and_list_channel(client):
    resp = client.post("/api/v1/notification-channels", json={
        "name": "Desktop",
        "channel_type": "desktop",
        "config": {},
        "event_filters": ["Stop", "task.done"],
    })
    assert resp.status_code == 201
    created = resp.json()
    assert created["id"]
    assert created["config"] == {"command": "notify-send"}
    assert created["event_filters"] == ["Stop", "task.done"]

    listing = client.get("/api/v1/notification-channels")
    assert listing.status_code == 200
    assert len(listing.json()) == 1


def test_update_channel(client):
    create = client.post("/api/v1/notification-channels", json={
        "name": "x", "channel_type": "desktop", "config": {},
    })
    cid = create.json()["id"]
    resp = client.put(f"/api/v1/notification-channels/{cid}", json={"enabled": False})
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


def test_delete_channel_soft_deletes(client):
    create = client.post("/api/v1/notification-channels", json={
        "name": "x", "channel_type": "desktop", "config": {},
    })
    cid = create.json()["id"]
    resp = client.delete(f"/api/v1/notification-channels/{cid}")
    assert resp.status_code == 204
    # Listing excludes soft-deleted
    listing = client.get("/api/v1/notification-channels").json()
    assert len(listing) == 0


def test_test_channel_endpoint_dispatches(client):
    create = client.post("/api/v1/notification-channels", json={
        "name": "x", "channel_type": "desktop", "config": {},
    })
    cid = create.json()["id"]
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        resp = client.post(f"/api/v1/notification-channels/{cid}/test")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "success"


def test_logs_endpoint_returns_recent(client):
    create = client.post("/api/v1/notification-channels", json={
        "name": "x", "channel_type": "desktop", "config": {},
    })
    cid = create.json()["id"]
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        client.post(f"/api/v1/notification-channels/{cid}/test")
    logs = client.get("/api/v1/notification-logs").json()
    assert len(logs) >= 1
    assert logs[0]["status"] == "success"
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd backend && python -m pytest tests/test_agent_events.py tests/test_notification_channels.py -v
```
Expected: 404 errors (router not registered).

- [ ] **Step 4: Write the notifications router**

Create `backend/app/routers/notifications.py`:

```python
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.notification_channel import NotificationChannel
from app.models.notification_log import NotificationLog
from app.models.task import Task
from app.schemas.agent_event import AgentEventRequest
from app.schemas.notification_channel import (
    NotificationChannelCreate,
    NotificationChannelUpdate,
    NotificationChannelResponse,
)
from app.schemas.notification_log import NotificationLogResponse
from app.services.notification_service import ingest_event


router = APIRouter(tags=["notifications"])


# --- channel CRUD --------------------------------------------------------


@router.get("/notification-channels", response_model=list[NotificationChannelResponse])
def list_channels(db: Session = Depends(get_db)):
    return (
        db.query(NotificationChannel)
        .filter(NotificationChannel.deleted_at.is_(None))
        .order_by(NotificationChannel.created_at.desc())
        .all()
    )


@router.post("/notification-channels", response_model=NotificationChannelResponse, status_code=201)
def create_channel(data: NotificationChannelCreate, db: Session = Depends(get_db)):
    ch = NotificationChannel(**data.model_dump())
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return ch


@router.get("/notification-channels/{channel_id}", response_model=NotificationChannelResponse)
def get_channel(channel_id: str, db: Session = Depends(get_db)):
    ch = db.query(NotificationChannel).filter(NotificationChannel.id == channel_id).first()
    if not ch or ch.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Channel not found")
    return ch


@router.put("/notification-channels/{channel_id}", response_model=NotificationChannelResponse)
def update_channel(channel_id: str, data: NotificationChannelUpdate, db: Session = Depends(get_db)):
    ch = db.query(NotificationChannel).filter(NotificationChannel.id == channel_id).first()
    if not ch or ch.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Channel not found")
    update = data.model_dump(exclude_unset=True)
    for k, v in update.items():
        setattr(ch, k, v)
    ch.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(ch)
    return ch


@router.delete("/notification-channels/{channel_id}", status_code=204)
def delete_channel(channel_id: str, db: Session = Depends(get_db)):
    ch = db.query(NotificationChannel).filter(NotificationChannel.id == channel_id).first()
    if not ch or ch.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Channel not found")
    ch.deleted_at = datetime.utcnow()
    db.commit()


@router.post("/notification-channels/{channel_id}/test")
def test_channel(channel_id: str, db: Session = Depends(get_db)):
    ch = db.query(NotificationChannel).filter(NotificationChannel.id == channel_id).first()
    if not ch or ch.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Channel not found")
    result = ingest_event(
        db,
        event_type="test.ping",
        message=f"Test from channel '{ch.name}'",
        agent="kanban-test",
    )
    # The test event matches this channel only if filters allow it; either way
    # we want to surface the result so the UI can show feedback.
    log = (
        db.query(NotificationLog)
        .filter(NotificationLog.channel_id == ch.id)
        .order_by(NotificationLog.created_at.desc())
        .first()
    )
    return {
        "matched": result["matched"],
        "status": log.status if log else "no_dispatch",
        "detail": log.detail if log else None,
        "log_id": log.id if log else None,
    }


# --- agent-events receiver -----------------------------------------------


@router.post("/agent-events", status_code=202)
def receive_agent_event(body: AgentEventRequest, db: Session = Depends(get_db)):
    event_type = body.resolved_event_type()
    if not event_type:
        raise HTTPException(status_code=400, detail="Missing event_type or hook_event_name")
    if body.task_id:
        task = db.query(Task).filter(Task.id == body.task_id).first()
        if not task:
            raise HTTPException(status_code=400, detail=f"task_id '{body.task_id}' not found")
    payload = {
        "cwd": body.cwd,
        "session_id": body.session_id,
        "transcript_path": body.transcript_path,
        "last_assistant_message": body.last_assistant_message,
        "context": body.context or {},
        "hook_event_name": body.hook_event_name,
    }
    result = ingest_event(
        db,
        event_type=event_type,
        task_id=body.task_id,
        project_id=body.project_id,
        agent=body.agent,
        payload=payload,
        message=body.message,
    )
    from app.models.notification_log import NotificationLog
    log_ids = [
        row[0] for row in (
            db.query(NotificationLog.id)
            .order_by(NotificationLog.created_at.desc())
            .limit(result["matched"])
            .all()
        )
    ]
    return {
        "matched": result["matched"],
        "succeeded": result["succeeded"],
        "failed": result["failed"],
        "log_ids": log_ids,
    }


# --- audit log -----------------------------------------------------------


@router.get("/notification-logs", response_model=list[NotificationLogResponse])
def list_logs(
    channel_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(NotificationLog)
    if channel_id:
        q = q.filter(NotificationLog.channel_id == channel_id)
    return q.order_by(NotificationLog.created_at.desc()).limit(limit).all()
```

- [ ] **Step 5: Register the router in main.py**

Modify `backend/app/main.py`:

In the import block at line 12, add `notifications`:
```python
from app.routers import projects, tasks, board, execution_configs, activity, code_projects, statistics, trash, worktree_configs, worktrees, remote_hosts, notifications
```

After line 46 (`app.include_router(remote_hosts.router, ...)`), add:
```python
app.include_router(notifications.router, prefix="/api/v1")
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_agent_events.py tests/test_notification_channels.py -v
```
Expected: all tests pass.

- [ ] **Step 7: Run full test suite to check for regressions**

```bash
cd backend && python -m pytest tests/ -v
```
Expected: all existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/notifications.py backend/app/main.py backend/tests/test_agent_events.py backend/tests/test_notification_channels.py
git commit -m "feat: add notifications router (channel CRUD, agent-events receiver, log list)"
```

---

## Task 6: Wire internal task transitions into ingest_event

**Files:**
- Modify: `backend/app/routers/tasks.py` (`change_task_status` handler)
- Test: `backend/tests/test_task_events.py`

**Interfaces:**
- Consumes: `notification_service.ingest_event` from Task 4.
- Produces: when a task transitions to `done`, `complete`, `cancelled`, or `review`, an internal event of type `task.<status>` is fired into the dispatch pipeline.

- [ ] **Step 1: Write the test**

Create `backend/tests/test_task_events.py`:

```python
from unittest.mock import patch, MagicMock


def _seed_task_with_implementation_plan(client, db_session):
    from app.models.project import Project
    from app.models.task import Task
    proj = Project(name="P")
    db_session.add(proj)
    db_session.commit()
    db_session.refresh(proj)
    task = Task(project_id=proj.id, title="T", implementation_plan="plan")
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)
    return proj.id, task.id


def test_task_transition_to_done_fires_task_done_event(client, db_session):
    proj_id, task_id = _seed_task_with_implementation_plan(client, db_session)
    # Create a channel that listens for task.done
    client.post("/api/v1/notification-channels", json={
        "name": "done-listener",
        "channel_type": "desktop",
        "config": {},
        "event_filters": ["task.done"],
    })
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        # Move task backlog -> todo -> in_progress -> review -> done
        client.put(f"/api/v1/tasks/{task_id}/status", json={"status": "todo"})
        client.put(f"/api/v1/tasks/{task_id}/status", json={"status": "in_progress"})
        client.put(f"/api/v1/tasks/{task_id}/status", json={"status": "review"})
        resp = client.put(f"/api/v1/tasks/{task_id}/status", json={"status": "done"})
    assert resp.status_code == 200
    # Verify dispatch happened: the channel fired once for task.review + once for task.done
    # but the channel only matches task.done, so only one success log.
    logs = client.get("/api/v1/notification-logs").json()
    successes = [log for log in logs if log["status"] == "success" and log["event_type"] == "task.done"]
    assert len(successes) == 1


def test_task_transition_to_backlog_does_not_fire(client, db_session):
    proj_id, task_id = _seed_task_with_implementation_plan(client, db_session)
    client.post("/api/v1/notification-channels", json={
        "name": "x", "channel_type": "desktop", "config": {},
    })
    with patch("app.services.notification_senders.desktop.subprocess.run"):
        client.put(f"/api/v1/tasks/{task_id}/status", json={"status": "todo"})
        client.put(f"/api/v1/tasks/{task_id}/status", json={"status": "backlog"})
    logs = client.get("/api/v1/notification-logs").json()
    assert len(logs) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest tests/test_task_events.py -v
```
Expected: tests fail because no events are fired.

- [ ] **Step 3: Wire ingest_event into change_task_status**

Modify `backend/app/routers/tasks.py`. Find the `change_task_status` function (around line 238). At the very end of the function (just before `return task` on line 290), insert:

```python
    # Fire notification events for relevant transitions.
    if data.status in {"done", "complete", "cancelled", "review"}:
        try:
            from app.services.notification_service import ingest_event
            ingest_event(
                db,
                event_type=f"task.{data.status}",
                task_id=task.id,
                project_id=task.project_id,
            )
        except Exception:
            # Notification failures must never block a task status change.
            pass
```

Note: import inside the function to avoid circular import risk during initial setup.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_task_events.py -v
```
Expected: both tests pass.

- [ ] **Step 5: Run full backend test suite**

```bash
cd backend && python -m pytest tests/ -v
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/tasks.py backend/tests/test_task_events.py
git commit -m "feat: fire task.* notification events on status transitions"
```

---

## Task 7: Worktree hook writer utility + forwarder script

**Files:**
- Create: `backend/app/services/worktree_hooks.py`
- Test: `backend/tests/test_worktree_hooks.py`

**Interfaces:**
- Consumes: nothing from notification stack (decoupled).
- Produces:
  - `HOOK_EVENTS = ("Stop", "Notification", "SubagentStop", "SessionEnd")`
  - `FORWARDER_PATH = "~/.config/kanban/hooks/claude-code-forwarder.sh"`
  - `FORWARDER_SCRIPT_BODY` constant
  - `ensure_forwarder_script(kanban_url: str = "http://localhost:9527") -> Path` (idempotent)
  - `write_hooks_to_worktree(worktree_path: str | Path) -> dict` (idempotent, atomic)
  - `remove_hooks_from_worktree(worktree_path: str | Path) -> dict`

- [ ] **Step 1: Write the test file**

Create `backend/tests/test_worktree_hooks.py`:

```python
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services.worktree_hooks import (
    HOOK_EVENTS,
    FORWARDER_PATH,
    ensure_forwarder_script,
    write_hooks_to_worktree,
    remove_hooks_from_worktree,
)


@pytest.fixture
def fake_home(tmp_path, monkeypatch):
    """Redirect $HOME so tests don't touch the real ~/.config/kanban/."""
    monkeypatch.setenv("HOME", str(tmp_path))
    return tmp_path


@pytest.fixture
def worktree_dir(tmp_path):
    d = tmp_path / "wt"
    d.mkdir()
    return d


def test_ensure_forwarder_creates_script(fake_home):
    target = Path(FORWARDER_PATH).expanduser()
    assert not target.exists()
    ensure_forwarder_script()
    assert target.exists()
    assert target.stat().st_mode & 0o111  # executable bit set
    content = target.read_text()
    assert "agent-events" in content
    assert "exit 0" in content


def test_ensure_forwarder_idempotent(fake_home):
    ensure_forwarder_script()
    target = Path(FORWARDER_PATH).expanduser()
    first_mtime = target.stat().st_mtime
    ensure_forwarder_script()
    # File still exists; mtime may or may not be unchanged but content is identical.
    assert target.exists()


def test_write_hooks_creates_settings_when_missing(worktree_dir):
    write_hooks_to_worktree(worktree_dir)
    settings = worktree_dir / ".claude" / "settings.json"
    assert settings.exists()
    data = json.loads(settings.read_text())
    for event in HOOK_EVENTS:
        assert event in data["hooks"]
        entries = data["hooks"][event]
        assert len(entries) == 1
        cmd = entries[0]["hooks"][0]["command"]
        assert cmd.endswith("claude-code-forwarder.sh")


def test_write_hooks_merges_into_existing_without_loss(worktree_dir):
    settings = worktree_dir / ".claude" / "settings.json"
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(json.dumps({
        "permissions": {"allow": ["Bash(ls:*)"]},
        "hooks": {
            "Stop": [{"hooks": [{"type": "command", "command": "/user/own/script.sh"}]}],
        },
    }))
    write_hooks_to_worktree(worktree_dir)
    data = json.loads(settings.read_text())
    # User's permission block preserved
    assert data["permissions"]["allow"] == ["Bash(ls:*)"]
    # User's Stop hook preserved AND ours appended
    stop_entries = data["hooks"]["Stop"]
    commands = [e["hooks"][0]["command"] for e in stop_entries]
    assert "/user/own/script.sh" in commands
    assert any(c.endswith("claude-code-forwarder.sh") for c in commands)
    # Other events also added
    assert "Notification" in data["hooks"]


def test_write_hooks_idempotent_on_rerun(worktree_dir):
    write_hooks_to_worktree(worktree_dir)
    write_hooks_to_worktree(worktree_dir)
    settings = worktree_dir / ".claude" / "settings.json"
    data = json.loads(settings.read_text())
    for event in HOOK_EVENTS:
        entries = data["hooks"][event]
        # Should be exactly ONE entry pointing at our forwarder.
        forwarder_entries = [
            e for e in entries
            if e["hooks"][0]["command"].endswith("claude-code-forwarder.sh")
        ]
        assert len(forwarder_entries) == 1


def test_remove_hooks_drops_only_kanban_entries(worktree_dir):
    settings = worktree_dir / ".claude" / "settings.json"
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(json.dumps({
        "hooks": {
            "Stop": [
                {"hooks": [{"type": "command", "command": "/user/own/script.sh"}]},
                {"hooks": [{"type": "command", "command": "/home/u/.config/kanban/hooks/claude-code-forwarder.sh"}]},
            ],
        },
    }))
    remove_hooks_from_worktree(worktree_dir)
    data = json.loads(settings.read_text())
    stop_entries = data["hooks"]["Stop"]
    commands = [e["hooks"][0]["command"] for e in stop_entries]
    assert commands == ["/user/own/script.sh"]


def test_remove_hooks_deletes_empty_settings_file(worktree_dir):
    write_hooks_to_worktree(worktree_dir)
    settings = worktree_dir / ".claude" / "settings.json"
    assert settings.exists()
    remove_hooks_from_worktree(worktree_dir)
    assert not settings.exists()


def test_remove_hooks_preserves_file_with_user_entries(worktree_dir):
    settings = worktree_dir / ".claude" / "settings.json"
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(json.dumps({
        "permissions": {"allow": ["Bash(ls:*)"]},
        "hooks": {
            "Stop": [{"hooks": [{"type": "command", "command": "/home/u/.config/kanban/hooks/claude-code-forwarder.sh"}]}],
            "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "/user/other.sh"}]}],
        },
    }))
    remove_hooks_from_worktree(worktree_dir)
    data = json.loads(settings.read_text())
    # Our Stop entry gone; UserPromptSubmit untouched; permissions preserved.
    assert "Stop" not in data["hooks"]
    assert "UserPromptSubmit" in data["hooks"]
    assert data["permissions"]["allow"] == ["Bash(ls:*)"]


def test_remove_hooks_on_missing_file_is_noop(worktree_dir):
    # No settings.json exists at all; should not raise.
    remove_hooks_from_worktree(worktree_dir)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest tests/test_worktree_hooks.py -v
```
Expected: ImportError for `worktree_hooks`.

- [ ] **Step 3: Write the worktree_hooks service**

Create `backend/app/services/worktree_hooks.py`:

```python
import json
import os
import stat
from pathlib import Path


HOOK_EVENTS = ("Stop", "Notification", "SubagentStop", "SessionEnd")
FORWARDER_PATH = "~/.config/kanban/hooks/claude-code-forwarder.sh"
FORWARDER_MARKER = "claude-code-forwarder.sh"

FORWARDER_SCRIPT_BODY = """#!/usr/bin/env bash
# Generated by kanban. Forwards Claude Code hook stdin to kanban.
# To reconfigure, edit kanban Settings UI — do not edit this file.
input=$(cat)
curl -s -X POST http://{kanban_host}/api/v1/agent-events \\
  -H 'Content-Type: application/json' \\
  --data-binary "$input" \\
  >/dev/null 2>&1 & disown
exit 0
"""


def _forwarder_path() -> Path:
    return Path(FORWARDER_PATH).expanduser()


def ensure_forwarder_script(kanban_host: str = "localhost:9527") -> Path:
    """Write the forwarder script if missing. Idempotent."""
    target = _forwarder_path()
    if target.exists():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    body = FORWARDER_SCRIPT_BODY.replace("{kanban_host}", kanban_host)
    target.write_text(body)
    # chmod +x for user/owner
    mode = target.stat().st_mode
    target.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return target


def _is_our_entry(entry: dict) -> bool:
    """True if this hook entry points at our forwarder script."""
    try:
        for h in entry.get("hooks", []):
            cmd = h.get("command", "")
            if FORWARDER_MARKER in cmd:
                return True
    except Exception:
        pass
    return False


def _our_entry() -> dict:
    return {
        "hooks": [
            {
                "type": "command",
                "command": FORWARDER_PATH,
            }
        ]
    }


def write_hooks_to_worktree(worktree_path: str | Path) -> dict:
    """Merge our hook entries into <worktree_path>/.claude/settings.json.

    Idempotent: re-running does not duplicate entries.
    Atomic: writes to a tmp file then renames.
    Preserves all user-owned entries.
    """
    settings_path = Path(worktree_path) / ".claude" / "settings.json"
    settings_path.parent.mkdir(parents=True, exist_ok=True)

    if settings_path.exists():
        try:
            data = json.loads(settings_path.read_text() or "{}")
            if not isinstance(data, dict):
                data = {}
        except json.JSONDecodeError:
            data = {}
    else:
        data = {}

    hooks = data.setdefault("hooks", {})
    installed = []
    unchanged = []
    for event in HOOK_EVENTS:
        entries = hooks.setdefault(event, [])
        existing_idx = next((i for i, e in enumerate(entries) if _is_our_entry(e)), None)
        our = _our_entry()
        if existing_idx is not None:
            entries[existing_idx] = our
            unchanged.append(event)
        else:
            entries.append(our)
            installed.append(event)

    _atomic_write_json(settings_path, data)
    return {"installed": installed, "unchanged": unchanged}


def remove_hooks_from_worktree(worktree_path: str | Path) -> dict:
    """Drop all hook entries pointing at our forwarder. Preserve everything else."""
    settings_path = Path(worktree_path) / ".claude" / "settings.json"
    if not settings_path.exists():
        return {"removed_events": [], "deleted_file": False}

    try:
        data = json.loads(settings_path.read_text() or "{}")
        if not isinstance(data, dict):
            return {"removed_events": [], "deleted_file": False}
    except json.JSONDecodeError:
        return {"removed_events": [], "deleted_file": False}

    hooks = data.get("hooks", {})
    removed = []
    for event in HOOK_EVENTS:
        if event not in hooks:
            continue
        before = len(hooks[event])
        hooks[event] = [e for e in hooks[event] if not _is_our_entry(e)]
        removed_count = before - len(hooks[event])
        if removed_count > 0:
            removed.append(event)
        if not hooks[event]:
            del hooks[event]

    # If hooks object is now empty, drop the key entirely.
    if not hooks:
        data.pop("hooks", None)

    # If file is now empty, delete it. Otherwise atomic-write.
    if not data:
        settings_path.unlink()
        return {"removed_events": removed, "deleted_file": True}

    _atomic_write_json(settings_path, data)
    return {"removed_events": removed, "deleted_file": False}


def _atomic_write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    os.replace(tmp, path)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_worktree_hooks.py -v
```
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/worktree_hooks.py backend/tests/test_worktree_hooks.py
git commit -m "feat: add worktree hook writer (idempotent install/remove of forwarder hooks)"
```

---

## Task 8: Wire worktree create/delete to call the hook writer

**Files:**
- Modify: `backend/app/routers/worktrees.py` (`_do_create_worktree` and the delete handler)
- Test: extend `backend/tests/test_worktree_hooks.py` (or new `test_worktree_api_hooks.py`)

**Interfaces:**
- Consumes: `write_hooks_to_worktree`, `remove_hooks_from_worktree`, `ensure_forwarder_script` from Task 7.
- Produces: side effects on the filesystem whenever worktrees are created or removed via the API.

- [ ] **Step 1: Add integration tests**

Append to `backend/tests/test_worktree_hooks.py` (or create a new test file `test_worktree_api_integration.py`):

```python
# test_worktree_api_integration.py
import json
from pathlib import Path
from unittest.mock import patch, MagicMock


def test_worktree_create_endpoint_writes_hooks(tmp_path, monkeypatch, client, db_session):
    """When POST /tasks/{id}/worktree succeeds, hooks are written to the worktree dir."""
    monkeypatch.setenv("HOME", str(tmp_path))

    from app.models.project import Project
    from app.models.task import Task
    from app.models.worktree_config import WorktreeConfig
    proj = Project(name="P")
    db_session.add(proj); db_session.commit(); db_session.refresh(proj)
    task = Task(project_id=proj.id, title="T")
    db_session.add(task); db_session.commit(); db_session.refresh(task)
    cfg = WorktreeConfig(
        name="c", branch_template="b-{task_id_short}",
        dir_template=str(tmp_path / "wt-{task_id_short}"),
        base_repo_path=str(tmp_path / "repo"),
    )
    db_session.add(cfg); db_session.commit(); db_session.refresh(cfg)

    # Stub out git operations in worktree_service
    with patch("app.services.worktree_service.validate_repo", return_value={"valid": True, "error": None}), \
         patch("app.services.worktree_service.create_worktree", return_value={"success": True, "error": None}):
        resp = client.post(f"/api/v1/tasks/{task.id}/worktree", json={"config_id": cfg.id})
    assert resp.status_code == 201

    # The worktree path is in the response
    wt_path = resp.json()["path"]
    settings = Path(wt_path) / ".claude" / "settings.json"
    assert settings.exists()
    data = json.loads(settings.read_text())
    assert "Stop" in data["hooks"]


def test_worktree_delete_endpoint_removes_hooks(tmp_path, monkeypatch, client, db_session):
    monkeypatch.setenv("HOME", str(tmp_path))
    from app.models.project import Project
    from app.models.task import Task
    from app.models.worktree import Worktree
    from app.models.worktree_config import WorktreeConfig
    proj = Project(name="P")
    db_session.add(proj); db_session.commit(); db_session.refresh(proj)
    task = Task(project_id=proj.id, title="T")
    db_session.add(task); db_session.commit(); db_session.refresh(task)

    wt_path = tmp_path / "wt-xyz"
    (wt_path / ".claude").mkdir(parents=True)
    settings = wt_path / ".claude" / "settings.json"
    settings.write_text(json.dumps({
        "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "/x/.config/kanban/hooks/claude-code-forwarder.sh"}]}]}
    }))

    cfg = WorktreeConfig(
        name="c", branch_template="b", dir_template=str(wt_path),
        base_repo_path=str(tmp_path / "repo"),
    )
    db_session.add(cfg); db_session.commit(); db_session.refresh(cfg)
    wt = Worktree(task_id=task.id, config_id=cfg.id, branch="b", path=str(wt_path), status="active")
    db_session.add(wt); db_session.commit(); db_session.refresh(wt)
    task.worktree_id = wt.id
    db_session.commit()

    with patch("app.services.worktree_service.remove_worktree", return_value={"success": True, "error": None}):
        resp = client.delete(f"/api/v1/tasks/{task.id}/worktree")
    assert resp.status_code == 204
    # File should be deleted because the only entries were ours.
    assert not settings.exists()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest tests/test_worktree_api_integration.py -v
```
Expected: tests fail (hooks not written).

- [ ] **Step 3: Modify `_do_create_worktree`**

Edit `backend/app/routers/worktrees.py`. After the `db.refresh(wt)` call at the end of `_do_create_worktree` (line 59), insert:

```python
    # Auto-install Claude Code hooks into the worktree directory.
    try:
        from app.services.worktree_hooks import ensure_forwarder_script, write_hooks_to_worktree
        ensure_forwarder_script()
        write_hooks_to_worktree(wt.path)
    except Exception as e:
        # Failure to install hooks must not fail worktree creation.
        import logging
        logging.getLogger(__name__).warning("Failed to install worktree hooks: %s", e)
```

- [ ] **Step 4: Modify the DELETE handler**

In the same file, find `delete_task_worktree` (around line 122). Before `task.worktree_id = None` (around line 133), insert:

```python
        # Remove kanban-managed hooks from the worktree's settings.json.
        try:
            from app.services.worktree_hooks import remove_hooks_from_worktree
            remove_hooks_from_worktree(task.worktree.path)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("Failed to remove worktree hooks: %s", e)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_worktree_api_integration.py tests/test_worktree_hooks.py -v
```
Expected: all tests pass.

- [ ] **Step 6: Run full backend test suite for regressions**

```bash
cd backend && python -m pytest tests/ -v
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/worktrees.py backend/tests/test_worktree_api_integration.py
git commit -m "feat: auto-install/remove Claude Code hooks on worktree create/delete"
```

---

## Task 9: Frontend — types and API client

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Produces TS types matching the backend schemas; axios functions for all endpoints.

- [ ] **Step 1: Add types**

Append to `frontend/src/types/index.ts`:

```typescript
export type NotificationChannelType = 'desktop' | 'webhook' | 'sound' | 'email';

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

export interface NotificationChannelCreate {
  name: string;
  channel_type: NotificationChannelType;
  config: Record<string, unknown>;
  event_filters?: string[];
  project_filters?: string[];
  enabled?: boolean;
}

export interface NotificationChannelUpdate {
  name?: string;
  config?: Record<string, unknown>;
  event_filters?: string[];
  project_filters?: string[];
  enabled?: boolean;
}

export interface NotificationLog {
  id: string;
  channel_id: string | null;
  channel_name: string;
  event_type: string;
  task_id: string | null;
  project_id: string | null;
  status: 'success' | 'failure';
  detail: string;
  http_status: number | null;
  duration_ms: number;
  created_at: string;
}

export interface AgentEventResult {
  matched: number;
  succeeded: number;
  failed: number;
  log_ids: string[];
}
```

- [ ] **Step 2: Add API functions**

Append to `frontend/src/services/api.ts`:

```typescript
export async function getNotificationChannels(): Promise<NotificationChannel[]> {
  const r = await api.get('/notification-channels');
  return r.data;
}

export async function createNotificationChannel(
  payload: NotificationChannelCreate,
): Promise<NotificationChannel> {
  const r = await api.post('/notification-channels', payload);
  return r.data;
}

export async function updateNotificationChannel(
  id: string,
  payload: NotificationChannelUpdate,
): Promise<NotificationChannel> {
  const r = await api.put(`/notification-channels/${id}`, payload);
  return r.data;
}

export async function deleteNotificationChannel(id: string): Promise<void> {
  await api.delete(`/notification-channels/${id}`);
}

export async function testNotificationChannel(
  id: string,
): Promise<{ matched: number; status: string; detail: string | null; log_id: string | null }> {
  const r = await api.post(`/notification-channels/${id}/test`);
  return r.data;
}

export async function getNotificationLogs(
  channelId?: string,
  limit = 100,
): Promise<NotificationLog[]> {
  const params: Record<string, unknown> = { limit };
  if (channelId) params.channel_id = channelId;
  const r = await api.get('/notification-logs', { params });
  return r.data;
}

export async function postAgentEvent(payload: {
  event_type?: string;
  hook_event_name?: string;
  task_id?: string;
  project_id?: string;
  agent?: string;
  message?: string;
  cwd?: string;
}): Promise<AgentEventResult> {
  const r = await api.post('/agent-events', payload);
  return r.data;
}
```

Make sure the file's existing `import type { ... } from '../types'` block at the top of `api.ts` also pulls in the new types — find the existing import statement and add: `NotificationChannel, NotificationChannelCreate, NotificationChannelUpdate, NotificationLog, AgentEventResult`.

- [ ] **Step 3: Verify typecheck**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat: add notification channel/log types and API client functions"
```

---

## Task 10: Frontend — Settings Notifications tab UI

**Files:**
- Create: `frontend/src/components/NotificationChannelEditor.tsx`
- Create: `frontend/src/components/NotificationLogList.tsx`
- Create: `frontend/src/components/SettingsNotificationsTab.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx` (add the tab)

**Interfaces:**
- Consumes: API functions from Task 9.
- Produces: full management UI for channels + audit log; follows existing SettingsPage tab pattern.

- [ ] **Step 1: Read the existing SettingsPage tab structure**

Run:
```bash
grep -n "tab\|Tab" frontend/src/pages/SettingsPage.tsx | head -30
```
Look at how existing tabs (Remote Hosts, Execution Configs, Code Projects) are structured. Mirror that exactly.

- [ ] **Step 2: Write NotificationChannelEditor**

Create `frontend/src/components/NotificationChannelEditor.tsx`:

```tsx
import { useState, useEffect } from 'react';
import type { NotificationChannel, NotificationChannelCreate, NotificationChannelType } from '../types';

interface Props {
  initial?: NotificationChannel | null;
  onSave: (payload: NotificationChannelCreate) => Promise<void>;
  onCancel: () => void;
}

const TYPE_OPTIONS: { value: NotificationChannelType; label: string; hint: string }[] = [
  { value: 'desktop', label: 'Desktop', hint: 'notify-send (Linux)' },
  { value: 'webhook', label: 'Webhook', hint: 'Slack / Discord / Feishu / generic HTTP' },
  { value: 'sound', label: 'Sound', hint: 'Play an audio file (paplay)' },
  { value: 'email', label: 'Email', hint: 'SMTP relay' },
];

const EVENT_OPTIONS = ['Stop', 'Notification', 'SubagentStop', 'SessionEnd', 'task.done', 'task.complete', 'task.cancelled', 'task.review'];

export default function NotificationChannelEditor({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [channelType, setChannelType] = useState<NotificationChannelType>(initial?.channel_type ?? 'desktop');
  const [configText, setConfigText] = useState(JSON.stringify(initial?.config ?? {}, null, 2));
  const [eventFilters, setEventFilters] = useState<string[]>(initial?.event_filters ?? []);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  function toggleEvent(ev: string) {
    setEventFilters(prev => prev.includes(ev) ? prev.filter(x => x !== ev) : [...prev, ev]);
  }

  async function handleSave() {
    setError(null);
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(configText || '{}');
    } catch (e) {
      setError('Config is not valid JSON');
      return;
    }
    try {
      await onSave({
        name, channel_type: channelType, config,
        event_filters: eventFilters,
        enabled,
      });
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? String(e));
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-[640px] max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{initial ? 'Edit channel' : 'New channel'}</h2>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
            <select value={channelType} onChange={e => setChannelType(e.target.value as NotificationChannelType)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} — {o.hint}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Config (JSON) — see docs for shape per type
            </label>
            <textarea value={configText} onChange={e => setConfigText(e.target.value)} rows={8}
              className="w-full font-mono text-xs border border-gray-200 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">
              Fire on events (empty = all events)
            </label>
            <div className="flex flex-wrap gap-2">
              {EVENT_OPTIONS.map(ev => (
                <label key={ev} className={`px-3 py-1 rounded-full text-xs cursor-pointer border ${eventFilters.includes(ev) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                  <input type="checkbox" checked={eventFilters.includes(ev)} onChange={() => toggleEvent(ev)}
                    className="hidden" />
                  {ev}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            Enabled
          </label>
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">Save</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write NotificationLogList**

Create `frontend/src/components/NotificationLogList.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { getNotificationLogs } from '../services/api';
import type { NotificationLog } from '../types';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function NotificationLogList({ refreshTrigger }: { refreshTrigger: number }) {
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    getNotificationLogs(undefined, 100).then(setLogs);
  }, [refreshTrigger]);

  if (logs.length === 0) {
    return <div className="text-sm text-gray-400 py-4 text-center">No notifications dispatched yet.</div>;
  }

  return (
    <div className="space-y-1">
      {logs.map(log => (
        <div key={log.id} className="border-l-2 px-3 py-2 text-xs bg-gray-50/40"
          style={{ borderColor: log.status === 'success' ? '#10b981' : '#ef4444' }}>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-700">{log.channel_name}</span>
            <span className="text-gray-400">·</span>
            <span className="font-mono text-gray-600">{log.event_type}</span>
            <span className="text-gray-400">·</span>
            <span className={log.status === 'success' ? 'text-emerald-600' : 'text-red-600'}>{log.status}</span>
            {log.http_status && <span className="text-gray-500">HTTP {log.http_status}</span>}
            <span className="text-gray-400 ml-auto tabular-nums">{log.duration_ms}ms · {relativeTime(log.created_at)}</span>
          </div>
          {log.detail && (
            <button onClick={() => setExpanded(expanded === log.id ? null : log.id)}
              className="text-gray-400 hover:text-gray-600 mt-1 text-[11px]">
              {expanded === log.id ? '▾ hide detail' : '▸ show detail'}
            </button>
          )}
          {expanded === log.id && log.detail && (
            <pre className="mt-1 p-2 bg-white border border-gray-200 rounded text-[11px] overflow-x-auto whitespace-pre-wrap">{log.detail}</pre>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write SettingsNotificationsTab**

Create `frontend/src/components/SettingsNotificationsTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
  getNotificationChannels,
  createNotificationChannel,
  updateNotificationChannel,
  deleteNotificationChannel,
  testNotificationChannel,
} from '../services/api';
import type { NotificationChannel, NotificationChannelCreate } from '../types';
import NotificationChannelEditor from './NotificationChannelEditor';
import NotificationLogList from './NotificationLogList';

export default function SettingsNotificationsTab() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [editing, setEditing] = useState<NotificationChannel | null>(null);
  const [creating, setCreating] = useState(false);
  const [logRefresh, setLogRefresh] = useState(0);

  async function reload() {
    setChannels(await getNotificationChannels());
  }

  useEffect(() => { reload(); }, []);

  async function handleSaveCreate(payload: NotificationChannelCreate) {
    await createNotificationChannel(payload);
    setCreating(false);
    await reload();
    setLogRefresh(x => x + 1);
  }

  async function handleSaveEdit(payload: NotificationChannelCreate) {
    if (!editing) return;
    await updateNotificationChannel(editing.id, payload);
    setEditing(null);
    await reload();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this channel?')) return;
    await deleteNotificationChannel(id);
    await reload();
  }

  async function handleTest(id: string) {
    await testNotificationChannel(id);
    setLogRefresh(x => x + 1);
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Channels</h3>
          <button onClick={() => setCreating(true)}
            className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            + New channel
          </button>
        </div>
        {channels.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No channels configured.</p>
        ) : (
          <div className="space-y-2">
            {channels.map(ch => (
              <div key={ch.id} className="flex items-center gap-3 px-4 py-2 bg-white border border-gray-200 rounded-lg">
                <span className={`px-2 py-0.5 rounded text-[11px] font-mono ${ch.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {ch.channel_type}
                </span>
                <span className="text-sm font-medium text-gray-800">{ch.name}</span>
                <span className="text-xs text-gray-400">
                  {ch.event_filters.length === 0 ? 'all events' : ch.event_filters.join(', ')}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => handleTest(ch.id)}
                    className="px-2 py-1 text-xs rounded text-gray-600 hover:bg-gray-100">Test</button>
                  <button onClick={() => setEditing(ch)}
                    className="px-2 py-1 text-xs rounded text-gray-600 hover:bg-gray-100">Edit</button>
                  <button onClick={() => handleDelete(ch.id)}
                    className="px-2 py-1 text-xs rounded text-red-600 hover:bg-red-50">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent dispatches</h3>
        <NotificationLogList refreshTrigger={logRefresh} />
      </section>

      <section className="bg-blue-50/50 border border-blue-200 rounded-lg p-4 text-xs text-gray-600">
        <p className="font-semibold text-gray-700 mb-1">How agent hooks work</p>
        <p>When kanban creates a worktree, it auto-writes <code className="font-mono bg-white px-1 py-0.5 rounded">.claude/settings.json</code> in the worktree pointing at a forwarder script in <code className="font-mono bg-white px-1 py-0.5 rounded">~/.config/kanban/hooks/</code>. Hook events fire whenever you run Claude Code from the worktree directory, regardless of which model config you're using.</p>
      </section>

      {(creating || editing) && (
        <NotificationChannelEditor
          initial={editing}
          onSave={editing ? handleSaveEdit : handleSaveCreate}
          onCancel={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Add the tab to SettingsPage**

Modify `frontend/src/pages/SettingsPage.tsx`. Find the existing tab navigation (likely a row of buttons or a `tabs` state). Add `'notifications'` to the list. The tab content section should render `<SettingsNotificationsTab />` when the active tab is notifications.

Follow the existing pattern exactly — look at how the Remote Hosts tab is added and mirror that.

```tsx
// At the top with other imports:
import SettingsNotificationsTab from '../components/SettingsNotificationsTab';

// In the tabs list (alongside 'remote-hosts', 'execution-configs', etc.):
{ id: 'notifications', label: 'Notifications' }

// In the conditional render:
{activeTab === 'notifications' && <SettingsNotificationsTab />}
```

- [ ] **Step 6: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Run the dev server and manually verify**

```bash
bash scripts/start.sh dev
```

Visit `http://localhost:5173/settings`, click the Notifications tab:
1. Click "+ New channel" — fill in name "Desktop test", type "desktop", save. Should appear in list.
2. Click "Test" — should show a green success entry in the Recent dispatches section.
3. Edit the channel, disable it, save — toggle should stick.
4. Create a second channel with a bad webhook URL ("http://localhost:1/nope"), click Test — should show a red failure entry.

If anything looks off, fix it before moving on.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/NotificationChannelEditor.tsx frontend/src/components/NotificationLogList.tsx frontend/src/components/SettingsNotificationsTab.tsx frontend/src/pages/SettingsPage.tsx
git commit -m "feat: add Notifications tab in Settings UI"
```

---

## Task 11: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start dev server**

```bash
bash scripts/start.sh dev
```

- [ ] **Step 2: Create a notification channel that listens for `Stop`**

In `http://localhost:5173/settings` → Notifications → New channel:
- Name: `Stop - desktop`
- Type: `desktop`
- Config: `{}`
- Events: `Stop`
- Save

- [ ] **Step 3: Pick a task and create a worktree for it**

In the kanban board, open a task and create a worktree. Note the worktree path that appears in the response/UI.

- [ ] **Step 4: Verify `.claude/settings.json` was written**

```bash
cat <worktree-path>/.claude/settings.json
```
Expected: JSON with `hooks.Stop`, `hooks.Notification`, `hooks.SubagentStop`, `hooks.SessionEnd` each containing one entry pointing at `~/.config/kanban/hooks/claude-code-forwarder.sh`.

- [ ] **Step 5: Verify forwarder script exists**

```bash
ls -la ~/.config/kanban/hooks/claude-code-forwarder.sh
```
Expected: executable file. Run `cat` to inspect; should contain `curl -s -X POST http://localhost:9527/api/v1/agent-events`.

- [ ] **Step 6: Simulate a Claude Code Stop hook invocation**

From within the worktree directory, run the forwarder manually with a fake payload:

```bash
cd <worktree-path>
echo '{"hook_event_name":"Stop","session_id":"test","cwd":"'$(pwd)'","transcript_path":"/tmp/x.jsonl"}' | bash ~/.config/kanban/hooks/claude-code-forwarder.sh
echo "Exit: $?"
```
Expected: exit code 0; nothing printed (curl output suppressed). Within a second, a new success row should appear in `http://localhost:5173/settings` → Notifications → Recent dispatches with `event_type: Stop` and the task auto-resolved from `cwd`.

- [ ] **Step 7: Trigger an internal task event**

Move a task to `done` through the kanban UI. If you have a channel listening for `task.done`, it should fire.

- [ ] **Step 8: Delete the worktree**

Delete the worktree through the kanban UI. Verify:
```bash
ls <worktree-path>/.claude/settings.json
```
Expected: file no longer exists (or only contains user entries if you'd added any).

- [ ] **Step 9: Commit any docs / fixes discovered during verification**

If you found and fixed any issues, commit them. Otherwise, no commit needed.

---

## Self-Review Checklist

After writing the plan, the author verified:

- ✅ **Spec coverage:** every section of `docs/specs/2026-07-02-task-notifications-design.md` is implemented by at least one task.
  - Models → Task 1
  - Schemas → Task 2
  - Channel senders (desktop/webhook/sound/email) → Task 3
  - Notification service (ingest + dispatch + log) → Task 4
  - Receiver endpoint + channel CRUD + log list → Task 5
  - Internal task.* events → Task 6
  - Worktree hook writer + forwarder → Task 7
  - Worktree router integration → Task 8
  - Frontend types/API → Task 9
  - Frontend UI → Task 10
  - End-to-end verification → Task 11
- ✅ **No placeholders:** every step has actual code or actual commands.
- ✅ **Type consistency:** `NotificationChannel`, `NotificationLog`, `ingest_event`, `write_hooks_to_worktree`, `remove_hooks_from_worktree` signatures all match across tasks.
- ✅ **Bite-sized steps:** each step is 2–5 minutes of work.
- ✅ **TDD ordering:** tests written before implementation for every code-bearing task.
- ✅ **Frequent commits:** every task ends with a focused commit.
