import json
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from datetime import datetime, timedelta
from sqlalchemy import func
from app.models.task import Task
from app.models.project import Project
from app.models.task_status_history import TaskStatusHistory
from app.schemas.activity import ActivityTaskResponse


def log_activity(
    db: Session,
    project_id: str,
    event_type: str,
    entity_type: str,
    entity_id: str,
    entity_name: str,
    detail: str,
    extra_data: dict | None = None,
) -> ActivityLog:
    log = ActivityLog(
        project_id=project_id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_name=entity_name,
        detail=detail,
        extra_data=json.dumps(extra_data) if extra_data else None,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log

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
