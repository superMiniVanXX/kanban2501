from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.board import BoardResponse
from app.services.board_service import load_board_with_tasks

router = APIRouter(tags=["board"])


@router.get("/projects/{project_id}/board", response_model=BoardResponse)
def get_board(project_id: str, db: Session = Depends(get_db)):
    return load_board_with_tasks(db, project_id)
