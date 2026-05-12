from pydantic import BaseModel
from app.schemas.task import TaskResponse


class ColumnResponse(BaseModel):
    id: str
    name: str
    column_status: str
    wip_limit: int | None
    sort_order: int
    tasks: list[TaskResponse] = []

    model_config = {"from_attributes": True}


class BoardResponse(BaseModel):
    id: str
    project_id: str
    name: str
    columns: list[ColumnResponse]

    model_config = {"from_attributes": True}
