from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.remote_host import RemoteHost
from app.schemas.remote_host import (
    RemoteHostCreate,
    RemoteHostUpdate,
    RemoteHostResponse,
)

router = APIRouter(tags=["remote-hosts"])


@router.get("/remote-hosts", response_model=list[RemoteHostResponse])
def list_hosts(db: Session = Depends(get_db)):
    return db.query(RemoteHost).order_by(RemoteHost.created_at.desc()).all()


@router.post("/remote-hosts", response_model=RemoteHostResponse, status_code=201)
def create_host(data: RemoteHostCreate, db: Session = Depends(get_db)):
    host = RemoteHost(**data.model_dump())
    db.add(host)
    db.commit()
    db.refresh(host)
    return host


@router.get("/remote-hosts/{host_id}", response_model=RemoteHostResponse)
def get_host(host_id: str, db: Session = Depends(get_db)):
    host = db.query(RemoteHost).filter(RemoteHost.id == host_id).first()
    if not host:
        raise HTTPException(status_code=404, detail="Remote host not found")
    return host


@router.put("/remote-hosts/{host_id}", response_model=RemoteHostResponse)
def update_host(host_id: str, data: RemoteHostUpdate, db: Session = Depends(get_db)):
    host = db.query(RemoteHost).filter(RemoteHost.id == host_id).first()
    if not host:
        raise HTTPException(status_code=404, detail="Remote host not found")
    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(host, k, v)
    db.commit()
    db.refresh(host)
    return host


@router.delete("/remote-hosts/{host_id}", status_code=204)
def delete_host(host_id: str, db: Session = Depends(get_db)):
    host = db.query(RemoteHost).filter(RemoteHost.id == host_id).first()
    if not host:
        raise HTTPException(status_code=404, detail="Remote host not found")
    db.delete(host)
    db.commit()
