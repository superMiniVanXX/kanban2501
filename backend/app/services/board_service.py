from sqlalchemy.orm import Session, joinedload

from app.models.board import Board, Column
from app.models.task import Task

DEFAULT_COLUMNS = [
    {"name": "Backlog", "column_status": "backlog", "sort_order": 0},
    {"name": "To Do", "column_status": "todo", "sort_order": 1},
    {"name": "In Progress", "column_status": "in_progress", "sort_order": 2},
    {"name": "Review", "column_status": "review", "sort_order": 3},
    {"name": "Done", "column_status": "done", "sort_order": 4},
]


def get_or_create_board(db: Session, project_id: str) -> Board:
    board = db.query(Board).filter(Board.project_id == project_id).first()
    if board:
        return board

    board = Board(project_id=project_id)
    db.add(board)
    db.flush()

    for col_data in DEFAULT_COLUMNS:
        col = Column(board_id=board.id, **col_data)
        db.add(col)

    db.commit()
    db.refresh(board)
    return board


def load_board_with_tasks(db: Session, project_id: str) -> dict:
    board = get_or_create_board(db, project_id)

    tasks = db.query(Task).options(joinedload(Task.subtasks)).filter(Task.project_id == project_id).all()
    tasks_by_status: dict[str, list] = {}
    for t in tasks:
        tasks_by_status.setdefault(t.status, []).append(t)

    columns = []
    for col in board.columns:
        col_tasks = tasks_by_status.get(col.column_status, [])
        col_tasks.sort(key=lambda t: (t.sort_order, t.created_at))
        columns.append({
            "id": col.id,
            "name": col.name,
            "column_status": col.column_status,
            "wip_limit": col.wip_limit,
            "sort_order": col.sort_order,
            "tasks": col_tasks,
        })

    return {
        "id": board.id,
        "project_id": board.project_id,
        "name": board.name,
        "columns": columns,
    }
