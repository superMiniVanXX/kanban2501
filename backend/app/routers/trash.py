from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.project import Project
from app.models.task import Task
from app.schemas.project import ProjectResponse
from app.schemas.task import TaskResponse

router = APIRouter(tags=["trash"])


class TrashResponse(BaseModel):
    projects: list[ProjectResponse]
    tasks: list[TaskResponse]

    model_config = {"from_attributes": True}


@router.get("/trash", response_model=TrashResponse)
def get_trash(db: Session = Depends(get_db)):
    projects = db.query(Project).filter(Project.deleted_at.isnot(None)).order_by(Project.deleted_at.desc()).all()
    tasks = db.query(Task).filter(Task.deleted_at.isnot(None)).order_by(Task.deleted_at.desc()).all()
    return {"projects": projects, "tasks": tasks}


@router.post("/projects/{project_id}/restore", response_model=ProjectResponse)
def restore_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not project.deleted_at:
        raise HTTPException(status_code=400, detail="Project is not deleted")
    project.deleted_at = None
    db.commit()
    db.refresh(project)
    return project


@router.post("/tasks/{task_id}/restore", response_model=TaskResponse)
def restore_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not task.deleted_at:
        raise HTTPException(status_code=400, detail="Task is not deleted")
    task.deleted_at = None
    db.commit()
    db.refresh(task)
    return task
