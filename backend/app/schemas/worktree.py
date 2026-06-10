from datetime import datetime
from pydantic import BaseModel


class WorktreeBrief(BaseModel):
    id: str
    branch: str
    path: str
    status: str

    model_config = {"from_attributes": True}


class WorktreeResponse(BaseModel):
    id: str
    task_id: str
    config_id: str | None
    branch: str
    path: str
    status: str
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorktreeCreateRequest(BaseModel):
    config_id: str
