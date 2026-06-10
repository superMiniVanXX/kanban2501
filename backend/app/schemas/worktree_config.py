from datetime import datetime
from pydantic import BaseModel, Field


class WorktreeConfigCreate(BaseModel):
    name: str = Field(max_length=200)
    branch_template: str = Field(max_length=500)
    dir_template: str = Field(max_length=500)
    base_repo_path: str = Field(max_length=1000)
    description: str | None = None
    auto_cleanup: bool = False


class WorktreeConfigUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    branch_template: str | None = Field(default=None, max_length=500)
    dir_template: str | None = Field(default=None, max_length=500)
    base_repo_path: str | None = Field(default=None, max_length=1000)
    description: str | None = None
    auto_cleanup: bool | None = None


class WorktreeConfigResponse(BaseModel):
    id: str
    name: str
    description: str | None
    branch_template: str
    dir_template: str
    auto_cleanup: bool
    base_repo_path: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
