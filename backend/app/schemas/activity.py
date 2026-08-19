from datetime import datetime
from pydantic import BaseModel


class ActivityTaskResponse(BaseModel):
    id: str
    title: str
    status: str
    priority: str
    project_id: str
    project_name: str
    last_changed_at: datetime

    model_config = {"from_attributes": True}
