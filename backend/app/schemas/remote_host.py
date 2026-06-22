from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints


# Security (Finding 1 & 2): validate ssh_user / ssh_host at the schema layer
# to prevent SSH option injection (e.g. ssh_host="-oProxyCommand=evil").
# Patterns are intentionally strict:
#   - ssh_user: POSIX username chars + dot/underscore/hyphen (service accounts).
#   - ssh_host: covers IPv4, IPv6 (colons), and RFC-1123 hostnames. No spaces,
#     slashes, @, or shell metacharacters; leading '-' is rejected because the
#     pattern starts with an alphanumeric character class.
_SshUserPattern = r"^[a-zA-Z0-9_.-]+$"
_SshHostPattern = r"^[a-zA-Z0-9._:-]+$"

SshUser = Annotated[str, StringConstraints(pattern=_SshUserPattern, max_length=100)]
SshHost = Annotated[str, StringConstraints(pattern=_SshHostPattern, max_length=255)]


class RemoteHostCreate(BaseModel):
    name: str = Field(max_length=200)
    ssh_user: SshUser = Field(min_length=1)
    ssh_host: SshHost = Field(min_length=1)
    ssh_port: int = Field(default=22, ge=1, le=65535)
    base_path_template: str = Field(min_length=1, max_length=500)
    description: str | None = None


class RemoteHostUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    ssh_user: SshUser | None = Field(default=None, min_length=1)
    ssh_host: SshHost | None = Field(default=None, min_length=1)
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
