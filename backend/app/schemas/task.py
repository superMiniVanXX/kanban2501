from datetime import date, datetime
from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    title: str = Field(max_length=300)
    description: str | None = None
    priority: str = "medium"
    task_type: str = "task"
    assignee: str | None = None
    estimated_hours: float | None = None
    start_date: date | None = None
    due_date: date | None = None
    tags: list[str] | None = None
    sub_project_id: str | None = None
    acceptance_criteria: str | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    description: str | None = None
    priority: str | None = None
    task_type: str | None = None
    assignee: str | None = None
    estimated_hours: float | None = None
    actual_hours: float | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    start_date: date | None = None
    due_date: date | None = None
    tags: list[str] | None = None
    sub_project_id: str | None = None
    acceptance_criteria: str | None = None


class TaskStatusUpdate(BaseModel):
    status: str


class TaskMove(BaseModel):
    sort_order: int


class TaskResponse(BaseModel):
    id: str
    project_id: str
    wbs_element_id: str | None
    sprint_id: str | None
    title: str
    description: str | None
    status: str
    priority: str
    task_type: str
    assignee: str | None
    estimated_hours: float | None
    actual_hours: float | None
    progress: int
    start_date: date | None
    due_date: date | None
    completed_at: datetime | None
    sort_order: int
    tags: list | None
    sub_project_id: str | None
    acceptance_criteria: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
