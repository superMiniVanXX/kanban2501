from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from app.models.task_status_history import TaskStatusHistory
from app.models.task import Task


def get_statistics(db: Session, project_id: str | None = None) -> dict:
    base = db.query(TaskStatusHistory)
    task_q = db.query(func.count(Task.id)).filter(Task.status.notin_(["done", "cancelled"]))
    if project_id:
        base = base.filter(TaskStatusHistory.project_id == project_id)
        task_q = task_q.filter(Task.project_id == project_id)

    total_tasks = task_q.scalar() or 1

    now = datetime.utcnow()

    return {
        "daily": _daily_stats(base, now, total_tasks),
        "weekly": _weekly_stats(base, now, total_tasks),
        "monthly": _monthly_stats(base, now, total_tasks),
    }


def _daily_stats(base, now, total_tasks):
    cutoff = now - timedelta(days=30)
    rows = (
        base
        .filter(TaskStatusHistory.changed_at >= cutoff)
        .with_entities(
            func.strftime("%Y-%m-%d", TaskStatusHistory.changed_at).label("period"),
            func.sum(case((TaskStatusHistory.new_status == "done", 1), else_=0)).label("completed"),
            func.sum(TaskStatusHistory.new_progress - TaskStatusHistory.old_progress).label("progress_delta"),
        )
        .group_by(func.strftime("%Y-%m-%d", TaskStatusHistory.changed_at))
        .order_by("period")
        .all()
    )
    return [
        {
            "date": r.period,
            "completed_count": r.completed or 0,
            "progress_delta": round((r.progress_delta or 0) / total_tasks),
        }
        for r in rows
    ]


def _weekly_stats(base, now, total_tasks):
    cutoff = now - timedelta(weeks=12)
    rows = (
        base
        .filter(TaskStatusHistory.changed_at >= cutoff)
        .with_entities(
            func.strftime("%Y-%W", TaskStatusHistory.changed_at).label("period"),
            func.sum(case((TaskStatusHistory.new_status == "done", 1), else_=0)).label("completed"),
            func.sum(TaskStatusHistory.new_progress - TaskStatusHistory.old_progress).label("progress_delta"),
        )
        .group_by(func.strftime("%Y-%W", TaskStatusHistory.changed_at))
        .order_by("period")
        .all()
    )
    return [
        {
            "week": r.period,
            "completed_count": r.completed or 0,
            "progress_delta": round((r.progress_delta or 0) / total_tasks),
        }
        for r in rows
    ]


def _monthly_stats(base, now, total_tasks):
    cutoff = now - timedelta(days=365)
    rows = (
        base
        .filter(TaskStatusHistory.changed_at >= cutoff)
        .with_entities(
            func.strftime("%Y-%m", TaskStatusHistory.changed_at).label("period"),
            func.sum(case((TaskStatusHistory.new_status == "done", 1), else_=0)).label("completed"),
            func.sum(TaskStatusHistory.new_progress - TaskStatusHistory.old_progress).label("progress_delta"),
        )
        .group_by(func.strftime("%Y-%m", TaskStatusHistory.changed_at))
        .order_by("period")
        .all()
    )
    return [
        {
            "month": r.period,
            "completed_count": r.completed or 0,
            "progress_delta": round((r.progress_delta or 0) / total_tasks),
        }
        for r in rows
    ]
