import uuid
from sqlalchemy import String, Integer, Enum as SAEnum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Board(Base):
    __tablename__ = "boards"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), unique=True, nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), default="Main Board")

    project = relationship("Project", back_populates="board")
    columns = relationship("Column", back_populates="board", cascade="all, delete-orphan", order_by="Column.sort_order")


class Column(Base):
    __tablename__ = "columns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    board_id: Mapped[str] = mapped_column(String(36), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    column_status: Mapped[str] = mapped_column(
        SAEnum("backlog", "todo", "in_progress", "review", "done", "cancelled", name="column_status"),
        nullable=False,
    )
    wip_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    board = relationship("Board", back_populates="columns")
