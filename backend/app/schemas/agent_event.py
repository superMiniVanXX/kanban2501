from pydantic import BaseModel, field_validator


class AgentEventRequest(BaseModel):
    # Accept either Claude Code's raw stdin payload or an explicit kanban-format body.
    # We do NOT validate event_type here — the receiver resolves it from either
    # hook_event_name (Claude Code) or event_type (kanban/opencode).
    hook_event_name: str | None = None
    event_type: str | None = None
    task_id: str | None = None
    project_id: str | None = None
    agent: str | None = None
    message: str | None = None
    cwd: str | None = None
    session_id: str | None = None
    transcript_path: str | None = None
    last_assistant_message: str | None = None
    context: dict | None = None

    def resolved_event_type(self) -> str | None:
        if self.hook_event_name:
            return self.hook_event_name
        return self.event_type

    @field_validator("event_type", "hook_event_name")
    @classmethod
    def _non_empty(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("must be non-empty string when provided")
        return v
