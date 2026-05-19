from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.code_project import CodeProject
from app.schemas.code_project import CodeProjectCreate, CodeProjectUpdate, CodeProjectResponse

router = APIRouter(tags=["code_projects"])


@router.get("/code-projects", response_model=list[CodeProjectResponse])
def list_code_projects(db: Session = Depends(get_db)):
    return db.query(CodeProject).order_by(CodeProject.created_at.desc()).all()


@router.post("/code-projects", response_model=CodeProjectResponse, status_code=201)
def create_code_project(data: CodeProjectCreate, db: Session = Depends(get_db)):
    cp = CodeProject(**data.model_dump())
    db.add(cp)
    db.commit()
    db.refresh(cp)
    return cp


@router.get("/code-projects/{cp_id}", response_model=CodeProjectResponse)
def get_code_project(cp_id: str, db: Session = Depends(get_db)):
    cp = db.query(CodeProject).filter(CodeProject.id == cp_id).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Code project not found")
    return cp


@router.put("/code-projects/{cp_id}", response_model=CodeProjectResponse)
def update_code_project(cp_id: str, data: CodeProjectUpdate, db: Session = Depends(get_db)):
    cp = db.query(CodeProject).filter(CodeProject.id == cp_id).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Code project not found")
    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(cp, k, v)
    db.commit()
    db.refresh(cp)
    return cp


@router.delete("/code-projects/{cp_id}", status_code=204)
def delete_code_project(cp_id: str, db: Session = Depends(get_db)):
    cp = db.query(CodeProject).filter(CodeProject.id == cp_id).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Code project not found")
    db.delete(cp)
    db.commit()
