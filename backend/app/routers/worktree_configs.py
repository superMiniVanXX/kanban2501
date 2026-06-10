from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.worktree_config import WorktreeConfig
from app.schemas.worktree_config import (
    WorktreeConfigCreate,
    WorktreeConfigUpdate,
    WorktreeConfigResponse,
)

router = APIRouter(tags=["worktree-configs"])


@router.get("/worktree-configs", response_model=list[WorktreeConfigResponse])
def list_configs(db: Session = Depends(get_db)):
    return db.query(WorktreeConfig).order_by(WorktreeConfig.created_at.desc()).all()


@router.post("/worktree-configs", response_model=WorktreeConfigResponse, status_code=201)
def create_config(data: WorktreeConfigCreate, db: Session = Depends(get_db)):
    config = WorktreeConfig(**data.model_dump())
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


@router.get("/worktree-configs/{config_id}", response_model=WorktreeConfigResponse)
def get_config(config_id: str, db: Session = Depends(get_db)):
    config = db.query(WorktreeConfig).filter(WorktreeConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Worktree config not found")
    return config


@router.put("/worktree-configs/{config_id}", response_model=WorktreeConfigResponse)
def update_config(config_id: str, data: WorktreeConfigUpdate, db: Session = Depends(get_db)):
    config = db.query(WorktreeConfig).filter(WorktreeConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Worktree config not found")
    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(config, k, v)
    db.commit()
    db.refresh(config)
    return config


@router.delete("/worktree-configs/{config_id}", status_code=204)
def delete_config(config_id: str, db: Session = Depends(get_db)):
    config = db.query(WorktreeConfig).filter(WorktreeConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Worktree config not found")
    db.delete(config)
    db.commit()
