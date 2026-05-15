from __future__ import annotations
from datetime import date, datetime
from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(max_length=200)
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    parent_id: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    parent_id: str | None = None


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
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectTreeResponse(BaseModel):
    id: str
    name: str
    description: str | None
    status: str
    parent_id: str | None
    start_date: date | None
    end_date: date | None
    created_at: datetime
    updated_at: datetime
    children: list[ProjectTreeResponse] = []

    model_config = {"from_attributes": True}
