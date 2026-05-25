from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.statistics import StatisticsResponse
from app.services.statistics_service import get_statistics

router = APIRouter(tags=["statistics"])


@router.get("/statistics", response_model=StatisticsResponse)
def fetch_statistics(
    project_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return get_statistics(db, project_id=project_id)
