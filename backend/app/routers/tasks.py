from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.task import Task
from app.models.project import Project
from app.schemas.task import TaskCreate, TaskUpdate, TaskStatusUpdate, TaskMove, TaskResponse

router = APIRouter(tags=["tasks"])


class CreateSubProjectRequest(BaseModel):
    name: str = Field(max_length=200)
    description: str | None = None

VALID_STATUSES = {"backlog", "todo", "in_progress", "review", "done", "cancelled"}


@router.get("/projects/{project_id}/tasks", response_model=list[TaskResponse])
def list_tasks(project_id: str, status: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Task).filter(Task.project_id == project_id)
    if status:
        q = q.filter(Task.status == status)
    return q.order_by(Task.sort_order, Task.created_at).all()


@router.post("/projects/{project_id}/tasks", response_model=TaskResponse, status_code=201)
def create_task(project_id: str, data: TaskCreate, db: Session = Depends(get_db)):
    task = Task(project_id=project_id, **data.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.get("/tasks/{task_id}", response_model=TaskResponse)
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.put("/tasks/{task_id}", response_model=TaskResponse)
def update_task(task_id: str, data: TaskUpdate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(task, k, v)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()


@router.put("/tasks/{task_id}/status", response_model=TaskResponse)
def change_task_status(task_id: str, data: TaskStatusUpdate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if data.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {VALID_STATUSES}")
    task.status = data.status
    if data.status == "done":
        task.completed_at = datetime.utcnow()
        task.progress = 100
    else:
        task.completed_at = None
    db.commit()
    db.refresh(task)
    return task


@router.put("/tasks/{task_id}/move", response_model=TaskResponse)
def move_task(task_id: str, data: TaskMove, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.sort_order = data.sort_order
    db.commit()
    db.refresh(task)
    return task


@router.post("/tasks/{task_id}/create-sub-project", response_model=TaskResponse, status_code=201)
def create_sub_project(task_id: str, data: CreateSubProjectRequest, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.sub_project_id:
        raise HTTPException(status_code=400, detail="Task already has a sub-project")
    sub = Project(name=data.name, description=data.description, parent_id=task.project_id)
    db.add(sub)
    db.flush()
    task.sub_project_id = sub.id
    db.commit()
    db.refresh(task)
    return task
