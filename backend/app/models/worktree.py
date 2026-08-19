import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, Enum as SAEnum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Worktree(Base):
    __tablename__ = "worktrees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    config_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("worktree_configs.id", ondelete="SET NULL"), nullable=True)
    base_repo_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    branch: Mapped[str] = mapped_column(String(500), nullable=False)
    path: Mapped[str] = mapped_column(String(1000), nullable=False)
    status: Mapped[str] = mapped_column(
        SAEnum("pending", "active", "removed", "error", name="worktree_status"),
        default="pending",
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    task = relationship("Task", foreign_keys=[task_id])
    config = relationship("WorktreeConfig")
