from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, model_validator


ChannelType = Literal["desktop", "webhook", "sound", "email"]


class DesktopConfig(BaseModel):
    command: str = Field(default="notify-send", max_length=200)
    args: list[str] = Field(default_factory=lambda: ["--urgency=critical", "--expire-time=0"])


class WebhookConfig(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    method: Literal["POST", "PUT"] = "POST"
    headers: dict[str, str] = Field(default_factory=dict)
    body_template: str = Field(default='{"event": "{event}", "title": "{title}", "detail": "{detail}"}', max_length=4000)


class SoundConfig(BaseModel):
    file: str = Field(min_length=1, max_length=1000)
    command: str = Field(default="paplay", max_length=200)


class EmailConfig(BaseModel):
    smtp_host: str = Field(min_length=1, max_length=255)
    smtp_port: int = Field(default=587, ge=1, le=65535)
    username: str = Field(default="", max_length=200)
    password_env: str = Field(min_length=1, max_length=100)
    from_addr: str = Field(alias="from", min_length=1, max_length=200)
    to: list[str] = Field(min_length=1)
    use_tls: bool = True

    model_config = {"populate_by_name": True}


class NotificationChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    channel_type: ChannelType
    config: dict = Field(default_factory=dict)
    event_filters: list[str] = Field(default_factory=list)
    project_filters: list[str] = Field(default_factory=list)
    enabled: bool = True

    @model_validator(mode="after")
    def _validate_config(self):
        # Run the dict through the per-type config model to catch bad input early.
        type_to_model = {
            "desktop": DesktopConfig,
            "webhook": WebhookConfig,
            "sound": SoundConfig,
            "email": EmailConfig,
        }
        model = type_to_model[self.channel_type]
        # Re-validate; raises pydantic.ValidationError on bad input.
        self.config = model(**self.config).model_dump(by_alias=True)
        return self


class NotificationChannelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    config: dict | None = None
    event_filters: list[str] | None = None
    project_filters: list[str] | None = None
    enabled: bool | None = None


class NotificationChannelResponse(BaseModel):
    id: str
    name: str
    channel_type: str
    config: dict
    event_filters: list[str]
    project_filters: list[str]
    enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
