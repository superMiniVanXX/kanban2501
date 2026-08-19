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
