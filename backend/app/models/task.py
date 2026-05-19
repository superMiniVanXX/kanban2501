import uuid
from datetime import datetime, date
from sqlalchemy import String, Text, Integer, Float, Date, DateTime, Enum as SAEnum, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    sub_project_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    wbs_element_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    sprint_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    acceptance_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)
    implementation_plan: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        SAEnum("backlog", "todo", "in_progress", "review", "done", "cancelled", name="task_status"),
        default="backlog",
    )
    priority: Mapped[str] = mapped_column(
        SAEnum("critical", "high", "medium", "low", name="task_priority"),
        default="medium",
    )
    task_type: Mapped[str] = mapped_column(
        SAEnum("task", "milestone", "epic", name="task_type"),
        default="task",
    )
    assignee: Mapped[str | None] = mapped_column(String(100), nullable=True)
    estimated_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    actual_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("Project", back_populates="tasks", foreign_keys=[project_id])
    sub_project = relationship("Project", foreign_keys=[sub_project_id])
    code_projects = relationship("CodeProject", secondary="task_code_projects", backref="related_tasks")


class TaskCodeProject(Base):
    __tablename__ = "task_code_projects"
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    code_project_id: Mapped[str] = mapped_column(String(36), ForeignKey("code_projects.id", ondelete="CASCADE"), primary_key=True)
