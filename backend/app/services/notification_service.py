import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.notification_channel import NotificationChannel
from app.models.notification_log import NotificationLog
from app.models.notification_item import NotificationItem
from app.models.task import Task
from app.models.worktree import Worktree
from app.services.notification_senders import get_sender

_EVENT_TITLE_MAP = {
    "Stop": "Agent 已停止",
    "SubagentStop": "子 Agent 已停止",
    "Notification": "通知",
    "session.idle": "会话空闲",
    "session.end": "会话结束",
    "permission.asked": "权限请求",
    "permission.granted": "权限已授予",
    "permission.denied": "权限已拒绝",
    "task.started": "任务已开始",
    "task.completed": "任务已完成",
    "test.ping": "测试通知",
}

_ERROR_EVENTS = {"permission.denied", "error", "task.failed"}
_WARNING_EVENTS = {"permission.asked", "Notification"}


def _derive_severity(event_type: str) -> str:
    if event_type in _ERROR_EVENTS:
        return "error"
    if event_type in _WARNING_EVENTS:
        return "warning"
    return "info"


def _derive_title(event_type: str, task_title: str | None) -> str:
    base = _EVENT_TITLE_MAP.get(event_type, event_type)
    if task_title:
        return f"{base} — {task_title}"
    return base


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

    # --- Create an in-app notification item (notification queue) ---
    item = NotificationItem(
        event_type=event_type,
        source=agent,
        title=_derive_title(event_type, task_title),
        message=message,
        task_id=task_id,
        project_id=project_id,
        severity=_derive_severity(event_type),
    )
    db.add(item)
    db.flush()

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
