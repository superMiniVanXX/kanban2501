from datetime import datetime
from pydantic import BaseModel, Field


class CodeProjectCreate(BaseModel):
    name: str = Field(max_length=200)
    description: str | None = None
    repo_url: str | None = None
    path: str | None = None


class CodeProjectUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    repo_url: str | None = None
    path: str | None = None


class CodeProjectResponse(BaseModel):
    id: str
    name: str
    description: str | None
    repo_url: str | None
    path: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
