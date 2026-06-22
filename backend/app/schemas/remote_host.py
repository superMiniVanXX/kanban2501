from datetime import datetime
from pydantic import BaseModel, Field


class RemoteHostCreate(BaseModel):
    name: str = Field(max_length=200)
    ssh_user: str = Field(min_length=1, max_length=100)
    ssh_host: str = Field(min_length=1, max_length=255)
    ssh_port: int = Field(default=22, ge=1, le=65535)
    base_path_template: str = Field(min_length=1, max_length=500)
    description: str | None = None


class RemoteHostUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    ssh_user: str | None = Field(default=None, min_length=1, max_length=100)
    ssh_host: str | None = Field(default=None, min_length=1, max_length=255)
    ssh_port: int | None = Field(default=None, ge=1, le=65535)
    base_path_template: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = None


class RemoteHostResponse(BaseModel):
    id: str
    name: str
    description: str | None
    ssh_user: str
    ssh_host: str
    ssh_port: int
    base_path_template: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SyncRequest(BaseModel):
    host_id: str | None = None
    password: str | None = None


class SyncResponse(BaseModel):
    success: bool
    stdout: str
    stderr: str
    exit_code: int
    command: str
    dest_path: str
    host_name: str
