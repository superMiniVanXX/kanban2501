from sqlalchemy.orm import Session, selectinload

from app.models.board import Board, Column
from app.models.project import Project
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


def _collect_descendant_ids(projects_by_parent: dict[str | None, list[Project]], root_id: str) -> set[str]:
    ids: set[str] = set()
    children = projects_by_parent.get(root_id, [])
    for child in children:
        ids.add(child.id)
        ids.update(_collect_descendant_ids(projects_by_parent, child.id))
    return ids


def load_board_with_tasks(db: Session, project_id: str) -> dict:
    board = get_or_create_board(db, project_id)

    # Collect the current project + all descendant project IDs
    all_projects = db.query(Project).all()
    by_parent: dict[str | None, list[Project]] = {}
    for p in all_projects:
        by_parent.setdefault(p.parent_id, []).append(p)
    project_ids = {project_id} | _collect_descendant_ids(by_parent, project_id)

    tasks = db.query(Task).options(selectinload(Task.code_projects)).filter(Task.project_id.in_(project_ids)).all()
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

    active_tasks = [t for t in tasks if t.status != "cancelled"]
    is_completed = len(active_tasks) > 0 and all(t.status == "done" for t in active_tasks)

    return {
        "id": board.id,
        "project_id": board.project_id,
        "name": board.name,
        "is_completed": is_completed,
        "columns": columns,
    }
