from datetime import datetime
from pydantic import BaseModel


class ActivityLogResponse(BaseModel):
    id: str
    project_id: str
    event_type: str
    entity_type: str
    entity_id: str
    entity_name: str
    detail: str
    extra_data: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
