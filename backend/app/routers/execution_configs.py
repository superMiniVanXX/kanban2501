"""
Execution Config Router

SECURITY NOTE: The execute endpoint runs arbitrary shell commands on the server
using subprocess with shell=True. This feature should ONLY be exposed to trusted
users. The placeholder variables come from database-stored task fields and are
inserted via simple string replacement -- they are NOT sanitized against shell
injection. Ensure only authorized administrators can create/modify execution
configs in a production deployment.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.execution_config import ExecutionConfig
from app.schemas.execution_config import (
    ExecutionConfigCreate,
    ExecutionConfigUpdate,
    ExecutionConfigResponse,
)

router = APIRouter(tags=["execution-configs"])


@router.get("/execution-configs", response_model=list[ExecutionConfigResponse])
def list_configs(db: Session = Depends(get_db)):
    return db.query(ExecutionConfig).order_by(ExecutionConfig.created_at.desc()).all()


@router.post("/execution-configs", response_model=ExecutionConfigResponse, status_code=201)
def create_config(data: ExecutionConfigCreate, db: Session = Depends(get_db)):
    config = ExecutionConfig(**data.model_dump())
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


@router.get("/execution-configs/{config_id}", response_model=ExecutionConfigResponse)
def get_config(config_id: str, db: Session = Depends(get_db)):
    config = db.query(ExecutionConfig).filter(ExecutionConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Execution config not found")
    return config


@router.put("/execution-configs/{config_id}", response_model=ExecutionConfigResponse)
def update_config(config_id: str, data: ExecutionConfigUpdate, db: Session = Depends(get_db)):
    config = db.query(ExecutionConfig).filter(ExecutionConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Execution config not found")
    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(config, k, v)
    db.commit()
    db.refresh(config)
    return config


@router.delete("/execution-configs/{config_id}", status_code=204)
def delete_config(config_id: str, db: Session = Depends(get_db)):
    config = db.query(ExecutionConfig).filter(ExecutionConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Execution config not found")
    db.delete(config)
    db.commit()
