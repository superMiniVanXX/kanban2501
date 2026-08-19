from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import logging

from app.database import get_db
from app.models.notification_channel import NotificationChannel
from app.models.notification_log import NotificationLog
from app.models.notification_item import NotificationItem
from app.models.task import Task
from app.models.worktree import Worktree

logger = logging.getLogger(__name__)
from app.schemas.agent_event import AgentEventRequest
from app.schemas.notification_channel import (
    NotificationChannelCreate,
    NotificationChannelUpdate,
    NotificationChannelResponse,
)
from app.schemas.notification_log import NotificationLogResponse
from app.schemas.notification_item import NotificationItemResponse, UnreadCountResponse
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


# --- hook sync -----------------------------------------------------------


@router.post("/hooks/sync")
def sync_hooks(db: Session = Depends(get_db)):
    """Force-rewrite the forwarder script/plugins and re-apply to all active worktrees."""
    from app.services.worktree_hooks import ensure_forwarder_script, write_hooks_to_worktree
    from app.services.opencode_hooks import write_plugin_to_worktree

    forwarder_updated = ensure_forwarder_script(force=True).exists()

    worktrees = db.query(Worktree).filter(Worktree.status == "active").all()
    synced: list[str] = []
    errors: list[dict] = []
    for wt in worktrees:
        try:
            write_hooks_to_worktree(wt.path)
            write_plugin_to_worktree(wt.path)
            synced.append(wt.id)
        except Exception as e:
            logger.warning("Failed to sync hooks to worktree %s: %s", wt.id, e)
            errors.append({"worktree_id": wt.id, "path": wt.path, "error": str(e)})

    return {
        "forwarder_updated": forwarder_updated,
        "worktrees_synced": len(synced),
        "worktree_ids": synced,
        "errors": errors,
    }


# --- notification queue (in-app notifications) ---------------------------


@router.get("/notifications", response_model=list[NotificationItemResponse])
def list_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(NotificationItem)
    if unread_only:
        q = q.filter(NotificationItem.read_at.is_(None))
    return q.order_by(NotificationItem.created_at.desc()).limit(limit).all()


@router.get("/notifications/unread-count", response_model=UnreadCountResponse)
def get_unread_count(db: Session = Depends(get_db)):
    count = (
        db.query(NotificationItem)
        .filter(NotificationItem.read_at.is_(None))
        .count()
    )
    return {"count": count}


@router.put("/notifications/{notification_id}/read", response_model=NotificationItemResponse)
def mark_notification_read(notification_id: str, db: Session = Depends(get_db)):
    item = db.query(NotificationItem).filter(NotificationItem.id == notification_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Notification not found")
    if item.read_at is None:
        item.read_at = datetime.utcnow()
        db.commit()
        db.refresh(item)
    return item


@router.put("/notifications/read-all", response_model=UnreadCountResponse)
def mark_all_notifications_read(db: Session = Depends(get_db)):
    db.query(NotificationItem).filter(NotificationItem.read_at.is_(None)).update(
        {NotificationItem.read_at: datetime.utcnow()}
    )
    db.commit()
    return {"count": 0}


@router.delete("/notifications/{notification_id}", status_code=204)
def dismiss_notification(notification_id: str, db: Session = Depends(get_db)):
    item = db.query(NotificationItem).filter(NotificationItem.id == notification_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Notification not found")
    db.delete(item)
    db.commit()


@router.delete("/notifications", response_model=UnreadCountResponse)
def clear_read_notifications(db: Session = Depends(get_db)):
    db.query(NotificationItem).filter(NotificationItem.read_at.is_not(None)).delete(
        synchronize_session=False
    )
    db.commit()
    remaining = (
        db.query(NotificationItem)
        .filter(NotificationItem.read_at.is_(None))
        .count()
    )
    return {"count": remaining}
