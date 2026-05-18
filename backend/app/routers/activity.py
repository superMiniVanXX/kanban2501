from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.activity_log import ActivityLog
from app.models.project import Project
from app.schemas.activity_log import ActivityLogResponse
from app.services.board_service import _collect_descendant_ids

router = APIRouter(tags=["activity"])


@router.get("/projects/{project_id}/activity-logs", response_model=list[ActivityLogResponse])
def get_activity_logs(
    project_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    all_projects = db.query(Project).all()
    by_parent: dict[str | None, list[Project]] = {}
    for p in all_projects:
        by_parent.setdefault(p.parent_id, []).append(p)
    project_ids = {project_id} | _collect_descendant_ids(by_parent, project_id)

    return (
        db.query(ActivityLog)
        .filter(ActivityLog.project_id.in_(project_ids))
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
        .all()
    )
