from datetime import datetime
from pydantic import BaseModel, Field


class ExecutionConfigCreate(BaseModel):
    name: str = Field(max_length=200)
    command_template: str
    description: str | None = None


class ExecutionConfigUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    command_template: str | None = None
    description: str | None = None


class ExecutionConfigResponse(BaseModel):
    id: str
    name: str
    command_template: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ExecuteRequest(BaseModel):
    config_id: str


class ExecuteResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    success: bool
