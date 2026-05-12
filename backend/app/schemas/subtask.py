from datetime import datetime
from pydantic import BaseModel, Field


class SubTaskCreate(BaseModel):
    title: str = Field(max_length=300)


class SubTaskUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    done: bool | None = None


class SubTaskResponse(BaseModel):
    id: str
    task_id: str
    title: str
    done: bool
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}
