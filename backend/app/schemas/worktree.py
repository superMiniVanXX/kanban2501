from datetime import datetime
from pydantic import BaseModel


class WorktreeBrief(BaseModel):
    id: str
    branch: str
    path: str
    status: str
    base_repo_path: str | None = None

    model_config = {"from_attributes": True}


class WorktreeResponse(BaseModel):
    id: str
    task_id: str
    config_id: str | None
    base_repo_path: str | None
    branch: str
    path: str
    status: str
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorktreeCreateRequest(BaseModel):
    config_id: str | None = None
    branch: str | None = None
    path: str | None = None
    base_repo_path: str | None = None


class WorktreeImportRequest(BaseModel):
    """Associate an already-existing directory with a task as its worktree."""
    path: str


