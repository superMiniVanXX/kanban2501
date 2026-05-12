from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.subtask import SubTask
from app.models.task import Task
from app.schemas.subtask import SubTaskCreate, SubTaskUpdate, SubTaskResponse

router = APIRouter(tags=["subtasks"])


def recalc_parent_progress(db: Session, task_id: str):
    subtasks = db.query(SubTask).filter(SubTask.task_id == task_id).all()
    if not subtasks:
        return
    done_count = sum(1 for s in subtasks if s.done)
    task = db.query(Task).filter(Task.id == task_id).first()
    if task:
        task.progress = int((done_count / len(subtasks)) * 100)
        db.commit()


@router.get("/tasks/{task_id}/subtasks", response_model=list[SubTaskResponse])
def list_subtasks(task_id: str, db: Session = Depends(get_db)):
    return db.query(SubTask).filter(SubTask.task_id == task_id).order_by(SubTask.sort_order).all()


@router.post("/tasks/{task_id}/subtasks", response_model=SubTaskResponse, status_code=201)
def create_subtask(task_id: str, data: SubTaskCreate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    max_order = db.query(SubTask).filter(SubTask.task_id == task_id).count()
    subtask = SubTask(task_id=task_id, title=data.title, sort_order=max_order)
    db.add(subtask)
    db.commit()
    db.refresh(subtask)
    recalc_parent_progress(db, task_id)
    db.refresh(subtask)
    return subtask


@router.put("/subtasks/{subtask_id}", response_model=SubTaskResponse)
def update_subtask(subtask_id: str, data: SubTaskUpdate, db: Session = Depends(get_db)):
    subtask = db.query(SubTask).filter(SubTask.id == subtask_id).first()
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(subtask, k, v)
    db.commit()
    db.refresh(subtask)
    recalc_parent_progress(db, subtask.task_id)
    db.refresh(subtask)
    return subtask


@router.delete("/subtasks/{subtask_id}", status_code=204)
def delete_subtask(subtask_id: str, db: Session = Depends(get_db)):
    subtask = db.query(SubTask).filter(SubTask.id == subtask_id).first()
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")
    task_id = subtask.task_id
    db.delete(subtask)
    db.commit()
    recalc_parent_progress(db, task_id)
