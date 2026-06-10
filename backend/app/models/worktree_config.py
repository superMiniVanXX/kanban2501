import uuid
from datetime import datetime
from sqlalchemy import Boolean, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WorktreeConfig(Base):
    __tablename__ = "worktree_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    branch_template: Mapped[str] = mapped_column(String(500), nullable=False)
    dir_template: Mapped[str] = mapped_column(String(500), nullable=False)
    auto_cleanup: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    base_repo_path: Mapped[str] = mapped_column(String(1000), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
