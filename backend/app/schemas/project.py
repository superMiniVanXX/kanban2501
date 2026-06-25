from __future__ import annotations
from datetime import date, datetime
from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(max_length=200)
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    parent_id: str | None = None
    exclude_from_stats: bool = False


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    parent_id: str | None = None
    exclude_from_stats: bool | None = None


class ProjectStatusUpdate(BaseModel):
    status: str


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: str | None
    status: str
    parent_id: str | None
    start_date: date | None
    end_date: date | None
    exclude_from_stats: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectProgressResponse(BaseModel):
    total_estimated_hours: float = 0.0
    completed_estimated_hours: float = 0.0
    progress: int = 0


class TaskStatusCounts(BaseModel):
    backlog: int = 0
    todo: int = 0
    in_progress: int = 0
    review: int = 0
    done: int = 0
    verify: int = 0
    complete: int = 0
    cancelled: int = 0
    total: int = 0


class ProjectTreeResponse(BaseModel):
    id: str
    name: str
    description: str | None
    status: str
    parent_id: str | None
    start_date: date | None
    end_date: date | None
    exclude_from_stats: bool = False
    created_at: datetime
    updated_at: datetime
    is_completed: bool = False
    progress: int = 0
    task_counts: TaskStatusCounts = Field(default_factory=TaskStatusCounts)
    children: list[ProjectTreeResponse] = []

    model_config = {"from_attributes": True}
