from datetime import datetime
from pydantic import BaseModel


class NotificationItemResponse(BaseModel):
    id: str
    event_type: str
    source: str | None = None
    title: str
    message: str | None = None
    task_id: str | None = None
    project_id: str | None = None
    severity: str
    read_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UnreadCountResponse(BaseModel):
    count: int
