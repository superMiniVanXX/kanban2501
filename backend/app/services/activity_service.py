import json
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog


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
